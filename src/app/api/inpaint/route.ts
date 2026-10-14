import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { buildDeprecationHeaders } from "@/lib/api-version";
import { withRequestLogging } from "@/lib/api-logging";
import { logInpaintEvent } from "@/lib/logInpaintEvent";
import { prisma } from "@/lib/prisma";
import {
  inpaintSubmitSchema,
  classifyInpaintError,
  validateInpaintRoom,
  submitInpaintToActiveProvider,
  reserveInpaintQuota,
  refundInpaintQuota,
  type InpaintSubmitOptions,
} from "@/lib/inpaint-submit";
import { dailyQuotaExceededPayload } from "@/lib/api-quota";
import type { QuotaClaim } from "@/lib/api-quota";
import { API_ERROR_RATE_LIMIT_EXCEEDED } from "@/lib/api-errors";

// Issue #1262: the Alibaba DashScope inpaint submit is synchronous and
// takes ~30s, which blows past Vercel's default Hobby-tier 10s Node
// function ceiling (and is right at the Pro 60s limit). Lifting the
// ceiling to 60s lets Hobby still serve the synchronous flow at all;
// the fire-and-forget restructure that follows in this file makes the
// request handler return in milliseconds so even Hobby stays well
// inside its budget.
//
// See `#1262` in the issue tracker for the full context.
export const maxDuration = 60;

