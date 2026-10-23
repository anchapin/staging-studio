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
import {
  cancelInpaintProviderJob,
  releaseInpaintQuotaReservation,
  writeInpaintProviderJobIdWithRetry,
} from "@/lib/inpaint-quota";
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

/**
 * Flips the row to ERROR, best-effort. A row left in IN_QUEUE would
 * keep the client's poller spinning (and the #1202 gone-recovery would
 * never fire), so a failed background tick must mark it terminal.
 */
async function markInpaintRowError(requestId: string): Promise<void> {
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

/**
 * Issue #1421 path 1 — the provider REJECTED the submit.
 *
 * No job exists upstream and no result will ever exist, so the user's
 * reserved quota unit is released through the central helper. Before
 * this fix the row was flipped to ERROR but the unit was kept: during
 * a provider outage every submission failed and every failure still
 * charged the cap, so a user who retried twice consumed 2 of 20 with
 * zero outputs.
 */
async function handleInpaintSubmitFailure(params: {
  requestId: string;
  roomId: string;
  userId: string;
  error: unknown;
}): Promise<void> {
  console.error(
    JSON.stringify({
      event: "inpaint_background_submit_failed",
      requestId: params.requestId,
      roomId: params.roomId,
      userId: params.userId,
    }),
    params.error
  );
  await markInpaintRowError(params.requestId);
  await releaseInpaintQuotaReservation({
    userId: params.userId,
    requestId: params.requestId,
    reason: "provider_submit_failed",
    // The row was pre-written as IN_QUEUE and has never produced a
    // durable result, so the unit is still held.
    previousStatus: "IN_QUEUE",
  });
}

/**
 * Issue #1421 path 3 — the provider accepted the job but the
 * post-submit `providerJobId` write failed permanently.
 *
 * The provider has already billed us for a job no DB row can map to, so
 * the upstream job is cancelled FIRST (the only way to stop the money)
 * and the user's quota unit is released afterwards. If the cancel
 * cannot succeed the provider cost is recorded as a known-cost
 * write-off by the central helper rather than being silently absorbed.
 */
async function handleInpaintPostSubmitWriteFailure(params: {
  requestId: string;
  userId: string;
  providerJobId: string;
  error: unknown;
}): Promise<void> {
  console.error(
    JSON.stringify({
      event: "inpaint_background_post_submit_write_failed",
      requestId: params.requestId,
      userId: params.userId,
      providerJobId: params.providerJobId,
    }),
    params.error
  );

  const cancel = await cancelInpaintProviderJob(params.providerJobId);
  console.error(
    JSON.stringify({
      event: "inpaint_background_provider_cancel",
      requestId: params.requestId,
      providerJobId: params.providerJobId,
      attempted: cancel.attempted,
      cancelled: cancel.cancelled,
      reason: cancel.reason,
    })
  );

  await markInpaintRowError(params.requestId);
  await releaseInpaintQuotaReservation({
    userId: params.userId,
    requestId: params.requestId,
    reason: "post_submit_record_write_failed",
    previousStatus: "IN_QUEUE",
    providerJobId: params.providerJobId,
    providerCostIncurred: true,
    providerCancelSucceeded: cancel.cancelled,
  });
}

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
      // Issue #1362b: schema renamed `promptStrength` → `strength`
      // to match DashScope's `parameters.strength` wire field; the
      // legacy `maskBlur` / `creativeMode` / `lockSeed` fields are
      // gone (mask feathering moved to a browser-side pre-upload
      // pass; creativeMode/lockSeed had no surviving UI control
      // after #1362a's adherence + shadows removal).
      strength: parsed.data.strength,
      seed: parsed.data.seed,
    };

    // Fire-and-forget. `void` makes the linter happy; the promise
    // chain owns its own errors so an unhandled rejection cannot reach
    // Node.
    //
    // Issue #1421: the background tick now distinguishes the two
    // failure modes that used to keep the user's quota unit:
    //   - the PROVIDER rejected the submit (no job exists upstream) —
    //     the unit is released and the row is flipped to ERROR;
    //   - the provider accepted the job but the POST-SUBMIT ROW WRITE
    //     failed (Alibaba already billed us, ~$0.04/image) — the write
    //     is retried first, and on permanent failure the provider job
    //     is cancelled before the unit is released.
    void (async () => {
      let submission: Awaited<ReturnType<typeof submitInpaintToActiveProvider>>;
      try {
        submission = await submitInpaintToActiveProvider(submitOptions);
      } catch (submitError) {
        // Path 1 (issue #1421): the provider rejected the submit
        // (outage / 5xx / timeout). No job exists upstream, no result
        // will ever exist, so the reserved quota unit MUST go back to
        // the user — before this fix the row was flipped to ERROR and
        // the unit was silently kept, so a provider outage burned the
        // user's whole daily cap for zero outputs.
        await handleInpaintSubmitFailure({
          requestId,
          roomId: room.id,
          userId: user.id,
          error: submitError,
        });
        return;
      }

      const syncResult = submission.result;
      try {
        // Path 3 (issue #1421): the providerJobId write is retried on
        // transient DB failures so a blip cannot orphan a job the
        // provider already accepted.
        await writeInpaintProviderJobIdWithRetry({
          requestId,
          providerJobId: submission.request_id,
          resultUrl: syncResult?.imageUrl ?? null,
        });
      } catch (writeError) {
        await handleInpaintPostSubmitWriteFailure({
          requestId,
          userId: user.id,
          providerJobId: submission.request_id,
          error: writeError,
        });
        return;
      }

      console.log(
        JSON.stringify({
          event: "inpaint_background_submit_settled",
          requestId,
          providerJobId: submission.request_id,
          provider: "alibaba",
          sync: Boolean(syncResult),
        })
      );
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
