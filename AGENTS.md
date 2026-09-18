# AGENTS.md

StagingStudio — AI-assisted home staging lookbook generator for Circle G Designs (single tenant, one firm). Next.js 16 App Router + TypeScript, Supabase (auth + Postgres + storage), Prisma, Vercel AI SDK (`ai` + `@ai-sdk/openai`, GPT-4o-mini copywriting), fal.ai FLUX.1 Fill (inpainting), Browserless.io (PDF export).

## Commands

```bash
cp .env.example .env.local   # required before dev; all keys listed under "Env vars"
ln -s .env.local .env        # required before Prisma CLI commands (see env-file note below)
npm install                  # package-lock.json is committed; postinstall runs `prisma generate`
npm run db:push              # run once before dev; schema-first workflow
npm run dev
npm run db:generate          # after editing prisma/schema.prisma (regenerates client)
npm run db:studio
npm run lint                 # eslint . (eslint 9 flat config; `next lint` was removed in Next 16.3.5)
npm run typecheck            # tsc --noEmit
npm test                     # vitest run (tests live in tests/)
npx vitest run tests/auth-redirect.test.ts   # single test file
npm run e2e                  # hermetic Playwright browser suite; needs Docker (see Testing)
npm run build
```

- No CI, no formatter config. Run lint, typecheck, and build (and `npm test` if you touched logic with tests) before finishing a change.
- Prisma uses `db push`, not migrations — there is no `prisma/migrations/` dir and no migration history to maintain.
- Prisma CLI (`db push`, `db studio`, `migrate`) loads env vars only from `.env` — it does NOT read Next.js's `.env.local`. Keep a `.env → .env.local` symlink (both names gitignored) so Prisma and Next.js share one source of truth; without it, `npx prisma db push` fails with `Environment variable not found: DATABASE_URL` even when `.env.local` is fully populated.

## Shell environment (rtk)

