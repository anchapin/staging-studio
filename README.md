# StagingStudio

StagingStudio is an AI-assisted home-staging lookbook generator for Circle G Designs — a single-tenant web app for one interior-design firm. It turns "before" photos of a listing's rooms into AI-staged "after" visuals, writes the matching design copy, and assembles everything into a client-ready, printable PDF lookbook. One workflow carries a staging job from property intake to final export.

## Features / How It Works

The product follows a single end-to-end journey. Each step below names the real route and the `src/` area that implements it.

### 1. Sign in — `/login`

Supabase Auth with a password or magic link (toggle on the login form, `src/app/(auth)/login/page.tsx`). The `/auth/callback` route handler (`src/app/auth/callback/route.ts`) completes the exchange. Route protection for `/dashboard` and `/projects` lives in the root `middleware.ts`; `/` (`src/app/page.tsx`) redirects signed-in visitors to `/projects`.

### 2. First-run firm setup — `/setup`

An authenticated visitor without a `User` row is routed to `/setup`, where the firm's name and logo are captured and stored as the firm's branding record (`src/app/(auth)/setup/`, backed by `src/app/api/setup/route.ts` and `src/app/api/setup/check/route.ts`). Returning users skip straight to the dashboard.

### 3. Dashboard handoff — `/dashboard`

The middleware-protected post-login landing page (`src/app/dashboard/page.tsx`); it redirects to `/projects`.

### 4. Project intake — `/projects` and `/projects/new`

`/projects` lists staging jobs. `/projects/new` is the intake form — property address, client name, target buyer, and staging aesthetic — which creates a `Project` through the ownership-checked server action in `src/app/actions/project.ts` and lands on the new project's workspace. A REST surface for projects and rooms also exists under `src/app/api/projects/` (including nested `[id]` and `[id]/rooms/[roomId]` handlers).

### 5. Staging workspace — `/projects/[id]`

The core editor, one workspace per property with rooms as the unit of work. The UI lives in `src/components/canvas/`; server actions in `src/app/actions/` (`room.ts`, `room-photos.ts`) own all mutations. Per room:

- **Before-photo upload with client-side compression** — images are compressed in the browser (`browser-image-compression` in `room-canvas.tsx`) and stored in Supabase Storage via `src/app/actions/room-photos.ts`, into either of two variant slots.
- **Brush-mask AI staging** — paint a mask over the region to restage (`inpaint-mask-canvas.tsx`) and run fal.ai FLUX.1 Fill inpainting (`POST /api/inpaint`). Each run is persisted as an `InpaintRequest` row, so queued jobs survive serverless deadlines and page refreshes resume polling (`GET /api/inpaint/[requestId]/status` + `use-inpaint-status.ts`).
- **Two selectable variants per room** — each room keeps two before/after pairs (`variant-picker.tsx`, `comparison-slider.tsx`) and a selected-variant index controls which one reaches the PDF.
- **AI room copy** — freeform staging directives are expanded by GPT-4o-mini through the Vercel AI SDK (`generate-copy-form.tsx` → `POST /api/generate-copy`) into an observed challenge, a staging recommendation, buyer-psychology notes, and a prioritized staging checklist.

### 6. Lookbook preview and PDF export — `/projects/[id]/preview`

A printable lookbook composed of cover, philosophy, room-spread, and sign-off pages (`src/components/lookbook/`). `POST /api/export-pdf` renders it with Browserless.io, signing a short-lived preview token (`src/lib/preview-token.ts`) so the cloud browser can fetch the page without session cookies.

### Domain model

`prisma/schema.prisma` chains `User → Project → Room → InpaintRequest` with cascading deletes: a firm (`User`, with branding) owns staging jobs (`Project`), each job holds rooms, and each room holds its two before/after variant pairs, selected variant, AI copy fields, and checklist JSON — plus the inpaint queue requests that track one fal.ai job each (status + durable result URL).

### Route → source map

