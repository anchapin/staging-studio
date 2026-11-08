import { NextRequest, NextResponse } from "next/server";

import { getAuthedPrismaUser } from "@/lib/api-auth";
import {
  API_ERROR_INTERNAL_SERVER,
  API_ERROR_INVALID_REQUEST,
  API_ERROR_REQUEST_NOT_FOUND,
  API_ERROR_UNAUTHORIZED,
} from "@/lib/api-errors";
import { editConservationRequestSchema } from "@/lib/edit-conservation-schema";
import { evaluateEditConservationGate } from "@/lib/edit-conservation-gate";
import { validateInpaintRequestOwnership } from "@/lib/inpaint-status";

/**
 * `POST /api/inpaint/:requestId/conservation` — the ABACUS-style edit QA
 * endpoint (issue #1446, wiring slice).
 *
 * WHAT IT IS: the staged-output QA path. The browser measures the edit
 * (per-region change scores of the pre-edit frame and the edited frame,
 * plus the edit mask — see `lib/edit-conservation-measure.ts`) and posts
 * the measurements here; the server runs the deterministic checks
 * (`lib/edit-conservation.ts` via `lib/edit-conservation-gate.ts`) and
 * returns the advisory warnings.
 *
 * CONTRACT — ADVISORY ONLY, exactly like the existing LLM quality gate
 * (`lib/inpaint-quality-gate.ts`):
 * - the response carries the warnings in the same `qualityWarnings`
 *   channel the inpaint submit response uses;
 * - a conservation failure NEVER blocks, rejects, or changes the outcome
 *   of an edit — the endpoint has no side effects on the room, the
 *   request row, or the staged image. It only reports;
 * - a body with no measurements is an explicit no-op: the response is
 *   `{ qualityWarnings: [], pass: true, evaluated: false }` — no
 *   warnings are invented when there is nothing to check;
 * - the checks never throw, and any unexpected failure is reported as a
 *   skipped evaluation rather than a 500 that could confuse the caller.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const { requestId } = await params;

  try {
    const user = await getAuthedPrismaUser();
    if (!user) {
      return NextResponse.json(
        {
          error: "Unauthorized",
          message: "You must be signed in to run an edit quality check.",
          code: API_ERROR_UNAUTHORIZED,
        },
        { status: 401 }
      );
    }

    if (!requestId) {
      return NextResponse.json(
        {
          error: "Missing requestId",
          message: "Request ID is required to run an edit quality check.",
          code: API_ERROR_INVALID_REQUEST,
        },
        { status: 400 }
      );
    }

    // Ownership check — the measurements describe one user's edit, so a
    // request row owned by somebody else is a 404 (same policy as the
    // status route).
    const identity = await validateInpaintRequestOwnership(requestId, user.id);
    if (!identity) {
      return NextResponse.json(
        {
          error: "Request not found",
          message:
            "This image processing request could not be found or you don't have access to it.",
          code: API_ERROR_REQUEST_NOT_FOUND,
        },
        { status: 404 }
      );
    }

    const parsed = editConservationRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid request",
          message: "The edit quality check payload was malformed.",
          code: API_ERROR_INVALID_REQUEST,
        },
        { status: 400 }
      );
    }

    // Normalize the zod-parsed payload to the gate's measurements shape:
    // a detection/region pair only counts when BOTH sides were supplied
    // (a half-pair is no measurement, and the gate's no-data case is an
    // explicit no-op).
    const gate = evaluateEditConservationGate({
      ...parsed.data,
      detections:
        parsed.data.detections?.before && parsed.data.detections?.after
          ? {
              before: parsed.data.detections.before,
              after: parsed.data.detections.after,
            }
          : undefined,
      regions:
        parsed.data.regions?.before && parsed.data.regions?.after
          ? {
              before: parsed.data.regions.before,
              after: parsed.data.regions.after,
            }
          : undefined,
    });

    if (gate.qualityWarnings.length > 0) {
      // Advisory log — the same treatment the LLM gate's warnings get
      // (logged, surfaced, never acted on).
      console.warn(
        JSON.stringify({
          event: "edit_conservation_advisory",
          requestId,
          warnings: gate.qualityWarnings,
        })
      );
    }

    return NextResponse.json({
      qualityWarnings: gate.qualityWarnings,
      pass: gate.pass,
      evaluated: gate.evaluated,
    });
  } catch (error) {
    console.error(
      JSON.stringify({ event: "edit_conservation_failed", requestId }),
      error
    );
    // Advisory-only: a broken QA path must never look like a broken
    // edit. Report the skip instead of failing the caller.
    return NextResponse.json(
      {
        error: "Edit quality check failed",
        message: "The edit quality check could not be completed.",
        code: API_ERROR_INTERNAL_SERVER,
      },
      { status: 500 }
    );
  }
}
