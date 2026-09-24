import { z } from "zod";

import { aiImageUrlSchema } from "@/lib/ai-route-schemas";

/**
 * Upper bound on files per `getBatchRoomUploadUrls` call (issue #704).
 * Each file costs a serial, storage-signed URL round trip, so an
 * unbounded array is a signed-URL minting vector. Kept at parity with
 * `BATCH_ROOM_TYPE_MAX_IMAGES` (#681) — the same upload pipeline's
 * detection cap.
 */
export const BATCH_ROOM_MAX_FILES = 20;

/**
 * Upper bound on rooms per `createRoomsBatch` call (issue #704). Each
 * entry becomes a `prisma.room.create` inside one transaction; the cap
 * bounds the transaction size and matches the upload-URL cap so a
 * client can never stage more rooms than it can upload.
 */
export const BATCH_ROOM_MAX_ENTRIES = 20;

/** Filesystem-standard name bound (issue #704). */
export const BATCH_ROOM_FILE_NAME_MAX = 255;

/**
 * Bound for `roomType` (used as the fallback `Room.name`) and explicit
 * `roomNames` entries. Room-type labels are short ("Primary Bedroom");
 * 100 comfortably covers any real label while bounding free text.
 */
export const BATCH_ROOM_TYPE_MAX = 100;
export const BATCH_ROOM_NAME_MAX = 100;

/** Extensions the batch upload flow accepts, mirroring room-photos.ts. */
export const BATCH_ROOM_ALLOWED_IMAGE_EXTENSIONS = [
  "jpg",
  "jpeg",
  "png",
  "webp",
] as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fileExtensionOf(name: string): string {
  return (name.split(".").pop() || "").toLowerCase();
}

/**
 * `true` when `name` ends with one of
 * {@link BATCH_ROOM_ALLOWED_IMAGE_EXTENSIONS} (case-insensitive).
 */
export function isAllowedBatchImageExtension(name: string): boolean {
  return (BATCH_ROOM_ALLOWED_IMAGE_EXTENSIONS as readonly string[]).includes(
    fileExtensionOf(name)
  );
}

const batchUploadFileNameSchema = z
  .string()
  .min(1)
  .max(BATCH_ROOM_FILE_NAME_MAX)
  .refine(isAllowedBatchImageExtension, {
    message: `File name must end with one of: ${BATCH_ROOM_ALLOWED_IMAGE_EXTENSIONS.join(", ")}`,
  });

/**
 * Zod schema for the `getBatchRoomUploadUrls` server-action input
 * (issue #704).
 *
 * Contract: `projectId` is a non-empty string (ownership is re-checked
 * by the action); `files` is 1–{@link BATCH_ROOM_MAX_FILES} entries,
 * each a strict `{ name }` object whose name is 1–255 chars ending in
 * an allowed image extension — validated up front so a bad file fails
 * the whole call BEFORE any storage-signed URL is minted, not midway
 * through the serial loop. `.strict()` rejects unknown keys so stale
 * clients fail loudly.
 *
 * Side effects: none (pure validation).
 */
export const batchRoomUploadUrlsRequestSchema = z
  .object({
    projectId: z.string().min(1),
    files: z
      .array(z.object({ name: batchUploadFileNameSchema }).strict())
      .min(1)
      .max(BATCH_ROOM_MAX_FILES),
  })
  .strict();

const FAL_HOST_PATTERN = /(^|\.)fal\.ai$/;

/**
 * Storage-path shape minted by `getBatchRoomUploadUrls`:
 * `batch-rooms/{projectId}/room-{index}-{timestamp}.{ext}`. Anchored at
 * the end so it matches the path embedded in both the signed
 * (`/storage/v1/object/upload/sign/room-photos/...`) and public
 * (`/storage/v1/object/public/room-photos/...`) URL forms.
 */
