import { z } from "zod";

import { isLoopbackImageAllowed } from "@/lib/image-remote-patterns";

const IMAGE_HOST_PATTERN = /(^|\.)supabase\.co$|(^|\.)fal\.ai$/;
// `mock` (issue #413) is a hostname fixture, not a loopback IP, so it
// is unaffected by the E2E_HERMETIC gate — it always accepts. The two
// loopback entries (127.0.0.1 / localhost) ARE gated by that env var
// below — issue #1112.
const LOOPBACK_HOST_PATTERN = /^(localhost|127\.0\.0\.1)(:\d+)?$/i;
const MOCK_HOST_PATTERN = /^mock(:\d+)?$/i;

/**
 * Single source of truth for whether loopback http URLs are accepted in
 * PATCH payloads. Reads `process.env.E2E_HERMETIC` at evaluation time —
 * evaluated when the schema is constructed (module load), not per-parse,
 * which matches the schema's other static patterns. See
 * `src/lib/image-remote-patterns.ts` for the env-var contract; the same
 * predicate gates `next.config.ts`'s loopback `remotePatterns` so a
 * single env value flips both on/off (issue #1112).
 *
 * The `mock` host (issue #413) is intentionally NOT included here — it
 * is not a loopback host, so it is unaffected by this gate.
 */
const LOOPBACK_ALLOWED = isLoopbackImageAllowed(process.env.E2E_HERMETIC);

const imageUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => {
      const url = new URL(value);
      if (url.protocol === "https:") {
        return IMAGE_HOST_PATTERN.test(url.hostname);
      }
      // Issue #264 / #1112: allow http://127.0.0.1 and http://localhost
      // ONLY when the hermetic e2e harness is active. Production MUST
      // reject them — a loopback URL written to `Room.afterImageUrl`
      // renders through `<Image src>` and lets the server-side
      // optimizer fetch the app's own loopback (SSRF surface, even
      // behind auth). next.config.ts's matching `remotePatterns`
      // entries are gated by the same predicate so the two cannot
      // drift. The `mock` host (issue #413) is NOT loopback and is
      // accepted unconditionally — it is a schema-only convenience for
      // test fixture URLs that never resolve through next/image.
      if (url.protocol === "http:") {
        if (MOCK_HOST_PATTERN.test(url.hostname)) return true;
        if (!LOOPBACK_ALLOWED) return false;
        return LOOPBACK_HOST_PATTERN.test(url.hostname);
      }
      return false;
    },
    {
      message:
        "Image URL must be https with host *.supabase.co or *.fal.ai",
    }
  );

/**
 * Zod schema for partial room-image updates accepted by `PATCH
 * /api/projects/:projectId/rooms/:roomId`.
 *
 * Purpose: validates the JSON body of a room patch so only allowlisted
 * fields (`selectedVariantIndex`, the four before/after image URLs) are
 * ever written to `Room`. All fields are optional (clients patch only
 * what changed — e.g. `persistInpaintResult` saves a single after URL);
 * `.strict()` rejects unknown keys outright.
 *
 * Contract: every image URL must be HTTPS on `*.supabase.co` or
 * `*.fal.ai`. When the e2e harness flag `E2E_HERMETIC=1` is set, the
 * schema additionally accepts http://127.0.0.1/localhost for the mock
 * storage fixtures (issue #264); production MUST reject them (issue
 * #1112). The schema and `next.config.ts` share one predicate so a
 * single env value flips both on/off. `selectedVariantIndex` must be 0
 * or 1. An entirely empty body (`{}`) parses, so the PATCH route must
 * reject it before handing `parsed.data` to Prisma (`updateMany` throws
 * on empty `data`).
 *
 * Side effects: reads `process.env.E2E_HERMETIC` at module load.
 */
export const roomPatchSchema = z
  .object({
    selectedVariantIndex: z.number().int().min(0).max(1),
    beforeImageUrl: imageUrlSchema,
    afterImageUrl: imageUrlSchema,
    beforeImageUrl2: imageUrlSchema,
    afterImageUrl2: imageUrlSchema,
    sortOrder: z.number().int().min(0),
  })
  .partial()
  .strict();

/** The validated shape of a room patch request body ({@link roomPatchSchema}). */
export type RoomPatchInput = z.infer<typeof roomPatchSchema>;