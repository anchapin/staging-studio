/**
 * Label-instances service — wave-5 revival of #933.
 *
 * Owns the pure logic for `/api/label-instances`:
 *   - room lookup + project ownership (delegates to Prisma + `api-auth`)
 *   - the `VisionLabel` cache read / upsert (delegates to `vision-labels.ts`)
 *   - the OpenAI vision-label call (delegates to `generateWithCircuitBreaker`)
 *
 * The route file stays thin: parse JSON, run auth, claim quota, delegate here,
 * shape the response, refund on failure. Every external dependency is reached
 * through the `LabelInstancesServiceDeps` argument so the service is unit
 * testable without `vi.mock`, without a live DB, and without a real OpenAI
 * call. Production code uses `defaultLabelInstancesServiceDeps()`.
 *
 * Note: quota (claim / refund) is intentionally left to the route, not the
 * service. The route owns the user-facing envelope (`dailyQuotaExceededPayload`
 * → 429), and quota lives in `api-quota.ts`. The service touches only the
 * LABEL-related surface.
 */
import type { User } from "@prisma/client";
import { generateObject } from "ai";

import { aiModel, generateWithCircuitBreaker } from "@/lib/ai";
import {
  ProjectForbiddenError,
  ProjectNotFoundError,
  requireProjectOwnershipOrThrow,
} from "@/lib/api-auth";
import { API_ERROR_ROOM_NOT_FOUND } from "@/lib/api-errors";
import { ApiError } from "@/lib/api-error-handler";
import { prisma } from "@/lib/prisma";
import {
  getCachedVisionLabels,
  upsertVisionLabels,
} from "@/lib/vision-labels";

// ---------------------------------------------------------------------------
// Domain types — mirror `visionLabelRequestSchema` / `visionLabelOutputSchema`
// in `ai-route-schemas.ts`. Kept here so the service file owns its contract
// for tests.
// ---------------------------------------------------------------------------

export interface LabelInstanceCrop {
  /** Index of the segmented instance this crop was taken from. */
  instanceIndex: number;
  /** Data URL (`data:image/<fmt>;base64,...`) for the cropped instance. */
  cropDataUrl: string;
}

export interface LabelInstanceCropWithBytes extends LabelInstanceCrop {
  /** Base64 payload of the crop with the `data:image/...;base64,` prefix stripped. */
  base64: string;
}

export interface LabelInstanceOutput {
  /** Index of the segmented instance. */
  instanceIndex: number;
  /** AI-chosen name (short noun phrase; "unknown" if unclear). */
  label: string;
}

export interface GenerateVisionLabelsResult {
  /** One entry per requested instance. The provider is expected to use the
   *  same `instanceIndex` keys we pass in. */
  labels: LabelInstanceOutput[];
}

export interface ValidatedRoomAccess {
  roomId: string;
  projectId: string;
}

/** Subset of the `VisionLabel` row the cache-hit path needs. */
export interface VisionLabelRow {
  instanceIndex: number;
  label: string;
  score: number | null;
  editedLabel?: string | null;
}

// ---------------------------------------------------------------------------
// Dependencies — every IO seam the service needs lives behind this bag.
// Tests build a hand-rolled stub; the route uses `defaultLabelInstancesServiceDeps()`.
// ---------------------------------------------------------------------------

export interface LabelInstancesServiceDeps {
  prisma: {
    room: {
      findFirst: (args: {
        where: { id: string };
        select: { id: true; projectId: true };
      }) => Promise<{ id: string; projectId: string } | null>;
    };
  };
  requireProjectOwnershipOrThrow: (
    projectId: string,
    user: User,
  ) => Promise<{ ok: true; projectId: string }>;
  generateWithCircuitBreaker: <T>(fn: () => Promise<T>) => Promise<T>;
  generateObject: typeof generateObject;
  model: unknown;
  getCachedVisionLabels: (args: {
    imageUrl: string;
    concept: string;
    instanceIndices: number[];
    userId: string;
  }) => Promise<VisionLabelRow[]>;
  upsertVisionLabels: (args: {
    imageUrl: string;
    concept: string;
    results: Array<{ instanceIndex: number; label: string }>;
    userId: string;
    roomId: string;
  }) => Promise<unknown>;
}