| Route | Purpose | Implementation |
| --- | --- | --- |
| `/` | Auth redirector (signed in → `/projects`) | `src/app/page.tsx` |
| `/login` | Password / magic-link sign-in | `src/app/(auth)/login/page.tsx` |
| `/auth/callback` | Auth code exchange | `src/app/auth/callback/route.ts` |
| `/setup` | First-run firm branding | `src/app/(auth)/setup/`, `src/app/api/setup/` |
| `/dashboard` | Protected landing (redirects to `/projects`) | `src/app/dashboard/page.tsx`, `middleware.ts` |
| `/projects` | Project list | `src/app/(dashboard)/projects/page.tsx` |
| `/projects/new` | Project intake form | `src/app/(dashboard)/projects/new/page.tsx`, `src/app/actions/project.ts` |
| `/projects/[id]` | Staging workspace (rooms, masks, variants, copy) | `src/app/(dashboard)/projects/[id]/page.tsx`, `src/components/canvas/`, `src/app/actions/`, `src/app/api/inpaint/`, `src/app/api/generate-copy/` |
| `/projects/[id]/preview` | Printable lookbook + PDF export | `src/app/(dashboard)/projects/[id]/preview/page.tsx`, `src/components/lookbook/`, `src/app/api/export-pdf/` |

## Tech Stack

- **Next.js 15** (App Router, TypeScript)
- **Tailwind CSS + shadcn/ui**
- **Supabase** (Postgres + Storage + Auth)
- **Prisma** ORM
- **Vercel AI SDK + GPT-4o-mini** — structured copywriting
- **fal.ai FLUX.1 Fill** — AI inpainting
- **Browserless.io** — PDF export

## Getting Started

Starting from zero? Follow [docs/SUPABASE-SETUP.md](docs/SUPABASE-SETUP.md) first — it walks through creating the Supabase project, email auth (password + magic link) with the `/auth/callback` redirect, the `room-photos`/`logos` storage buckets, where each service key comes from, and the first-run flow, so the commands below actually work.

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Fill in your API keys

# Push Prisma schema to database
npx prisma db push

# Start development server
npm run dev
```

`.env.example` annotates every key with its reader and source. After editing `prisma/schema.prisma`, regenerate the client with `npm run db:generate` (the project uses `db push`, not migrations).

> **Heads-up: PDF export is the one feature that does not work on plain `localhost`.** Browserless.io's cloud Chrome has to fetch the lookbook preview page over the public internet, and it rejects local URLs outright — export fails with a 403 `Navigation … is not allowed`. The fix is a public tunnel:
>
> 1. Install a prerequisite (one-time): [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) (no account) or [ngrok](https://ngrok.com/download) (free account + authtoken).
> 2. Run `scripts/dev-tunnel.sh` — it starts the tunnel and points `NEXT_PUBLIC_APP_URL` in `.env.local` at the public URL.
> 3. Restart `npm run dev` (the variable is read at server boot), then export normally. `scripts/dev-tunnel.sh reset` restores the localhost default when you're done.
>
> Login, projects, upload, inpainting, and AI copy all work locally without a tunnel. Details in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

Deploying to production? See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — every env var to configure, plus why `NEXT_PUBLIC_APP_URL` must be publicly reachable for PDF export.

## Development

```bash
npm run lint        # eslint .
npm run typecheck   # tsc --noEmit
npm test            # vitest run (tests live in tests/)
npm run e2e         # Playwright browser suite (tests/e2e) — see below
npm run build       # production build
npm run db:studio   # Prisma Studio
```

## End-to-end browser suite (issue #165)

`npm run e2e` runs a hermetic Playwright harness (`tests/e2e/`) against a production build of the app. It covers the staging flows the PoC browser driver could not reliably automate — real trusted mouse events painting the mask canvas (asserted by sampling white coverage in the actual `POST /api/inpaint` body), `setInputFiles` uploads (asserted byte-identical against what storage received), and a scripted rehearsal drill (login → project → upload → inpaint → copy → export) plus the #163 failure drills (terminal inpaint error, export outage → error reveal with retry).

**Hermeticity:** no real credentials or paid services. A local mock Supabase (`tests/e2e/mock-supabase.ts`) serves GoTrue auth (self-signed JWTs) and Storage (hashes every stored object); Postgres runs in a disposable Docker container that global setup creates, pushes the schema to, and seeds with fixed rows; fal.ai, OpenAI, and Browserless are simulated by intercepting their API routes at the browser network layer, so the dummy API keys are never exercised.

**Requirements:** Docker (for the throwaway Postgres) and Playwright browsers (`npx playwright install chromium`).

```bash
npm run e2e          # headless run (single worker — deterministic)
npm run e2e:headed   # watch it drive the real UI
```

Artifacts (traces/screenshots on failure, HTML report) land in `test-results/` and `playwright-report/`, both gitignored.

See [issues](../../issues) for the full development roadmap.
