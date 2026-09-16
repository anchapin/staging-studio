# AGENTS.md

StagingStudio — AI-assisted home staging lookbook generator for Circle G Designs (single tenant, one firm). Next.js 15 App Router + TypeScript, Supabase (auth + Postgres + storage), Prisma, Vercel AI SDK (GPT-4o-mini copywriting), fal.ai FLUX.1 Fill (inpainting), Browserless.io (PDF export).

## Commands

```bash
cp .env.example .env.local   # required before dev; all keys listed under "Env vars"
npm install                  # package-lock.json is committed
npx prisma db push           # run once before dev; schema-first workflow
npm run dev
npm run db:generate          # after editing prisma/schema.prisma (regenerates client)
npm run db:studio
npm run lint                 # next lint (eslint 9 flat config)
npm run typecheck            # tsc --noEmit
npm test                     # vitest run (tests live in tests/)
npm run build
```

- No CI, no formatter config. Run lint, typecheck, and build (and `npm test` if you touched logic with tests) before finishing a change.
- Prisma uses `db push`, not migrations — there is no `prisma/migrations/` dir and no migration history to maintain.

## Layout

- All code lives under `src/` (Next.js src-dir convention): `src/app`, `src/components`, `src/lib`. The `@/*` import alias maps to `src/*`. `middleware.ts` stays at the repo root, not in `src/`.
- `src/lib/` holds the shared singletons: `prisma.ts`, `supabase.ts` (browser client, server singleton, and the request-scoped `createSupabaseRequestClient()` factory), `ai.ts` (model), `fal.ts` (fal.ai client) — plus `api-auth.ts` (session → Prisma `User` helper), `env.ts` (call-time env validation), and pure logic modules (`checklist-schema.ts`, `room-patch-schema.ts`, `ai-route-schemas.ts`, `inpaint-polling.ts`, `inpaint-persistence.ts`, `auth-redirect.ts`, `preview-token.ts` (HMAC-signed PDF-preview tokens), `canvas-coords.ts`).
- Room/room-photo/Project mutations are server actions in `src/app/actions/` (`"use server"`; all ownership-checked). Tests live in `tests/` (vitest, node env). Third-party integrations are API routes under `src/app/api/`: `projects` CRUD (+ nested `rooms`), `inpaint` (+ `[requestId]/status` polling), `generate-copy`, `export-pdf`, `setup` (+ `setup/check`).
- `src/components/canvas/` = staging editor UI; `src/components/lookbook/` = printable PDF page components; `src/components/ui/` = shadcn components (`components.json` drives the CLI; all aliases are `@/`-based).

## Routing & auth

- Real URLs: `/` (server-side auth redirector), `/login`, `/setup` (in `(auth)` group), `/dashboard`, `/projects`, `/projects/new`, `/projects/[id]`, `/projects/[id]/preview` (in `(dashboard)` group), `/auth/callback` (route handler, real segment).
- Route-group membership is not uniform: the `/dashboard` page sits OUTSIDE the `(dashboard)` group while `/projects/*` sit inside, and `/auth/callback` is not in `(auth)`. Don't "normalize" this without checking which layout wraps what.
- Auth protection lives in root `middleware.ts` (pathname checks for `/dashboard` and `/projects`), not in folder names. It validates sessions with `supabase.auth.getUser()` (real JWT check, fails closed) and redirects logged-in users away from `/login` and `/setup`. Any new protected route must be added to its pathname guards. Middleware does NOT guard `/api/*` — API routes and server actions enforce sessions and ownership themselves (via `src/lib/api-auth.ts`); every new mutation endpoint must do the same.
- Redirect targets differ and that's intended: `/` sends authed users to `/projects`; middleware and the auth callback send users to `/dashboard`.
- Middleware refreshes auth cookies on every matched request. Server Components can only read cookies — the try/catch-and-ignore around `cookieStore.set` (see `src/app/page.tsx`) is intentional, not a bug.

## Conventions

- **Supabase clients:** browser code imports `createClient()` from `lib/supabase.ts`. Server code uses `createServerClientSingleton({ getAll, setAll })` from the same file, with the cookie wiring shown in `src/app/page.tsx`; route handlers and server actions use the request-scoped `createSupabaseRequestClient()` from the same file. Don't construct Supabase clients elsewhere.
- **Prisma:** import the singleton from `lib/prisma.ts`; never `new PrismaClient()` elsewhere. Dev mode logs all queries.
- **AI services:** the OpenAI model lives in `lib/ai.ts` (`aiModel`, gpt-4o-mini). The fal.ai client is configured once in `lib/fal.ts` via `FAL_KEY` — import `fal` from there.
- **Lookbook/PDF print styling:** `src/app/globals.css` provides `.page-break`, `.avoid-break`, `.lookbook-page`, `.no-print`, and `@page` letter-portrait rules. Keep these class names when touching lookbook components or PDF pagination breaks.
- **Fonts:** Cinzel, Playfair Display, Plus Jakarta Sans load in `src/app/layout.tsx` as CSS variables → use Tailwind `font-cinzel` / `font-playfair` / `font-jakarta`.

## Env vars

All in `.env.example`, copied to `.env.local` — every key below is annotated there with reader, source, and required/optional status:

- `DATABASE_URL` — required. Supabase Postgres connection string, used by Prisma (`prisma/schema.prisma` datasource).
- `NEXT_PUBLIC_SUPABASE_URL` — required. Supabase project URL; read by `middleware.ts`, `lib/supabase.ts`, `api/setup*`, `auth/callback`. Source: Supabase dashboard → Project Settings → API.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — required. Anon public key (browser-safe by design), read wherever the project URL is. Same source.
- `SUPABASE_SERVICE_ROLE_KEY` — reserved, not read by any code today; do not distribute unless you add server-side admin usage. Keep server-side only if ever used.
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
