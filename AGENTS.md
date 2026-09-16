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
npm run build
```

- No test suite, no CI, no formatter config. `next lint` + `next build` are the only checks — run both before finishing a change.
- Prisma uses `db push`, not migrations — there is no `prisma/migrations/` dir and no migration history to maintain.

## Layout

- All code lives under `src/` (Next.js src-dir convention): `src/app`, `src/components`, `src/lib`. The `@/*` import alias maps to `src/*`. `middleware.ts` stays at the repo root, not in `src/`.
- `src/lib/` holds the shared singletons: `prisma.ts`, `supabase.ts` (both client flavors), `ai.ts` (model), `fal.ts` (fal.ai client), `actions.ts`.
- Room/room-photo mutations are server actions in `src/app/actions/` (`"use server"`). Third-party integrations are API routes under `src/app/api/`: `projects` CRUD (+ nested `rooms`), `inpaint` (+ `[requestId]/status` polling), `generate-copy`, `export-pdf`, `setup` (+ `setup/check`).
- `src/components/canvas/` = staging editor UI; `src/components/lookbook/` = printable PDF page components; `src/components/ui/` = shadcn components (`components.json` drives the CLI; all aliases are `@/`-based).

## Routing & auth

- Real URLs: `/` (server-side auth redirector), `/login`, `/setup` (in `(auth)` group), `/dashboard`, `/projects`, `/projects/new`, `/projects/[id]`, `/projects/[id]/preview` (in `(dashboard)` group), `/auth/callback` (route handler, real segment).
- Route-group membership is not uniform: the `/dashboard` page sits OUTSIDE the `(dashboard)` group while `/projects/*` sit inside, and `/auth/callback` is not in `(auth)`. Don't "normalize" this without checking which layout wraps what.
- Auth protection lives entirely in root `middleware.ts` (pathname checks for `/dashboard` and `/projects`), not in folder names. It validates sessions with `supabase.auth.getUser()` (real JWT check, fails closed) and redirects logged-in users away from `/login` and `/setup`. Any new protected route must be added to its pathname guards.
- Redirect targets differ and that's intended: `/` sends authed users to `/projects`; middleware and the auth callback send users to `/dashboard`.
- Middleware refreshes auth cookies on every matched request. Server Components can only read cookies — the try/catch-and-ignore around `cookieStore.set` (see `src/app/page.tsx`) is intentional, not a bug.

## Conventions

- **Supabase clients:** browser code imports `createClient()` from `lib/supabase.ts`. Server code uses `createServerClientSingleton({ getAll, setAll })` from the same file, with the cookie wiring shown in `src/app/page.tsx`. Don't construct Supabase clients elsewhere.
- **Prisma:** import the singleton from `lib/prisma.ts`; never `new PrismaClient()` elsewhere. Dev mode logs all queries.
- **AI services:** the OpenAI model lives in `lib/ai.ts` (`aiModel`, gpt-4o-mini). The fal.ai client is configured once in `lib/fal.ts` via `FAL_KEY` — import `fal` from there.
- **Lookbook/PDF print styling:** `globals.css` provides `.page-break`, `.avoid-break`, `.lookbook-page`, `.no-print`, and `@page` letter-portrait rules. Keep these class names when touching lookbook components or PDF pagination breaks.
- **Fonts:** Cinzel, Playfair Display, Plus Jakarta Sans load in `src/app/layout.tsx` as CSS variables → use Tailwind `font-cinzel` / `font-playfair` / `font-jakarta`.

## Env vars

All in `.env.example`, copied to `.env.local`: `DATABASE_URL` (Supabase Postgres, used by Prisma), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `FAL_KEY`, `BROWSERLESS_API_KEY` (used by `api/export-pdf`).

## Toolchain quirks

- Tailwind v4 runs CSS-first (`@import "tailwindcss"` in `globals.css`) but still loads the legacy JS config via `@config "../../tailwind.config.ts"`; PostCSS uses `@tailwindcss/postcss`. Don't reintroduce v3 `@tailwind` directives.
- `next.config.ts` allowlists remote images only for `*.supabase.co` and `*.fal.ai` — a new image host must be added to `images.remotePatterns` or `next/image` throws.
- shadcn style is `base-nova`; add components via the CLI (`npx shadcn@latest add …`) so `components.json` aliases stay in sync.

## Domain model

`prisma/schema.prisma`: `User` (firm branding + editable page templates) → `Project` (one staging job: address, client, target buyer, aesthetic) → `Room` (two before/after image variants, selected variant index, AI outputs: raw directives, observed challenge, recommendation, buyer psychology, checklist JSON). Deletes cascade down the chain.
