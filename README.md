# StagingStudio

StagingStudio is an AI-assisted home-staging lookbook generator for Circle G Designs — a single-tenant web app for one interior-design firm. It turns "before" photos of a listing's rooms into AI-staged "after" visuals, writes the matching design copy, and assembles everything into a client-ready, printable PDF lookbook. One workflow carries a staging job from property intake to final export.

## Features / How It Works

The product follows a single end-to-end journey. Each step below names the real route and the `src/` area that implements it.

### 1. Sign in — `/login`

Supabase Auth with a password or magic link (toggle on the login form, `src/app/(auth)/login/page.tsx`). The `/auth/callback` route handler (`src/app/auth/callback/route.ts`) completes the exchange. Route protection for `/dashboard`, `/projects`, and `/settings` lives in the root `middleware.ts`; `/` (`src/app/page.tsx`) redirects signed-in visitors to `/projects`.

### 2. First-run firm setup — `/setup`

An authenticated visitor without a `User` row is routed to `/setup`, where the firm's name and logo are captured and stored as the firm's branding record (`src/app/(auth)/setup/`, backed by `src/app/api/setup/route.ts` and `src/app/api/setup/check/route.ts`). Returning users skip straight to the dashboard.

### 3. Dashboard handoff — `/dashboard`

The middleware-protected post-login landing page (`src/app/dashboard/page.tsx`); it redirects to `/projects`.

### 4. Project intake — `/projects` and `/projects/new`

`/projects` lists staging jobs. `/projects/new` is the intake form — property address, client name, target buyer, and a staging aesthetic chosen from curated staging packages (`src/components/packages/staging-package-card.tsx`, validated by `lib/staging-packages-schema.ts`) — which creates a `Project` through the ownership-checked server action in `src/app/actions/project.ts` and lands on the new project's workspace. A REST surface for projects and rooms also exists under `src/app/api/projects/` (including nested `[id]` and `[id]/rooms/[roomId]` handlers).

### 5. Staging workspace — `/projects/[id]`

The core editor, one workspace per property with rooms as the unit of work. The per-room studio lives at `/projects/[id]/rooms` (refinement continues on `/projects/[id]/refine`, `?room=`-scoped). The UI lives in `src/components/canvas/`; server actions in `src/app/actions/` (`room.ts`, `room-photos.ts`, `room-batch.ts`) own all mutations. Per room:

- **Batch room upload** — create every room of a property in one pass (`batch-room-upload.tsx` → `createRoomsBatch` / `getBatchRoomUploadUrls` in `room-batch.ts`), with AI room-type detection from the uploaded photos (`detectBatchRoomTypes`).
- **Before-photo upload with client-side compression** — images are compressed in the browser (`browser-image-compression` in `room-canvas.tsx`) and stored in Supabase Storage via `src/app/actions/room-photos.ts`, into either of two variant slots.
- **Brush-mask AI staging** — paint a mask over the region to restage (`inpaint-mask-canvas.tsx`) and run fal.ai FLUX.1 Fill inpainting (`POST /api/inpaint`). Each run is persisted as an `InpaintRequest` row, so queued jobs survive serverless deadlines and page refreshes resume polling (`GET /api/inpaint/[requestId]/status` + `use-inpaint-status.ts`).
- **SAM auto-segmentation** — masks don't have to be painted by hand: `POST /api/segment` turns a click on the photo into a furnishing-accurate mask (fal.ai SAM, model id in `lib/segment-mask.ts`, results cached by image hash in `lib/segment-cache.ts`), and `POST /api/segment/furnishings` returns the furnishings SAM 3.1 detects in the room. Both calls are synchronous, daily-capped routes (`DAILY_SEGMENT_LIMIT` via `lib/api-quota.ts`).
- **Vision label instances** — `POST /api/label-instances` runs GPT-4o-mini vision over the photo and persists per-furnishing labels as `VisionLabel` rows (`lib/vision-labels.ts`); the inspector (`inspector-collapsed-rail.tsx`, hit-testing via `lib/instance-hit-test.ts`) makes each labeled furnishing clickable, so you can select exactly the pieces to restage. Capped by `DAILY_LABEL_LIMIT`.
- **Inpaint version history** — staged results are saved as restorable `InpaintVersion` snapshots (`src/app/actions/inpaint-versions.ts`), browsed and restored from `version-history-panel.tsx`, so refinements never destroy an earlier take.
- **Two selectable variants per room** — each room keeps two before/after pairs (`variant-thumbnail-strip.tsx`, `comparison-slider.tsx`) and a selected-variant index controls which one reaches the PDF.
- **AI room copy** — freeform staging directives are expanded by GPT-4o-mini through the Vercel AI SDK (`generate-copy-form.tsx` → `POST /api/generate-copy`) into an observed challenge, a staging recommendation, buyer-psychology notes, and a prioritized staging checklist.

### 6. Lookbook editor — `/projects/[id]/lookbook`

