import * as fal from "@fal-ai/serverless-client";
import { requireEnvVars } from "@/lib/env";

fal.config({
  credentials: process.env.FAL_KEY,
});

/**
 * Configured fal.ai serverless client (namespace re-export).
 *
 * Purpose: the single sanctioned fal.ai entry point. Import `fal` from
 * `@/lib/fal` (see `api/inpaint` for FLUX.1 Fill queue usage); never
 * import `@fal-ai/serverless-client` directly.
 *
 * Side effects at module load: calls `fal.config({ credentials:
 * process.env.FAL_KEY })` — importing this module therefore binds the
 * global fal.ai credentials. If `FAL_KEY` is unset, the client is
 * created unauthenticated and requests fail later; call
 * `assertFalConfigured()` before enqueueing work to fail fast with a
 * clear message. fal.ai result URLs are served from `*.fal.ai`, which is
 * already allowlisted in `next.config.ts` `images.remotePatterns`.
 */
export { fal };

/**
 * Asserts that the fal.ai provider is usable before enqueueing work.
 *
 * Purpose: preflight guard for inpainting routes — throws
 * `MissingEnvVarsError` naming `FAL_KEY` if it is unset or blank.
 *
 * Side effects: reads `process.env.FAL_KEY`; throws when missing.
 */
export function assertFalConfigured(): void {
  requireEnvVars("FAL_KEY");
}
