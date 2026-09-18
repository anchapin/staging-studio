/**
 * Shared constants for the Playwright e2e harness (issue #165).
 *
 * Single source of truth for every local endpoint the harness needs, so
 * `playwright.config.ts`, the global setup/teardown, the mock Supabase
 * server, and the specs all agree without env-file coupling.
 *
 * Hermeticity contract: the suite NEVER talks to real Supabase, fal.ai,
 * OpenAI, or Browserless. Supabase auth + storage are served by a local
 * mock (`mock-supabase.ts`), Postgres runs in a disposable Docker
 * container, and every paid-provider API route (`/api/inpaint`,
 * `/api/generate-copy`, `/api/export-pdf`) is intercepted at the browser
 * network layer with Playwright route handlers. The provider API keys in
 * `nextEnv()` are dummy strings — the routes that would use them are
 * never actually invoked.
 */

/** Fixed seed identities so specs can address rows by URL deterministically. */
export const E2E_USER_ID = "e2euser0000000000000000000user";
export const E2E_EMAIL = "e2e@stagingstudio.test";
export const E2E_PASSWORD = "e2e-password";

export const E2E_UPLOAD_PROJECT_ID = "e2euploadproject0000000000proj";
export const E2E_UPLOAD_ROOM_ID = "e2euploadroom0000000000000room";

export const E2E_EDITOR_PROJECT_ID = "e2eeditorproject000000000proj";
export const E2E_EDITOR_ROOM_ID = "e2eeditorroom00000000000000room";

export const E2E_REHEARSAL_PROJECT_ID = "e2erehearsalproject0000000proj";
export const E2E_REHEARSAL_ROOM_ID = "e2erehearsalroom0000000000room";

/** Port/host for the mock Supabase (GoTrue auth + Storage). */
export const MOCK_SUPABASE_PORT = 39911;
export const MOCK_SUPABASE_HOST = "127.0.0.1";
export const MOCK_SUPABASE_URL = `http://${MOCK_SUPABASE_HOST}:${MOCK_SUPABASE_PORT}`;

/** Port/host for the app under test (production build via `next start`). */
export const APP_PORT = 39901;
export const APP_HOST = "127.0.0.1";
export const APP_URL = `http://${APP_HOST}:${APP_PORT}`;

/** Disposable Postgres for Prisma, run in Docker (see global-setup). */
export const POSTGRES_PORT = 39921;
export const POSTGRES_CONTAINER_NAME = "staging-studio-e2e-pg";
export const POSTGRES_IMAGE = "postgres:16-alpine";
export const DATABASE_URL = `postgresql://e2e:e2e@127.0.0.1:${POSTGRES_PORT}/staging_studio_e2e`;

/**
 * Fake "fal.ai" staged-result URL persisted after a completed inpaint.
 *
 * Must satisfy the app's real `roomPatchSchema` (https + `*.supabase.co`),
 * so it uses a fixture hostname that does not exist. Real pixels reach the
 * browser anyway: helpers intercept `/_next/image` for this host and
 * fulfill with the local fixture PNG (the optimizer itself is never
 * invoked because the request never leaves the browser).
 */
export const STAGED_RESULT_PUBLIC_URL =
  "https://e2e-fixture.supabase.co/storage/v1/object/public/staged-results/e2e-staged.png";

/** Host marker used to detect staged-fixture requests inside `/_next/image`. */
export const STAGED_RESULT_HOST = "e2e-fixture.supabase.co";

/**
 * Public URL the harness uses for room photos: the mock storage serves
 * uploaded bytes under the standard Supabase public-object path.
 */
export function roomPhotoPublicUrl(storagePath: string): string {
  return `${MOCK_SUPABASE_URL}/storage/v1/object/public/room-photos/${storagePath}`;
}

/**
 * Issue #228: SAM 3.1 concept-tool kill switch FOR THE E2E BUILD ONLY.
 *
 * The editor now auto-fires a REAL `furniture` detection against
 * `/api/segment/furnishings` when it opens. Only two specs in this suite
 * intercept that route (the preset flow's), so with the tool enabled the
 * auto-fire would reach the real route handler — and through it fal.ai —
 * in every other editor-opening spec, breaking hermeticity. Compiling the
 * tool OFF for the app under test (via `nextEnv()` inlining
 * NEXT_PUBLIC_SAM_TOOL_ENABLED=false) keeps the whole suite hermetic; the
 * two point-SAM specs in `mask-paint.spec.ts` skip on this constant (they
 * assert the removed `warm: true` ping anyway).
 *
 * Issue #231 lands the `fal-ai/sam-3-1/image` interception and the
 * replacement concept-tool specs: flip this to `true` and remove the
 * skip guards in the same change.
 */
export const SAM_TOOL_ENABLED_IN_E2E_BUILD = false;

/**
 * Environment for the Next.js build + server started by Playwright's
 * `webServer`. NEXT_PUBLIC_* values are inlined at build time, so the
 * mock Supabase URL must be set here, not in a shell.
 */
export function nextEnv(): Record<string, string> {
  return {
    DATABASE_URL,
    NEXT_PUBLIC_SUPABASE_URL: MOCK_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "e2e-anon-key",
    OPENAI_API_KEY: "e2e-dummy-openai-key",
    FAL_KEY: "e2e-dummy-fal-key",
    BROWSERLESS_API_KEY: "e2e-dummy-browserless-key",
    NEXT_PUBLIC_APP_URL: APP_URL,
    PREVIEW_TOKEN_SECRET: "e2e-preview-token-secret",
    // Kill switch for the concept tool in the app under test — see
    // SAM_TOOL_ENABLED_IN_E2E_BUILD above.
    NEXT_PUBLIC_SAM_TOOL_ENABLED: SAM_TOOL_ENABLED_IN_E2E_BUILD ? "true" : "false",
  };
}