export function defaultLabelInstancesServiceDeps(): LabelInstancesServiceDeps {
  return {
    prisma: prisma as unknown as LabelInstancesServiceDeps["prisma"],
    requireProjectOwnershipOrThrow: requireProjectOwnershipOrThrow as LabelInstancesServiceDeps["requireProjectOwnershipOrThrow"],
    generateWithCircuitBreaker,
    generateObject,
    model: aiModel,
    getCachedVisionLabels: getCachedVisionLabels as LabelInstancesServiceDeps["getCachedVisionLabels"],
    upsertVisionLabels: upsertVisionLabels as LabelInstancesServiceDeps["upsertVisionLabels"],
  };
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/** Strip the `data:image/<fmt>;base64,` prefix from a data URL. */
export function stripBase64Prefix(cropDataUrl: string): string {
  const commaIdx = cropDataUrl.indexOf(",");
  return commaIdx >= 0 && cropDataUrl.startsWith("data:")
    ? cropDataUrl.slice(commaIdx + 1)
    : cropDataUrl;
}

/**
 * Resolve the editor's `crops` payload into the per-instance shape the
 * downstream helpers expect. Pure function — the unit test asserts on the
 * per-instance ordering and the base64 prefix stripping.
 */
export function resolveInstanceCrops(
  crops: LabelInstanceCrop[],
): LabelInstanceCropWithBytes[] {
  return crops.map((crop) => ({
    instanceIndex: crop.instanceIndex,
    cropDataUrl: crop.cropDataUrl,
    base64: stripBase64Prefix(crop.cropDataUrl),
  }));
}

/**
 * Build the OpenAI vision-label prompt. Pure function — the unit test asserts
 * the prompt text, the per-instance ordering, and the `file`-typed image
 * blocks (matching `generateObject`'s multimodal message shape).
 */
export function buildLabelPromptMessages(input: {
  concept: string;
  instanceIndices: number[];
  cropsWithBytes: LabelInstanceCropWithBytes[];
}) {
  const instanceList = input.instanceIndices.join(", ");
  const userPrompt = [
    `A room photo was scanned for "${input.concept}" instances.`,
    "Numbered crops of each detected instance follow, in detection order.",
    "Name each crop with a short, specific interior-design noun phrase",
    '(e.g. "accent chair", "coffee table"). Keep labels under 6 words.',
    "If a crop is ambiguous, use the most likely furniture name.",
    `Respond with one label per instance index (${instanceList}).`,
  ].join(" ");
  return [
    {
      role: "user" as const,
      content: [
        { type: "text" as const, text: userPrompt },
        ...input.cropsWithBytes.map((crop) => ({
          type: "file" as const,
          mediaType: "image/jpeg" as const,
          data: crop.base64,
        })),
      ],
    },
  ];
}

/**
 * Filter the AI result to only the requested instance indices. Pure function.
 * Defensive: if the provider omitted or added entries, we keep only what the
 * caller asked for so the response shape is stable.
 */
export function extractRequestedLabels(
  object: { labels?: Array<{ instanceIndex: number; label: string }> } | unknown,
  requested: number[],
): LabelInstanceOutput[] {
  const labels = (object as { labels?: Array<{ instanceIndex: number; label: string }> })
    ?.labels;
  if (!Array.isArray(labels)) return [];
  const requestedSet = new Set(requested);
  return labels
    .filter((entry) => requestedSet.has(entry.instanceIndex))
    .map((entry) => ({
      instanceIndex: entry.instanceIndex,
      label: entry.label,
    }));
}

/**
 * Map cached `VisionLabel` rows back into the API response shape. Pure
 * function. Prefers `editedLabel` over `label` when present so the editor's
 * manual overrides are honored on cache hits.
 */
export function mapCachedRowsToLabels(
  rows: VisionLabelRow[],
  requestedIndices: number[],
): LabelInstanceOutput[] {
  const byIdx = new Map<number, VisionLabelRow>();
  for (const row of rows) byIdx.set(row.instanceIndex, row);
  return requestedIndices.map((idx) => {
    const row = byIdx.get(idx);
    return {
      instanceIndex: idx,
      label: row ? (row.editedLabel ?? row.label) : "unknown",
    };
  });
}

// ---------------------------------------------------------------------------
// Exported workflow steps
// ---------------------------------------------------------------------------

/**
 * Look up the room and verify the caller owns its project. Throws
 * `ApiError(API_ERROR_ROOM_NOT_FOUND, 404)` when the room is missing or when
 * the owning project has been deleted, and `ApiError("forbidden", 403)` when
 * the user does not own the room's project.
 *
 * Translates `ProjectNotFoundError` / `ProjectForbiddenError` from
 * `requireProjectOwnershipOrThrow` into the standard `ApiError` envelope so
 * the route never needs to import the auth error classes directly.
 */
export async function validateLabelAccess(
  roomId: string,
  user: User | null | undefined,
  deps: LabelInstancesServiceDeps,
): Promise<ValidatedRoomAccess> {
  const room = await deps.prisma.room.findFirst({
    where: { id: roomId },
    select: { id: true, projectId: true },
  });
  if (!room) {
    throw new ApiError({
      status: 404,
      code: API_ERROR_ROOM_NOT_FOUND,
      message: "The requested room could not be found.",
    });
  }
  try {
    await deps.requireProjectOwnershipOrThrow(room.projectId, user as User);
  } catch (e) {
    if (e instanceof ProjectNotFoundError) {
      throw new ApiError({
        status: 404,
        code: API_ERROR_ROOM_NOT_FOUND,
        message: "Project not found.",
      });
    }
    if (e instanceof ProjectForbiddenError) {
      throw new ApiError({
        status: 403,
        code: "forbidden",
        message: "Forbidden.",
      });
    }
    throw e;
  }
  return { roomId: room.id, projectId: room.projectId };
}

/**
 * Read cached `VisionLabel` rows for `(imageUrl, concept, indices)`. Pure
 * delegation to `getCachedVisionLabels` — kept as a service export so the
 * route handler can compose the call without re-deriving the cache key.
 */
export async function loadCachedLabels(
  input: {
    imageUrl: string;
    concept: string;
    instanceIndices: number[];
    userId: string;
  },
  deps: LabelInstancesServiceDeps,
): Promise<VisionLabelRow[]> {
  return deps.getCachedVisionLabels(input);
}

/**
 * Run the OpenAI vision-label generation through the circuit breaker. The
 * caller (the route) supplies the resolved schema + messages; the service
 * owns the `generateObject` + `generateWithCircuitBreaker` wiring so the
 * route never imports `ai` directly.
 */
export async function runVisionLabelGeneration(
  input: {
    schema: unknown;
    messages: unknown;
  },
  deps: LabelInstancesServiceDeps,
): Promise<{ object: unknown }> {
  // `generateObject` returns `{ object, ... }`. The boundary cast keeps the
  // public type narrow — the route extracts `.object` and casts through
  // `extractRequestedLabels` for response shaping.
  const result = (await deps.generateWithCircuitBreaker(() =>
    (deps.generateObject as unknown as (opts: {
      model: unknown;
      schema: unknown;
      messages: unknown;
    }) => Promise<unknown>)({
      model: deps.model,
      schema: input.schema,
      messages: input.messages,
    }),
  )) as unknown as { object: unknown };
  return result;
}

/**
 * Persist the OpenAI response as `VisionLabel` rows. Pure delegation to
 * `upsertVisionLabels` — kept as a service export so the route can compose
 * the call without re-deriving the cache key, and so the service owns the
 * `roomId` denormalisation field.
 */
export async function persistLabelRows(
  input: {
    imageUrl: string;
    concept: string;
    userId: string;
    roomId: string;
  },
  labels: LabelInstanceOutput[],
  deps: LabelInstancesServiceDeps,
): Promise<void> {
  if (labels.length === 0) return;
  await deps.upsertVisionLabels({
    imageUrl: input.imageUrl,
    concept: input.concept,
    results: labels.map((l) => ({
      instanceIndex: l.instanceIndex,
      label: l.label,
    })),
    userId: input.userId,
    roomId: input.roomId,
  });
}