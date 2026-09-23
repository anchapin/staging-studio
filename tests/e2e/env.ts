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

/**
 * Dedicated room for the concept-flow spec (issue #231). The spec stages
 * real variants into its room, so it must NOT share the editor room the
 * brush/preset specs assert against — specs run alphabetically and share
 * one seeded database per suite run.
 */
export const E2E_CONCEPT_PROJECT_ID = "e2econceptproject00000000proj";
export const E2E_CONCEPT_ROOM_ID = "e2econceptroom000000000000room";

export const E2E_REHEARSAL_PROJECT_ID = "e2erehearsalproject0000000proj";
export const E2E_REHEARSAL_ROOM_ID = "e2erehearsalroom0000000000room";

/**
 * Second rehearsal room WITH seeded AI copy (issue #250): the lookbook
 * edit spec edits/persists prose and checklist rows against it, while
 * the original rehearsal room stays copy-less for the generate-once
 * flow.
 */
export const E2E_LOOKBOOK_ROOM_ID = "e2elookbookroom00000000000room";

/**
 * Dedicated unsigned project for the client signoff spec (issue #695).
 * The project id is deliberately cuid-shaped (matches the
 * /^c[a-z0-9]{24}$/ pattern signProjectRequestSchema enforces, issue
 * #684) — /api/sign-project would reject the e2e…-prefixed seed ids
 * with a 400 before the token check ever runs.
 */
export const E2E_SIGNOFF_PROJECT_ID = "ce2esignoff00000000000000";
export const E2E_SIGNOFF_ROOM_ID = "e2esignoffroom00000000000000room";

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
 * Uses MOCK_SUPABASE_URL so the next/image optimizer can fetch it
 * server-side (dangerouslyAllowLocalIP=true in next.config; the hostname
 * resolves to 127.0.0.1). The browser intercepts `/_next/image` via
 * STAGED_RESULT_HOST and fulfills with fixture bytes when the URL contains
 * the fixture host; otherwise the mock storage serves the registered object.
 */
export const STAGED_RESULT_PUBLIC_URL =
  `${MOCK_SUPABASE_URL}/storage/v1/object/public/staged-results/e2e-staged.png`;

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
  };
}