- **The `rtk ` prefix on shell commands is injected, not typed.** A global opencode plugin (`~/.config/opencode/plugins/rtk.ts`) intercepts every bash command before execution and runs it through `rtk rewrite`, which rewrites recognized commands to run under the rtk token-saving proxy (binary at `~/.local/bin/rtk`). Seeing `rtk git status` echoed in tool output when you wrote `git status` is expected — don't "correct" the command, don't add or strip the prefix yourself, and never treat the plugin as a repo problem to fix (it's user-global config, not project code).
- **Rewrites can change shape, not just prepend.** Observed with this install: `npm run lint` → `rtk lint`, `cat f` → `rtk read f`, `npx vitest run tests/auth-redirect.test.ts` → `rtk vitest tests/auth-redirect.test.ts`, `npx prisma db push` → `rtk prisma db push`. Not everything is rewritten — `npm test` passes through raw. Rules live in rtk's internal registry; preview any rewrite with `rtk rewrite '<cmd>'`.
- **Output is filtered before you see it** (60–90% smaller): `git status`/`diff`/`log` compacted, test runners show failures only (passing tests collapse to a count), `ls` becomes a file-count tree, `grep`/`rg` group matches by file. Absence of output is not evidence of absence: a green `rtk npm run e2e` may show just `ok`, missing warnings ≠ no warnings, and Playwright failure tracebacks are trimmed (full artifacts land in `test-results/`). When compact output looks suspicious or you need exact raw output, prefix the command with `rtk proxy` (`rtk proxy npm run e2e`) or add rtk's `-v` flag.
- **rtk meta commands:** `rtk --version` (verify binary), `rtk rewrite '<cmd>'` (preview rewrite), `rtk gain` (savings stats), `rtk proxy <cmd>` (run unfiltered).

## Testing

- Two runners, deliberately split: vitest owns pure-logic unit tests (`tests/*.test.ts`; its config excludes `tests/e2e/**`), Playwright owns browser specs (`tests/e2e/specs/`: `mask-paint`, `upload`, `rehearsal`). Don't move specs between them.
- `npm run e2e` is hermetic — no real credentials or paid services. Playwright global setup spins up a throwaway Dockerized Postgres (pushes schema, seeds fixed rows) plus a local mock Supabase (GoTrue auth + Storage), and fal.ai / OpenAI / Browserless calls are intercepted at the network layer, so the dummy API keys are never exercised. Runs against a production build, single worker for determinism. Requires Docker and `npx playwright install chromium`. Run it when touching upload/inpaint/export flows. Failure artifacts land in `test-results/` and `playwright-report/` (both gitignored).

## Layout

- All code lives under `src/` (Next.js src-dir convention): `src/app`, `src/components`, `src/lib`. The `@/*` import alias maps to `src/*`. `middleware.ts` stays at the repo root, not in `src/`.
- `src/lib/` holds the shared singletons: `prisma.ts`, `supabase.ts` (browser client, server singleton, and the request-scoped `createSupabaseRequestClient()` factory), `ai.ts` (model), `fal.ts` (fal.ai client), `browserless.ts` (PDF-export client) — plus `api-auth.ts` (session → Prisma `User` helper), `env.ts` (call-time env validation), and ~21 pure logic modules (`auth-redirect.ts`, `preview-token.ts` (HMAC preview tokens), `checklist-schema.ts`, `room-patch-schema.ts`, `settings-schema.ts`, `ai-route-schemas.ts`, `inpaint-polling.ts`, `inpaint-persistence.ts`, `inpaint-source.ts`, `mask-coverage.ts`, `mask-flood-fill.ts`, `staged-result.ts`, `focus-mode.ts`, `prompts.ts`, `lookbook-pillars.ts`, `error-classify.ts`, `dashboard-data.ts`, `project-fetch-state.ts`, `login-error.ts`, `no-object-error.ts`, `canvas-coords.ts`). Pattern: extract pure logic into `src/lib/<name>.ts` and pin it with a 1:1 `tests/<name>.test.ts` (a few test names differ, e.g. `generate-copy-request-schema.test.ts` pins `ai-route-schemas.ts`).
- Project/room/room-photo/settings mutations are server actions in `src/app/actions/` (`project.ts`, `room.ts`, `room-photos.ts`, `settings.ts`; `"use server"`; all ownership-checked). Third-party integrations are API routes under `src/app/api/`: `projects` CRUD (+ nested `projects/[id]/rooms/[roomId]`), `inpaint` (+ `[requestId]/status` polling), `generate-copy`, `export-pdf`, `setup` (+ `setup/check`), and `debug-preview-check` (preview-token self-test, for debugging exports).
- `src/components/canvas/` = staging editor UI; `src/components/dashboard/` = dashboard chrome (e.g. sign-out button); `src/components/lookbook/` = printable PDF page components; `src/components/ui/` = shadcn components (`components.json` drives the CLI; all aliases are `@/`-based).
- Ops/demo material lives outside `src/`: `docs/` (`DEPLOYMENT.md`, `SUPABASE-SETUP.md`, `DEMO_SCRIPT.md`, `demo/` with the rehearsal runbook) and `scripts/rehearsal-drill.sh` (pre-demo assertions against the live `PROD_URL` deploy — unrelated to the Playwright e2e suite).

## Routing & auth

- Real URLs: `/` (server-side auth redirector), `/login`, `/setup` (in `(auth)` group), `/dashboard`, `/settings`, `/projects`, `/projects/new`, `/projects/[id]` (in `(dashboard)` group), `/preview/[id]` (in `(print)` group — standalone cookie-less print route that Browserless fetches for PDF export), `/auth/callback` (route handler, real segment).
- Route-group membership is not uniform: the `/dashboard` page sits OUTSIDE the `(dashboard)` group while `/projects/*` and `/settings` sit inside, and `/auth/callback` is not in `(auth)`. Don't "normalize" this without checking which layout wraps what.
- Auth protection lives in root `middleware.ts`, not in folder names, and the redirect rules are centralized in `src/lib/auth-redirect.ts` (`resolveAuthRedirect`, pinned by `tests/auth-redirect.test.ts`). It validates sessions with `supabase.auth.getUser()` (real JWT check, fails closed). Protected prefixes are `/dashboard`, `/projects`, and `/settings`; unauthenticated → `/login`, authenticated on `/login` → `/dashboard`. Guards use `startsWith` prefix matching (so `/projectsXYZ` counts as protected) — surprising but pinned by tests; don't "fix" it. `/setup` passes through in BOTH directions: middleware runs on the edge runtime and cannot consult Postgres, so the setup page self-guards server-side (`resolveSetupPageTarget`) — an authenticated user WITHOUT a Prisma `User` row must still reach setup instead of dead-ending. Any new protected route must be added to `resolveAuthRedirect` (and its test). Middleware does NOT guard `/api/*` — API routes and server actions enforce sessions and ownership themselves (via `src/lib/api-auth.ts`); every new mutation endpoint must do the same.
- Redirect targets differ and that's intended: `/` sends authed users to `/projects`; middleware and the auth callback send users to `/dashboard`. The auth callback fails SAFE: a Prisma lookup error still lands on `/dashboard`, where the dashboard layout bounces row-less users to `/setup`.
- Lookbook preview access is token-based, not session-based: `api/export-pdf` mints a 5-minute HMAC token (`lib/preview-token.ts`) scoped to one projectId and appends it to the preview URL; the print page verifies it itself and 404s on invalid/expired/mismatched tokens. Sign/verify use Web Crypto (`crypto.subtle`), NOT `node:crypto` — required because middleware runs on the Edge runtime. Respect that constraint for any new crypto in middleware-path code.
- Middleware refreshes auth cookies on every matched request. Server Components can only read cookies — the try/catch-and-ignore around `cookieStore.set` (see `src/app/page.tsx`) is intentional, not a bug.

## Conventions

- **Supabase clients:** browser code imports `createClient()` from `lib/supabase.ts`. Server code uses `createServerClientSingleton({ getAll, setAll })` from the same file, with the cookie wiring shown in `src/app/page.tsx`; route handlers and server actions use the request-scoped `createSupabaseRequestClient()` from the same file. Don't construct Supabase clients elsewhere.
- **Prisma:** import the singleton from `lib/prisma.ts`; never `new PrismaClient()` elsewhere. Dev mode logs all queries.
- **AI services:** the OpenAI model lives in `lib/ai.ts` (`aiModel`, gpt-4o-mini, plus `assertOpenAIConfigured()` for call-time env checks). The fal.ai client is configured once in `lib/fal.ts` via `FAL_KEY` — import `fal` from there (`assertFalConfigured()` for call-time checks).
- **Lookbook/PDF print styling:** `src/app/globals.css` provides `.page-break`, `.avoid-break`, `.lookbook-page`, `.no-print`, and `@page` letter-portrait rules. Keep these class names when touching lookbook components or PDF pagination breaks.
- **Fonts:** Cinzel, Playfair Display, Plus Jakarta Sans load in `src/app/layout.tsx` as CSS variables → use Tailwind `font-cinzel` / `font-playfair` / `font-jakarta`.

## Env vars

All in `.env.example`, copied to `.env.local` (with `.env` symlinked to it — see the env-file note under Commands) — every key below is annotated there with reader, source, and required/optional status:

- `DATABASE_URL` — required. Supabase Postgres connection string, used by Prisma (`prisma/schema.prisma` datasource).
- `NEXT_PUBLIC_SUPABASE_URL` — required. Supabase project URL; read by `middleware.ts`, `lib/supabase.ts`, `api/setup*`, `auth/callback`. Source: Supabase dashboard → Project Settings → API.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — required. Anon public key (browser-safe by design), read wherever the project URL is. Same source.
- `SUPABASE_SERVICE_ROLE_KEY` — reserved, not read by any code today (its name appears in `env.ts` only inside the error-message help table, not as a consumed variable); do not distribute unless you add server-side admin usage. Keep server-side only if ever used.
- `OPENAI_API_KEY` — required. Read by `lib/ai.ts` (call-time check) for gpt-4o-mini lookbook copy. Source: platform.openai.com → API keys.
- `FAL_KEY` — required. Read by `lib/fal.ts` (throws at import when missing) for FLUX.1 Fill inpainting. Source: fal.ai dashboard → keys.
- `BROWSERLESS_API_KEY` — required for PDF export. Read by `api/export-pdf` (500 error when missing). Source: browserless.io → account API keys.
- `NEXT_PUBLIC_APP_URL` — the app's public origin (not a PDF-export-only value); read by `api/export-pdf` to build the cookie-less preview URL its cloud browser fetches. Dev fallback `http://localhost:3000`; required and must be publicly reachable in production.
- `PREVIEW_TOKEN_SECRET` — optional in dev (fixed public fallback when unset), required in production. HMAC-signs short-lived lookbook-preview tokens (`lib/preview-token.ts`); generate with `openssl rand -base64 32`.

## Toolchain quirks

- Tailwind v4 runs CSS-first (`@import "tailwindcss"` in `globals.css`) but still loads the legacy JS config via `@config "../../tailwind.config.ts"`; PostCSS uses `@tailwindcss/postcss`. Don't reintroduce v3 `@tailwind` directives.
- `next.config.ts` allowlists remote images only for `*.supabase.co` and `*.fal.ai` — a new image host must be added to `images.remotePatterns` or `next/image` throws.
- shadcn style is `base-nova`; add components via the CLI (`npx shadcn@latest add …`) so `components.json` aliases stay in sync.

## Domain model

`prisma/schema.prisma`: `User` (firm branding + editable page templates) → `Project` (one staging job: address, client, target buyer, aesthetic) → `Room` (two before/after image variants, selected variant index, AI outputs: raw directives, observed challenge, recommendation, buyer psychology, checklist JSON) → `InpaintRequest` (fal.ai queue request mapped to a room + variant slot; status and durable result URL; cascade-deleted with its room). Deletes cascade down the chain.