export function batchRoomStoragePathPattern(projectId: string): RegExp {
  return new RegExp(
    `(?:^|/)batch-rooms/${escapeRegExp(projectId)}/room-\\d+-\\d+\\.(?:${BATCH_ROOM_ALLOWED_IMAGE_EXTENSIONS.join("|")})$`
  );
}

/**
 * `true` when `value` is an acceptable `beforeImageUrl` for a room in
 * `projectId` (issue #704): an allowlisted HTTPS image URL
 * ({@link aiImageUrlSchema} — `*.supabase.co` or `*.fal.ai`, mirroring
 * `next.config.ts` `images.remotePatterns`, so `<Image>` never gets a
 * host it would throw on), and additionally, when the host is the
 * Supabase storage host, the URL path MUST end with this project's
 * `batch-rooms/{projectId}/room-{n}-{ts}.{ext}` object path — a URL
 * pointing at another project's folder, the single-room
 * `rooms/{roomId}/...` prefix, or any arbitrary object is rejected.
 * `fal.ai` URLs (AI-generated results) pass on host allowlist alone.
 *
 * Side effects: none (pure validation).
 */
export function isValidBatchBeforeImageUrl(
  value: string,
  projectId: string
): boolean {
  if (!aiImageUrlSchema.safeParse(value).success) {
    return false;
  }
  const url = new URL(value);
  if (FAL_HOST_PATTERN.test(url.hostname)) {
    return true;
  }
  // Supabase storage host: the object path must be scoped to this
  // project's batch-rooms folder. decodeURIComponent can throw on
  // malformed percent-sequences — fall back to the raw pathname, which
  // simply fails the pattern (fails closed).
  let pathname = url.pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    // keep raw pathname
  }
  return batchRoomStoragePathPattern(projectId).test(pathname);
}

const batchBeforeImageUrlSchemaFor = (projectId: string) =>
  z.string().refine((value) => isValidBatchBeforeImageUrl(value, projectId), {
    message: `Before image URL must be https on *.supabase.co (path ending batch-rooms/${projectId}/room-<n>-<ts>.<ext>) or an allowlisted image host (*.supabase.co, *.fal.ai)`,
  });

/**
 * Builds the zod schema for the `createRoomsBatch` server-action input
 * (issue #704). A factory because each `beforeImageUrl` is validated
 * against the caller's `projectId` — the expected storage path embeds
 * it.
 *
 * Contract: `entries` is 1–{@link BATCH_ROOM_MAX_ENTRIES} strict
 * `{ fileName, roomType, beforeImageUrl }` objects — `fileName` 1–255
 * chars, `roomType` 1–{@link BATCH_ROOM_TYPE_MAX} chars after
 * trimming, `beforeImageUrl` per
 * {@link isValidBatchBeforeImageUrl}. Optional `roomNames` (explicit
 * overrides, applied by index) is capped at
 * {@link BATCH_ROOM_NAME_MAX} chars per entry and
 * {@link BATCH_ROOM_MAX_ENTRIES} entries. `.strict()` on every object
 * rejects unknown keys so stale clients fail loudly.
 *
 * Side effects: none (pure validation).
 */
export function createRoomsBatchRequestSchema(projectId: string) {
  return z
    .object({
      projectId: z.string().min(1),
      entries: z
        .array(
          z
            .object({
              fileName: z.string().min(1).max(BATCH_ROOM_FILE_NAME_MAX),
              roomType: z.string().trim().min(1).max(BATCH_ROOM_TYPE_MAX),
              beforeImageUrl: batchBeforeImageUrlSchemaFor(projectId),
            })
            .strict()
        )
        .min(1)
        .max(BATCH_ROOM_MAX_ENTRIES),
      roomNames: z
        .array(
          z
            .string()
            .trim()
            .min(1)
            .max(BATCH_ROOM_NAME_MAX)
        )
        .max(BATCH_ROOM_MAX_ENTRIES)
        .optional(),
    })
    .strict();
}
