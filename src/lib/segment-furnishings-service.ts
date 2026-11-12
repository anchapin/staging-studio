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
  API_ERROR_SEGMENTATION_FAILED,
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
  resolveProvider,
  type InferenceClient,
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
  /**
   * Resolve the wired inference client. Used by the pre-claim capability
   * check (issue #1527) to ask the client which logical models it
   * implements — resolving the client is free (no request goes out).
   */
  getInferenceClient: () => Promise<InferenceClient>;
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
    getInferenceClient: () => getInferenceClient(),
    logicalModel: LOGICAL_MODEL.SAM_3_1_IMAGE,
    assertInferenceConfigured,
    fetch,
  };
}

// ---------------------------------------------------------------------------
// Provider capability (issue #1527)
// ---------------------------------------------------------------------------

/**
 * The logical models each WIRED inference provider actually implements.
 *
 * Issue #1527: `LOGICAL_MODEL.SAM_3_1_IMAGE` — the model the
 * segment-furnishings surface defaults to — has NO wired implementation.
 * `resolveAlibabaModel` (#1240) and `resolveOpenAiModel` (#1506) both throw
 * `unknown logical model` for it, so every real call used to claim a daily
 * quota unit, pass `assertInferenceConfigured()`, and then die in provider
 * dispatch as an opaque 500.
 *
 * The fal-backed SAM path was retired in #1240. Restoring it (end state (a)
 * of #1527) needs a paid third-party service and a production `FAL_KEY`,
 * which is out of scope here: this issue ships end state (b) — fail fast
 * and honestly, BEFORE any quota claim.
 *
 * This table is the fallback source of truth for inference clients that do
 * not declare their own capabilities. A client MAY declare
 * `supportedLogicalModels` to override it (see
 * `assertSegmentLogicalModelSupported`). `tests/segment-sam-fail-fast-seam.test.ts`
 * pins this table against the REAL `getInferenceClient()` dispatch, so it
 * cannot silently drift from the adapters.
 */
export const WIRED_PROVIDER_LOGICAL_MODELS: Readonly<
  Record<string, readonly string[]>
> = Object.freeze({
  alibaba: Object.freeze([LOGICAL_MODEL.FLUX_FILL]),
  openai: Object.freeze([LOGICAL_MODEL.FLUX_FILL]),
});

/**
 * Optional capability declaration an inference client may expose.
 *
 * `InferenceClient` itself (in `lib/inference.ts`) carries no capability
 * metadata, so this is read structurally (duck-typed) by the check below.
 * A client that declares the list is authoritative: it knows which logical
 * models it can dispatch.
 */
export interface InferenceClientCapabilities {
  readonly supportedLogicalModels?: readonly string[];
}

/**
 * Issue #1527 — the requested logical model is not implemented by the wired
 * inference provider.
 *
 * Thrown BEFORE the daily-quota claim so a call that is guaranteed to fail
 * in provider dispatch never costs the user a quota unit.
 *
 * 501 Not Implemented: the provider does not implement the model at all, so
 * retrying the same request cannot help (`retryable: false`). The route
 * surfaces this verbatim instead of the generic "detection failed" copy.
 */
export class UnsupportedLogicalModelError extends ApiError {
  readonly logicalModel: string;
  readonly provider: string;

  constructor(logicalModel: string, provider: string) {
    super({
      code: API_ERROR_SEGMENTATION_FAILED,
      message:
        `Furnishings detection is unavailable: the "${provider}" inference ` +
        `provider does not implement the "${logicalModel}" model.`,
      status: 501,
      details: { logicalModel, provider },
    });
    this.name = "UnsupportedLogicalModelError";
    this.logicalModel = logicalModel;
    this.provider = provider;
  }
}

/**
 * Issue #1527 — assert that the wired inference client can dispatch the
 * logical model this surface needs, BEFORE any quota is claimed.
 *
 * Resolution order:
 *   1. The client declares `supportedLogicalModels` → that list wins.
 *   2. Otherwise the per-provider table (`WIRED_PROVIDER_LOGICAL_MODELS`)
 *      is the truth — today both wired providers implement `FLUX_FILL` only.
 *
 * The client is only *resolved* (no request goes out), so this check is
 * free and side-effect free. A client that cannot be resolved at all (e.g.
 * a retired `INFERENCE_PROVIDER=fal|replicate`) throws its own
 * configuration error, which the route classifies as before.
 *
 * Throws `UnsupportedLogicalModelError` when the model cannot be dispatched.
 */
export async function assertSegmentLogicalModelSupported(
  deps: SegmentFurnishingsServiceDeps,
): Promise<void> {
  const client = await deps.getInferenceClient();
  const provider = resolveProvider();
  const declared = (client as InferenceClientCapabilities)
    .supportedLogicalModels;
  const implemented =
    declared ?? WIRED_PROVIDER_LOGICAL_MODELS[provider] ?? [];
  if (implemented.includes(deps.logicalModel)) return;
  throw new UnsupportedLogicalModelError(deps.logicalModel, provider);
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