The interactive lookbook assembles the client-facing document from `src/components/lookbook/`: cover, philosophy, room spreads, buyer persona, ROI metrics (`roi-metrics-dashboard.tsx`), a material-swatch page for finish and palette references (`MaterialSwatch` rows via `src/app/actions/material-swatch.ts`), a furniture procurement table (`ProcurementItem` rows via `src/app/actions/procurement.ts`), an investment summary, and the sign-off page. A client-facing consultation report with a before/after comparison slider lives at `/projects/[id]/report`.

### 7. Client sign-off and PDF export — `/preview/[id]`

`POST /api/export-pdf` renders the lookbook with Browserless.io, signing a short-lived preview token (`lib/preview-token.ts`) so the cloud browser can fetch the cookie-less print page at `/preview/[id]` without a session. The same token gates client digital sign-off: on the sign-off page the client draws a signature (`signature-canvas.tsx`) and `POST /api/sign-project` persists it to the project (`clientSignature` PNG data URL + timestamp; already-signed projects are refused) — the client never needs a login.

### Domain model

`prisma/schema.prisma` chains `User → Project → Room → InpaintRequest` with cascading deletes: a firm (`User`, with branding and a `darkMode` preference) owns staging jobs (`Project` — address, client, target buyer, staging aesthetic/package/directives, buyer-demographics JSON, and the ROI metrics trio), each job holds rooms, and each room holds its two before/after variant pairs, selected variant, AI copy fields, and checklist JSON — plus the inpaint queue requests that track one fal.ai job each (status + durable result URL), the `InpaintVersion` snapshots that version history restores from, and the `SelectionLog` instance-toggle telemetry that feeds the training corpus, all cascade-deleted with the room. Projects also carry client-facing `MaterialSwatch` and `ProcurementItem` rows (cascade-deleted with the project) alongside the client's digital signature fields — `clientSignature` PNG data URL, `clientSignatureStatus` moving `Pending → Signed`, and `clientSignatureTimestamp` recorded at signing. Detected furnishings persist as `VisionLabel` rows keyed by image hash (unique on hash + concept + instance index, with score); `VisionLabel` has no owner relation and survives deletes.

### Route → source map

| Route | Purpose | Implementation |
| --- | --- | --- |
| `/` | Auth redirector (signed in → `/projects`) | `src/app/page.tsx` |
| `/login` | Password / magic-link sign-in | `src/app/(auth)/login/page.tsx` |
| `/signup` | Redirect stub → `/login` (top-level, outside the `(auth)` group) | `src/app/signup/page.tsx` |
| `/auth/callback` | Auth code exchange | `src/app/auth/callback/route.ts` |
| `/setup` | First-run firm branding | `src/app/(auth)/setup/`, `src/app/api/setup/` |
| `/dashboard` | Protected landing (redirects to `/projects`) | `src/app/dashboard/page.tsx`, `middleware.ts` |
| `/settings` | Firm branding and lookbook page templates | `src/app/(dashboard)/settings/page.tsx` |
| `/projects` | Project list | `src/app/(dashboard)/projects/page.tsx` |
| `/projects/new` | Project intake form | `src/app/(dashboard)/projects/new/page.tsx`, `src/app/actions/project.ts` |
| `/projects/[id]` | Staging workspace (rooms, masks, segmentation, variants, version history, copy) | `src/app/(dashboard)/projects/[id]/page.tsx`, `src/components/canvas/`, `src/app/actions/`, `src/app/api/inpaint/`, `src/app/api/segment/`, `src/app/api/label-instances/`, `src/app/api/generate-copy/` |
| `/projects/[id]/setup` | Project intake (first workflow-stepper step) | `src/app/(dashboard)/projects/[id]/setup/page.tsx` |
| `/projects/[id]/rooms` | Per-room staging studio | `src/app/(dashboard)/projects/[id]/rooms/page.tsx` |
| `/projects/[id]/refine` | Staged-result refinement (`?room=`-scoped) | `src/app/(dashboard)/projects/[id]/refine/page.tsx` |
| `/projects/[id]/lookbook` | In-app interactive lookbook editor + ROI metrics | `src/app/(dashboard)/projects/[id]/lookbook/page.tsx`, `src/components/lookbook/` |
| `/projects/[id]/report` | Client-facing consultation report with comparison slider | `src/app/(dashboard)/projects/[id]/report/page.tsx` |
| `/preview/[id]` | Cookie-less print page Browserless fetches for PDF export (token-gated) | `src/app/(print)/preview/[id]/page.tsx`, `src/app/api/export-pdf/` |

## Tech Stack

- **Next.js 16** (App Router, TypeScript)
- **Tailwind CSS + shadcn/ui**
- **Supabase** (Postgres + Storage + Auth)
- **Prisma** ORM
- **Vercel AI SDK + GPT-4o-mini** — structured copywriting and vision labeling
- **fal.ai** — FLUX.1 Fill inpainting + SAM segmentation
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
> 2. Run `scripts/dev-tunnel.sh` — it starts the tunnel and points `NEXT_PUBLIC_APP_URL` in `.env.local` at the public URL. (It refuses to tunnel a non-Next.js port — if Grafana or another service holds 3000, it tells you to re-run with `--port 3001`, where `next dev` lands when 3000 is busy.)
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
