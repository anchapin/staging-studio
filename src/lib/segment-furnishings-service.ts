/**
 * Segment-furnishings service — wave-5 revival of #933.
 *
 * Owns the pure logic for `/api/segment/furnishings`:
 *   - room lookup + ownership check (delegates to Prisma)
 *   - the SAM 3.1 inference call (delegates to `getInferenceClient`)
 *   - the mask-URL fetch + base64 conversion (delegates to `fetch`)
 *   - the payload builder / response parser (delegates to
 *     `furnishing-detection.ts`)
 *
 * The route file stays thin: parse JSON, run auth, claim quota, delegate
 * here, shape the response, refund on failure. Every external dependency is
 * reached through the `SegmentFurnishingsServiceDeps` argument so the
 * service is unit testable without `vi.mock`, without a live DB, and without
 * a real inference call.
 *
 * Note: quota (claim / refund) is intentionally left to the route, not the
 * service. The route owns the user-facing 429 envelope, and quota lives in
 * `api-quota.ts`. The service touches only the SEGMENT-related surface.
 */
import { ApiError } from "@/lib/api-error-handler";
import {
  API_ERROR_INVALID_REQUEST,
  API_ERROR_ROOM_NOT_FOUND,
  API_ERROR_UNAUTHORIZED,
} from "@/lib/api-errors";
import {
  buildFurnishingDetectionPayload,
  parseFurnishingDetectionResponse,
} from "@/lib/furnishing-detection";
import {
  assertInferenceConfigured,
  getInferenceClient,
  LOGICAL_MODEL,
} from "@/lib/inference";
import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface SegmentFurnishingsRequest {
  roomId: string;
  imageUrl: string;
  concept?: string;
}

export interface FurnishingDetectionResult {
  /** Resolved mask data URLs (data:image/png;base64,…), one per instance. */
  masks: string[];
  /** Original inference mask URLs (kept for cache keys + response). */
  maskUrls: string[];
  /**
   * `scores` filtered to match `masks` — only entries whose mask fetched
   * successfully are kept. `undefined` when the inference result carried
   * no scores.
   */
  keptScores: number[] | undefined;
  /** Decoded payload from the inference response. */
  raw: unknown;
}

export interface ValidatedRoomAccess {
  roomId: string;
  /** Prisma `Room` row carrying the parent project id and the photo URL. */
  room: {
    id: string;
    projectId: string;
    afterImageUrl: string | null;
  };
}

// ---------------------------------------------------------------------------
// Dependencies — every IO seam the service needs lives behind this bag.
// Tests build a hand-rolled stub; the route uses `defaultSegmentFurnishingsServiceDeps()`.
// ---------------------------------------------------------------------------

export interface SegmentFurnishingsServiceDeps {
  prisma: {
    room: {
      findFirst: (args: {
        where: { id: string; project: { userId: string } };
        select: { id: true; projectId: true; afterImageUrl: true };
      }) => Promise<{
        id: string;
        projectId: string;
        afterImageUrl: string | null;
      } | null>;
    };
  };
  buildPayload: (args: { imageUrl: string; concept?: string }) => unknown;
  parseResponse: (raw: unknown) => {
    maskUrls: string[];
    scores: number[];
  } | null;
  /**
   * Run a single inference subscription. Matches `subscribe(model, opts)` on
   * the resolved inference client.
   */
  subscribe: (model: string, opts: {
    input: Record<string, unknown>;
    abortSignal: AbortSignal;
  }) => Promise<unknown>;
  /** The logical model id passed to `subscribe`. */
  logicalModel: string;
  assertInferenceConfigured: () => void;
  /** HTTP fetch used to download mask PNGs and convert them to data URLs. */
  fetch: (input: string) => Promise<Response>;
}

export function defaultSegmentFurnishingsServiceDeps(): SegmentFurnishingsServiceDeps {
  return {
    prisma: prisma as unknown as SegmentFurnishingsServiceDeps["prisma"],
    buildPayload: buildFurnishingDetectionPayload as unknown as SegmentFurnishingsServiceDeps["buildPayload"],
    parseResponse: parseFurnishingDetectionResponse as unknown as SegmentFurnishingsServiceDeps["parseResponse"],
    subscribe: async (model, opts) => {
      const client = await getInferenceClient();
      return client.subscribe(model as Parameters<typeof client.subscribe>[0], opts);
    },
    logicalModel: LOGICAL_MODEL.SAM_3_1_IMAGE,
    assertInferenceConfigured,
    fetch,
  };
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Convert an HTTP `Response` body to a `data:image/<fmt>;base64,…` URL.
 * Pure function — the caller provides the `ArrayBuffer`. Centralised so the
 * unit test can assert on the data-URL formatting without mocking `fetch`.
 */
export function arrayBufferToDataUrl(
  buffer: ArrayBuffer,
  contentType: string,
): string {
  const base64 = Buffer.from(buffer).toString("base64");
  // Strip charset suffix — the data URL wants a single MIME token.
  const mime = contentType.split(";")[0].trim() || "image/png";
  return `data:${mime};base64,${base64}`;
}

/**
 * Filter `Promise.allSettled` results to mask data URLs, dropping failed
 * fetches. The route tolerates partial mask-fetch failures (some bad URLs
 * should not fail the whole segmentation). Pure transformation: callers
 * pass the `Promise.allSettled` results directly.
 */
export function resolveMaskResults(
  results: Array<PromiseSettledResult<string>>,
): string[] {
  const masks: string[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      masks.push(result.value);
    }
  }
  return masks;
}