async function postInpaint(request: NextRequest) {
  // Issue #1111: track the atomic quota claim so the catch below can
  // refund it when the InpaintRequest pre-write fails. Mirrors the
  // `segmentClaim` / `segmentUserId` pair in
  // `app/api/segment/furnishings/route.ts`.
  let quotaUserId: string | undefined;
  let inpaintClaim: QuotaClaim | null = null;
  try {
    const user = await getAuthedPrismaUser();
    if (!user) {
      return NextResponse.json(
        {
          error: "Unauthorized",
          message: "You must be signed in to start inpainting.",
        },
        { status: 401, headers: buildDeprecationHeaders() }
      );
    }

    quotaUserId = user.id;

    // Issue #1111: atomically claim one inpaint unit BEFORE the paid
    // provider call. The conditional increment in `claimDailyQuota`
    // (`UPDATE ... WHERE count <= limit - N`) is serialized by
    // Postgres, so a concurrent burst can no longer all read the same
    // pre-spend count and all reach the provider; losers get 429 with
    // the same payload shape as the other surfaces (`copy`, `export`,
    // `label`, `segment` — see issue #1132). The unit is HELD until
    // either:
    //   (a) the provider call settles successfully → keep the unit
    //       (a paid job ran; the #1131/#1262 fire-and-forget path's
    //       pre-write failure is the only refund path); or
    //   (b) the InpaintRequest pre-write fails → refund in the catch
    //       below so a transient DB failure does not bill for work
    //       that was never done.
    inpaintClaim = await reserveInpaintQuota(user.id);
    if (!inpaintClaim.claimed) {
      console.warn(
        JSON.stringify({
          event: "inpaint_daily_quota_exceeded",
          userId: user.id,
          used: inpaintClaim.used,
          limit: inpaintClaim.limit,
        })
      );
      return NextResponse.json(
        {
          ...dailyQuotaExceededPayload(inpaintClaim, "Please try again tomorrow."),
          code: API_ERROR_RATE_LIMIT_EXCEEDED,
        },
        { status: 429 }
      );
    }

    const parsed = inpaintSubmitSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid request",
          message:
            "Please provide a valid imageUrl, maskUrl, promptDirectives, aesthetic, roomId, variantSlot, and sourceSlot.",
          issues: parsed.error.issues,
        },
        { status: 400 }
      );
    }

    const { roomId, sourceSlot: rawSourceSlot } = parsed.data;
    const sourceSlot = rawSourceSlot ?? null;

    const roomValidation = await validateInpaintRoom(roomId, user.id, sourceSlot);
    if (roomValidation.error || !roomValidation.room) {
      return NextResponse.json(
        {
          // room === null means either "not found" (404) or "no staged result for this variant" (400)
          error: roomValidation.room
            ? "Invalid source"
            : roomValidation.status === 404
              ? "Room not found"
              : "Invalid source",
          message: roomValidation.error ?? "Unexpected error",
        },
        { status: roomValidation.status }
      );
    }

    // Issue #1262: fire-and-forget submit. Pre-allocate a requestId so we
    // can write the InpaintRequest row BEFORE the provider's submit
    // returns (Alibaba is synchronous and ~30s), then kick off the
    // submit in a detached promise — the request handler returns the
    // requestId to the client immediately, the background tick fills
    // in status / providerJobId / resultUrl when the submit settles,
    // and the client's status poll reads that row.
    //
    // Issue #1111: the inpaint unit is already HELD by the atomic
    // claim above; the background submit failing here does NOT refund
    // it (a paid provider call ran for the synchronous Alibaba path
    // and the async queue job is enqueued either way). The only
    // remaining failure path that can refund is the pre-write below.
    //
    // The synchronous result is populated by Alibaba (#1240). When it
    // is, the background writes status="COMPLETED"+resultUrl so the
    // poller's `decideInpaintPersistence` short-circuits to
    // `return-stored` on every Vercel instance — the #1240
    // multi-instance fix survives.
    const requestId = randomUUID();
    // Capture the validated room into a local so the background
    // closure below keeps the narrowed type (the original
    // `roomValidation.room` could be inferred as nullable across the
    // boundary by `tsc`).
    const room = roomValidation.room;

    try {
      await prisma.inpaintRequest.create({
        data: {
          id: requestId,
          roomId: room.id,
          variantSlot: parsed.data.variantSlot,
          sourceSlot,
          // Row is visible to the poller before the submit settles;
          // the poller's gone-recovery path (issue #1202) tolerates a
          // brief IN_QUEUE window. Once the background completes, this
          // flips to COMPLETED+resultUrl (Alibaba) or IN_PROGRESS
          // (async providers — fallback so a future async adapter does
          // not silently leave the row in IN_QUEUE forever).
          status: "IN_QUEUE",
        },
      });
    } catch (createError) {
      // Issue #1111: the unit is held from the atomic claim above but
      // the provider call never ran (we never kicked off the
      // background submit), so a pre-write failure must refund the
      // claim. Without this, a transient DB blip on the row write
      // would silently bill the user for work that was not done.
      await refundInpaintQuota(user.id);
      console.error(
        JSON.stringify({
          event: "inpaint_record_precreate_failed",
          requestId,
          roomId: room.id,
          quotaRefunded: true,
        }),
        createError
      );
      return NextResponse.json(
        {
          error: "Inpainting failed",
          message:
            "We couldn't reserve a request slot. Please try again in a moment.",
        },
        { status: 500 }
      );
    }

    const submitOptions: InpaintSubmitOptions = {
      imageUrl: parsed.data.imageUrl,
      maskUrl: parsed.data.maskUrl,
      aesthetic: parsed.data.aesthetic,
      promptDirectives: parsed.data.promptDirectives,
      negativePrompt: parsed.data.negativePrompt,
      promptStrength: parsed.data.promptStrength,
      maskBlur: parsed.data.maskBlur,
      seed: parsed.data.seed,
      creativeMode: parsed.data.creativeMode,
    };

    // Fire-and-forget. `void` makes the linter happy; the promise
    // chain owns its own errors so an unhandled rejection cannot reach
    // Node. The background update on the row is the contract the
    // poller relies on; logging there surfaces any persistence
    // failure that would otherwise strand the row in IN_QUEUE.
    void (async () => {
      try {
        const submission = await submitInpaintToActiveProvider(submitOptions);
        const syncResult = submission.result;
        await prisma.inpaintRequest.update({
          where: { id: requestId },
          data: {
            providerJobId: submission.request_id,
            // #1240 multi-instance fix: synchronous providers (Alibaba)
            // surface the durable DashScope-hosted URL inline. The
            // poller's `decideInpaintPersistence` short-circuits to
            // `return-stored` on any Vercel instance, so the result
            // is durable across instances regardless of which lambda
            // got the first poll.
            ...(syncResult
              ? { status: "COMPLETED", resultUrl: syncResult.imageUrl }
              : { status: "IN_PROGRESS" }),
          },
        });
        console.log(
          JSON.stringify({
            event: "inpaint_background_submit_settled",
            requestId,
            providerJobId: submission.request_id,
            provider: "alibaba",
            sync: Boolean(syncResult),
          })
        );
      } catch (submitError) {
        // Surface to logs so an orphaned IN_QUEUE row is
        // discoverable, then flip to ERROR so the poller's gone
        // recovery (#1202) does not loop forever on a row that
        // never had a job queued against it.
        console.error(
          JSON.stringify({
            event: "inpaint_background_submit_failed",
            requestId,
            roomId: room.id,
            userId: user.id,
          }),
          submitError
        );
        try {
          await prisma.inpaintRequest.update({
            where: { id: requestId },
            data: { status: "ERROR" },
          });
        } catch (markError) {
          console.error(
            JSON.stringify({
              event: "inpaint_background_mark_error_failed",
              requestId,
            }),
            markError
          );
        }
      }
    })();

    const response = NextResponse.json({
      requestId,
      qualityWarnings: [],
    });
    // Issue #1116: the pipeline requestId supersedes the wrapper's
    // minted HTTP id. The client echoes it on status polls, so submit
    // -> queue -> status poll -> upload join on one id.
    response.headers.set("x-request-id", requestId);
    logInpaintEvent({
      userId: user.id,
      requestId,
      roomId,
      variantSlot: parsed.data.variantSlot,
      status: "submitted",
    });
    return response;
  } catch (error) {
    // Issue #1111: when the outer catch fires after a successful
    // claim, the InpaintRequest pre-write has either not happened
    // (schema/validation error) or succeeded without the background
    // IIFE having been kicked off yet (the IIFE catches its own
    // errors and the `void` invocation is the last synchronous step
    // before this catch can fire, so the IIFE has not started). In
    // both cases no provider call ran for this request — refund.
    // The InpaintRequest pre-write failure path is handled
    // separately by its own try/catch above, which also refunds.
    if (quotaUserId && inpaintClaim?.claimed) {
      await refundInpaintQuota(quotaUserId);
    }
    const classified = classifyInpaintError(error);
    return NextResponse.json(
      { error: classified.error, message: classified.message, retryable: classified.retryable, code: classified.code },
      { status: classified.status }
    );
  }
}

// Issue #1116: wire the request logger so this route actually logs.
export const POST = withRequestLogging(postInpaint);
