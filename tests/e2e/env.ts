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
 *
 * The one deliberate exception (issue #1084): `export-pdf.spec.ts` and
 * `export-pdf-v1.spec.ts` drive the REAL `/api/export-pdf` and
 * `/api/v1/export-pdf` handlers, because the browser-layer pattern
 * cannot cover them — the handler's outbound Browserless fetch runs
 * server-side, where `page.route` cannot reach. That fetch is redirected
 * to a local mock (`mock-browserless.ts`) via the hermetic-gated
 * `E2E_BROWSERLESS_PDF_URL` override, so real Browserless is still never
 * contacted. Specs that only need client-side behavior keep using the
 * browser-layer mock.
 *
 * Note the mock's captured-request log is process-wide and shared across
 * the whole suite run, and specs are sequential (`workers: 1`), so a spec
 * that needs its OWN provider calls must slice the log by a count delta
 * taken before the request — never index from 0.
 */

/**
 * Fixed seed identities so specs can address rows by URL deterministically.
 *
 * Project ids MUST be cuid-shaped (match /^c[a-z0-9]{24}$/) because
 * /api/sign-project (issue #684), /api/export-pdf, and /api/v1/export-pdf
 * all validate `projectId` against Prisma's cuid pattern before any
 * business logic — the previous e2e…-prefixed nanoid-shaped ids would 400
 * before the token/preview checks ran. The dedicated signoff id has been
 * cuid-shaped since #695; #1079 extended the same convention to every
 * other seeded project so export-pdf, rehearsal, and the cascades they
 * unblock (#1084, parts of #1085) can mint a token for the seeded
 * project and assert the 400 path on a separate seed row.
 */
export const E2E_USER_ID = "e2euser0000000000000000000user";
export const E2E_EMAIL = "e2e@stagingstudio.test";
export const E2E_PASSWORD = "e2e-password";

export const E2E_UPLOAD_PROJECT_ID = "cupload000000000000000000";
export const E2E_UPLOAD_ROOM_ID = "e2euploadroom0000000000000room";

export const E2E_EDITOR_PROJECT_ID = "ceditor000000000000000000";
export const E2E_EDITOR_ROOM_ID = "e2eeditorroom00000000000000room";

/**
 * Dedicated room for the concept-flow spec (issue #231). The spec stages
 * real variants into its room, so it must NOT share the editor room the
 * brush/preset specs assert against — specs run alphabetically and share
 * one seeded database per suite run.
 */
export const E2E_CONCEPT_PROJECT_ID = "cconcept00000000000000000";
export const E2E_CONCEPT_ROOM_ID = "e2econceptroom000000000000room";

export const E2E_REHEARSAL_PROJECT_ID = "crehearsal000000000000000";
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
 * The project id is cuid-shaped (matches /^c[a-z0-9]{24}$/, enforced by
 * signProjectRequestSchema, issue #684) because /api/sign-project
 * rejects non-cuid ids with a 400 before the token check ever runs.
 * #1079 brought the other seeded project ids in line with this same
 * convention.
 */
export const E2E_SIGNOFF_PROJECT_ID = "ce2esignoff00000000000000";
export const E2E_SIGNOFF_ROOM_ID = "e2esignoffroom00000000000000room";

/**
 * A cuid-shaped project id that is deliberately NEVER seeded (no matching
 * row in Postgres), for exercising the ownership lookup's 404 branch.
 *
 * Cuid-shaped on purpose: `api/v1/export-pdf` validates `projectId`
 * against /^c[a-z0-9]{24}$/ *before* the ownership lookup, so a
 * malformed id would 400 at validation and never reach the 404 branch
 * this id exists to cover. The 403 (owned-by-another-user) branch is
 * NOT covered by any spec — every seeded project belongs to
 * {@link E2E_USER_ID}, and seeding a second user would need a matching
 * GoTrue identity the mock auth server does not issue.
 */
export const E2E_ABSENT_PROJECT_ID = "cmissing00000000000000000";

/**
 * The daily export cap the harness expects the export routes to apply.
 *
 * `nextEnv()` deliberately leaves `DAILY_EXPORT_LIMIT` unset so the
 * routes fall back to `DEFAULT_DAILY_EXPORT_LIMIT` in
 * `src/lib/api-quota.ts` — this constant MIRRORS that default. It is
 * duplicated (not imported) because no e2e file imports app source, and
 * the duplication is a tripwire rather than a hazard: specs assert the
 * route's own reported `limit` equals this value, so changing the app
 * default fails the suite loudly instead of silently invalidating the
 * quota tests.
 *
 * Used by `withExportUsageAtLimit` (see `quota.ts`) to pin the
 * Postgres-backed `DailyApiUsage` counter at the cap and reach the 429
 * branch, which is otherwise unreachable in a single run.
 */
export const E2E_DAILY_EXPORT_LIMIT = 20;

/**
 * The daily inpaint cap the harness expects `POST /api/inpaint` to apply.
 *
 * Mirrors `DEFAULT_DAILY_INPAINT_LIMIT` in `src/lib/api-quota.ts` for the
 * same reason as {@link E2E_DAILY_EXPORT_LIMIT}: `nextEnv()` leaves
 * `DAILY_INPAINT_LIMIT` unset so the app default applies, and a spec
 * asserting the route's reported `limit` fails loudly if the two drift.
 *
 * Used by `withInpaintUsageAtLimit` (see `quota.ts`) to pin the ledger row
 * at the cap and reach the 429 branch — which, for an inpaint submit,
 * means the request is rejected before fal.ai is contacted (#1131).
 */
export const E2E_DAILY_INPAINT_LIMIT = 20;

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
 * Mock Browserless PDF endpoint (issue #1084).
 *
 * `src/app/api/export-pdf` fetches Browserless from the Next.js SERVER
 * process, which a Playwright `page.route` cannot intercept — only the
 * browser's own requests pass through it. Specs that drive the real route
 * handler point the handler's outbound fetch here instead (via the
 * hermetic-gated `E2E_BROWSERLESS_PDF_URL` override), so the real
 * Browserless API is never contacted.
 */
export const MOCK_BROWSERLESS_PORT = 39931;
export const MOCK_BROWSERLESS_HOST = "127.0.0.1";
export const MOCK_BROWSERLESS_URL = `http://${MOCK_BROWSERLESS_HOST}:${MOCK_BROWSERLESS_PORT}/pdf`;

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
    // Issue #1084: with E2E_HERMETIC=1, the export route's outbound
    // Browserless fetch resolves to the local mock instead of the real
    // paid API. E2E_HERMETIC is the guard that keeps the override inert
    // everywhere else — neither var is set outside this harness.
    E2E_HERMETIC: "1",
    E2E_BROWSERLESS_PDF_URL: MOCK_BROWSERLESS_URL,
    NEXT_PUBLIC_APP_URL: APP_URL,
    PREVIEW_TOKEN_SECRET: "e2e-preview-token-secret",
  };
}