/**
 * Filter the per-mask `scores` array so it lines up with the surviving
 * (fulfilled) masks. Pure transformation — the unit test asserts that
 * `keptScores[i]` corresponds to `masks[i]`. When the inference result
 * carries no scores, returns `undefined` (matching the original route's
 * `detection.scores ? keptScores : detection.scores` contract).
 */
export function keepScoresForSurvivingMasks(
  results: Array<PromiseSettledResult<string>>,
  scores: number[] | undefined,
): number[] | undefined {
  if (!scores) return undefined;
  const kept: number[] = [];
  results.forEach((outcome, index) => {
    if (outcome.status === "fulfilled") {
      const score = scores[index];
      if (score !== undefined) kept.push(score);
    }
  });
  return kept;
}

// ---------------------------------------------------------------------------
// Exported workflow steps
// ---------------------------------------------------------------------------

/**
 * Look up the room and verify the caller owns its project. Throws
 * `ApiError(API_ERROR_ROOM_NOT_FOUND, 404)` when the room is missing and
 * `ApiError(API_ERROR_UNAUTHORIZED, 401)` when no session user is set.
 */
export async function validateSegmentAccess(
  input: { roomId: string },
  user: { id: string } | null | undefined,
  deps: SegmentFurnishingsServiceDeps,
): Promise<ValidatedRoomAccess> {
  if (!user || !user.id) {
    throw new ApiError({
      code: API_ERROR_UNAUTHORIZED,
      message: "Not authenticated.",
      status: 401,
    });
  }
  const room = await deps.prisma.room.findFirst({
    where: { id: input.roomId, project: { userId: user.id } },
    select: { id: true, projectId: true, afterImageUrl: true },
  });
  if (!room) {
    throw new ApiError({
      code: API_ERROR_ROOM_NOT_FOUND,
      message: "Room could not be found.",
      status: 404,
    });
  }
  return { roomId: room.id, room };
}

/**
 * Fetch a single mask URL and convert it to a data URL. Pure delegation to
 * `deps.fetch` — kept as a service export so the route handler can compose
 * the `Promise.allSettled` array without re-deriving the data-URL shape.
 */
export async function fetchMaskAsDataUrl(
  url: string,
  deps: SegmentFurnishingsServiceDeps,
): Promise<string> {
  const response = await deps.fetch(url);
  if (!response.ok) {
    throw new ApiError({
      code: API_ERROR_INVALID_REQUEST,
      message: `Mask fetch failed: ${response.status} ${response.statusText}`,
      status: 502,
    });
  }
  const buffer = await response.arrayBuffer();
  const contentType = response.headers.get("content-type") ?? "image/png";
  return arrayBufferToDataUrl(buffer, contentType);
}

/**
 * Run the SAM 3.1 inference call. Returns the parsed detection result and
 * the resolved mask data URLs. The `abortSignal` is plumbed through so the
 * caller can cancel an in-flight request (e.g. on `AbortController` from
 * the route's per-request lifecycle).
 */
export async function runFurnishingDetection(
  input: {
    imageUrl: string;
    concept?: string;
    abortSignal: AbortSignal;
  },
  deps: SegmentFurnishingsServiceDeps,
): Promise<FurnishingDetectionResult> {
  deps.assertInferenceConfigured();
  const payload = deps.buildPayload({
    imageUrl: input.imageUrl,
    ...(input.concept !== undefined ? { concept: input.concept } : {}),
  });
  const raw = await deps.subscribe(deps.logicalModel, {
    input: payload as Record<string, unknown>,
    abortSignal: input.abortSignal,
  });
  const parsed = deps.parseResponse(raw);
  if (!parsed) {
    throw new ApiError({
      code: API_ERROR_INVALID_REQUEST,
      message: "Inference returned no mask URLs.",
      status: 502,
    });
  }
  // `Promise.allSettled` so a single bad mask URL does not fail the call.
  const settled = await Promise.allSettled(
    parsed.maskUrls.map((maskUrl) => fetchMaskAsDataUrl(maskUrl, deps)),
  );
  const masks = resolveMaskResults(settled);
  return {
    masks,
    maskUrls: parsed.maskUrls,
    keptScores: keepScoresForSurvivingMasks(settled, parsed.scores),
    raw,
  };
}