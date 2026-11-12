# From-Zero Setup Guide: Supabase, Auth, Storage, and Service Keys

Everything a fresh clone needs to reach a **working login** and a **successful room-photo upload** — with no prior Supabase project and no trial-and-error across provider dashboards. Follow the steps in order; each step lists what to click and how to verify it.

> **Scope:** this guide is the **development setup** — creating the backing services and running the app locally.
> Already deployed or deploying to production? See [docs/DEPLOYMENT.md](DEPLOYMENT.md), which covers deploy operations, the production env-var table, and why `NEXT_PUBLIC_APP_URL` must be publicly reachable for PDF export. The Supabase project you create here is shared by local dev and production: Step 2's redirect-URL list is where the production origin gets added later.

## Prerequisites

- Node.js 24 and npm 10+ — `.nvmrc` pins `24.21.0` and `package.json` `engines.node` is `>=24.0.0 <25`; the app runs on Next.js 16
- A Supabase account ([supabase.com](https://supabase.com) → sign in with GitHub or email)
- Accounts on the other three providers, created in Step 4 as you reach them: Alibaba Cloud Model Studio (DashScope), OpenAI, Browserless.io

## Step 1 — Create the Supabase project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.
2. Pick a name (e.g. `staging-studio-dev`), a database password (**save it — it is your `DATABASE_URL` password in Step 5**), and a region near you.
3. Wait for provisioning (~2 minutes).

Two values you need come from **Project Settings → API**:

| `.env.local` variable | Dashboard location | Looks like |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → API → **Project URL** | `https://<project-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API → Project API Keys → **anon** `public` | long JWT starting `eyJ…` |

The anon key is browser-safe by design — the app ships it to the browser, and access is controlled by Supabase Auth + Storage policies, not by keeping it secret. Leave `SUPABASE_SERVICE_ROLE_KEY` alone; no code reads it today.

## Step 2 — Configure Auth (password + magic link, redirects)

The login page (`/login`) offers both password sign-in (`signInWithPassword`) and magic link (`signInWithOtp`), and every magic link redirects through `/auth/callback` — which Supabase only calls if that URL is on the allow-list. Configure all of it under **Authentication** in the dashboard:

1. **Enable Email auth** — Authentication → Sign In / Providers → **Email**: enabled (it is by default). This single provider covers **both** methods: password sign-in and magic link (OTP). While in Authentication settings, leave **Allow new users to sign up** enabled (also on by default) — there is no separate signup page in the app; the first magic-link sign-in with a new email *creates* the account.
2. **Set the Site URL** — Authentication → URL Configuration → **Site URL**: `http://localhost:3000`.
3. **Keep "Confirm email" ON** — Authentication → Sign In / Providers → **Email**: leave **Confirm email** enabled (default). The app rejects any session whose email is unconfirmed (`src/lib/api-auth.ts`), so with it off, sign-ins still work but the unconfirmed email never resolves to a `User` row.
4. **Add the callback to Redirect URLs** — Authentication → URL Configuration → **Redirect URLs**, add:
   - `http://localhost:3000/auth/callback`

   The login form sends `emailRedirectTo: <origin>/auth/callback`, and `/auth/callback` exchanges the code for a session and lands the user on `/dashboard`. Without this entry, Supabase refuses the redirect and sign-in dead-ends.

**Production:** when you deploy, the production origin must also be on this list (Site URL stays pointing at your primary origin; add the deployed URL to Redirect URLs). [docs/DEPLOYMENT.md](DEPLOYMENT.md) → *Supabase auth configuration* covers it; sign-in on the deployed URL silently fails without it.

**Magic-link email delivery:** Supabase's built-in email sender works out of the box for development but is rate-limited (a few emails per hour) — fine for a solo contributor; configure custom SMTP in Authentication → Emails if you need more.

## Step 3 — Create the storage buckets

The code hard-depends on **three** buckets, by exact name:

| Bucket | Created by | What goes in it |
| --- | --- | --- |
| `room-photos` | `src/app/actions/room-photos.ts` (signed upload URLs) | Room before-images: `rooms/{roomId}/before-image[-2].{jpg\|jpeg\|png\|webp}` |
| `logos` | `src/app/(auth)/setup/setup-form.tsx` (direct client upload) | Firm logo uploaded by the mandatory `/setup` wizard |
| `staging-images` | `src/lib/inpaint-status.ts` → `persistInpaintImage` (server-side upload) | Inpaint result PNGs: `after-{requestId}.png` |

**All three buckets must be public.** The app calls `getPublicUrl()` and stores the resulting URL in Postgres (room image columns, the firm logo URL, inpaint result URLs), then renders those URLs through `next/image`. A private bucket makes every stored URL 404 — upload would "succeed" and the image would still never display.

**Via the dashboard** (per bucket):

1. Storage → **New bucket** → name it exactly `room-photos` (then `logos`, then `staging-images`) → toggle **Public bucket** on → Create.
2. Still in Storage → **Policies** (per bucket) → New policy → template **"Allow access to authenticated users only"** with `INSERT` checked. Public buckets are readable by anyone via public URLs; the policy is what lets *signed-in app users* upload.

**Via the SQL Editor** (one paste does all three buckets and their policies):

```sql
insert into storage.buckets (id, name, public)
values ('room-photos', 'room-photos', true), ('logos', 'logos', true), ('staging-images', 'staging-images', true)
on conflict (id) do update set public = true;

-- Drop first so this block is re-runnable (the policies below use fixed names).
drop policy if exists "authenticated can upload to room-photos" on storage.objects;
drop policy if exists "authenticated can delete from room-photos" on storage.objects;
drop policy if exists "authenticated can read room-photos" on storage.objects;
drop policy if exists "authenticated can upload to logos" on storage.objects;
drop policy if exists "authenticated can read logos" on storage.objects;
drop policy if exists "authenticated can upload to staging-images" on storage.objects;
drop policy if exists "authenticated can read staging-images" on storage.objects;

create policy "authenticated can upload to room-photos"
on storage.objects for insert to authenticated
with check (bucket_id = 'room-photos');

create policy "authenticated can upload to logos"
on storage.objects for insert to authenticated
with check (bucket_id = 'logos');

create policy "authenticated can upload to staging-images"
on storage.objects for insert to authenticated
with check (bucket_id = 'staging-images');
```

Notes:

- Without the INSERT policies, the room-photo flow fails with `new row violates row-level security policy` when the server requests a signed upload URL, the logo upload fails in the `/setup` wizard, and the server-side inpaint upload to `staging-images` fails the same way.
- Bucket-level allowed-MIME/size limits are optional hardening; the app already enforces `jpg|jpeg|png|webp` extensions in code. If you do set MIME types on the bucket, allow at least `image/jpeg`, `image/png`, `image/webp` or uploads will be rejected by Storage.

## Storage RLS Policies

> **Issue #987 audit findings.** This section documents the RLS policy requirements for all Supabase Storage buckets used by the app, security findings, and recommended policies. It is the original #987 record: Step 3 above now creates all three buckets (including `staging-images`) and their INSERT policies, and the complete SQL block at the end of this section is the copy-paste version of everything.

### Buckets in use

| Bucket | Path patterns | Upload mechanism | Notes |
| --- | --- | --- | --- |
| `room-photos` | `rooms/{roomId}/before-image[-2].{ext}`, `rooms/{roomId}/versions/{slot}/{now}-{uuid}.jpg` | Signed upload URL (server issues URL, browser PUTs directly) | before/after images + inpaint version thumbnails |
| `logos` | `{email}-logo-{timestamp}.{ext}` | Client-side direct upload (setup wizard) | Firm logo; email in path provides natural scoping |
| `staging-images` | `after-{requestId}.png` | Server-side only (`src/lib/inpaint-status.ts` → `persistInpaintImage`) | Inpaint result staging (provider PNG re-hosted by the server); see policy gap below |

### Security findings (Issue #987)

#### CRITICAL: `staging-images` bucket has no documented RLS policies (since fixed in Step 3)

The `staging-images` bucket is referenced in `src/lib/inpaint-status.ts` (`persistInpaintImage`), and as of the #987 audit it **had no policies documented or created** in SUPABASE-SETUP.md (Step 3 now creates the bucket plus its INSERT policy; the full policy set is in the complete SQL block below). The upload path `after-{requestId}.png` uses a UUID-like request ID generated server-side, which provides unpredictability — but the bucket itself had no INSERT, SELECT, or DELETE policies. If this bucket was created as private (the default), all uploads via `persistInpaintImage` would fail with RLS violations.

**Action required (now covered by Step 3):** Create the `staging-images` bucket with the following policies, or clarify whether it is intended to be a public bucket:

```sql
-- If `staging-images` is intended to be PUBLIC (accessible without auth):
-- Mark the bucket public when creating it:
update storage.buckets set public = true where id = 'staging-images';

-- Allow anyone to read objects (public bucket):
create policy "public read staging-images"
on storage.objects for select to authenticated
using (bucket_id = 'staging-images');

-- Server-side uploads use the anon key or user's session, so INSERT must be allowed:
create policy "authenticated can upload to staging-images"
on storage.objects for insert to authenticated
with check (bucket_id = 'staging-images');

-- If `staging-images` is intended to be PRIVATE (recommended for inpaint results):
-- Only allow server-side uploads via service role (bypasses RLS):
-- No policies needed if using service role key for server uploads.
-- For additional hardening, add a path-based INSERT check:
create policy "authenticated can upload to staging-images"
on storage.objects for insert to authenticated
with check (bucket_id = 'staging-images');
```

#### HIGH: `room-photos` INSERT policy lacks path-scoped ownership check

The documented INSERT policy for `room-photos` only checks `bucket_id = 'room-photos'`, which allows any authenticated user to upload to **any path** within the bucket — not just their own rooms. While the application-layer `getSignedUploadUrl` (`src/app/actions/room-photos.ts`) performs a Prisma ownership check before generating a signed URL, the signed URL itself does not encode path restrictions. If a signed URL is leaked or obtained through a separate vulnerability, an attacker could overwrite another user's room photos.

**Recommended path-scoped INSERT policy:**

```sql
-- Restrict INSERT to paths under the user's own rooms.
-- The path pattern `rooms/{roomId}/...` is enforced by checking
-- that the roomId prefix exists and the user owns the room via a
-- subquery on the auth.users → Project → Room chain.
-- NOTE: This requires storage.objects to have a reusable relationship
-- to the user's project ownership. Since Supabase Storage RLS cannot
-- directly join to the app's Room table, the application-layer
-- ownership check (getAuthedPrismaUser + Prisma findFirst in
-- getSignedUploadUrl and saveInpaintVersion) remains the primary
-- enforcement gate.
--
-- Minimum viable policy (bucket-level, authenticated):
create policy "authenticated can upload to room-photos"
on storage.objects for insert to authenticated
with check (bucket_id = 'room-photos');
```

**The application-layer ownership check IS the primary enforcement.** The signed upload URL flow means the server generates a one-time URL only after verifying room ownership via Prisma. The RLS INSERT policy is a defence-in-depth measure. The path-based `WITH CHECK` expression cannot fully enforce app-level room ownership without a way to join storage paths to the `Room` table in the same query.

#### MEDIUM: `room-photos` lacks UPDATE and DELETE policies

Inpaint version thumbnails are deleted during FIFO eviction in `saveInpaintVersion` (`src/app/actions/inpaint-versions.ts`) via `supabase.storage.from("room-photos").remove(pathsToDelete)`. If this is called with paths from evicted version rows, those paths must be deletable by the authenticated user. Currently no DELETE or UPDATE policy is documented.

```sql
-- Allow users to delete their own version thumbnails.
-- The application enforces ownership at the Prisma level before calling remove().
create policy "authenticated can delete from room-photos"
on storage.objects for delete to authenticated
using (
  bucket_id = 'room-photos'
  -- Path must be under a room the user owns:
  and (
    -- Pattern: rooms/{roomId}/versions/...
    name like 'rooms/%/versions/%'
  )
);
```

#### LOW: `logos` bucket path implicitly scoped by email

The `logos` bucket path `${email}-logo-${Date.now()}.{ext}` embeds the user's email, providing natural path scoping. Users cannot overwrite another user's logo because the path is unique per email. The current INSERT-only policy is sufficient for this bucket.

##### Verified 2026-10-20 (#1418) — anon-key `upsert` is NOT a live overwrite vector

The browser client (`lib/supabase.ts`) sends the **anon** key plus `x-upsert: true` when
uploading a logo. Because `upsert` performs an UPDATE on an existing path, this looked
like a cross-tenant logo overwrite: an attacker-controlled path could in principle
replace an existing firm's branding. The live project was probed directly (service-role
read of bucket config, then writes attempted with the real `sb_publishable_…` anon key
using the exact headers the app sends):

| probe | result |
|---|---|
| anon `POST` to a **new** path in `logos` | `403 AccessDenied — new row violates row level security policy` |
| anon `POST` (`x-upsert`) over an **existing** logo path | `403 AccessDenied — new row violates row level security policy` |
| anon `POST` (`x-upsert`) over an existing path with an attacker-chosen `.svg` extension | `403 AccessDenied — new row violates row level security policy` |

`GET /storage/v1/bucket` confirms the live config: `logos` is `public = true` with
`file_size_limit = null` and `allowed_mime_types = null` — i.e. **no bucket-level size
or MIME restriction**, consistent with the report, but the RLS policy denies the writes.

**Invariant to preserve:** the `logos` and `room-photos` INSERT policies must remain
authenticated-only (`to authenticated` + `bucket_id = '<bucket>'`). They are what makes
`upsert: true` unreachable pre-auth. Do not relax them to `to anon`, and re-run the
probes above if the policy is ever changed.

**Residual risk (not an anon overwrite, still worth fixing):** the bucket has no
`allowed_mime_types`/`file_size_limit`, and the only client-side guard is
`accept="image/*"` in `settings-form.tsx` / `setup-form.tsx` — a hint a hostile client
ignores. There is **no server-side MIME/size validation** on the logo path, so an
authenticated user can store an `.html`/scripted-`.svg` file (rendered as `src` in
`cover-page.tsx` and `signoff-page.tsx`) or an unbounded blob in a public bucket. Fix by
setting bucket `allowed_mime_types` (`image/png`, `image/jpeg`, `image/webp`) plus a
sane `file_size_limit`, validating MIME/size server-side, and serving logos under a
non-executable content type.

```sql
-- Path-based INSERT policy for logos (email is embedded in the path):
-- The authenticated user's email must appear in the object name.
-- Note: Supabase does not expose the user's email in Storage RLS directly,
-- so this policy is a no-op without a custom function or trigger.
-- The current bucket-level INSERT policy is acceptable because the path
-- naturally scopes writes to the uploading user.
create policy "authenticated can upload to logos"
on storage.objects for insert to authenticated
with check (bucket_id = 'logos');
```

### Complete recommended SQL (all buckets)

```sql
-- ============================================================
-- Storage buckets — ensure all exist and are public
-- ============================================================
insert into storage.buckets (id, name, public)
values
  ('room-photos', 'room-photos', true),
  ('logos',       'logos',       true),
  ('staging-images', 'staging-images', true)  -- Issue #987: was missing
on conflict (id) do update set public = true;

-- Drop first so the block is re-runnable and does not clash with the
-- policy names Step 3 already creates.
drop policy if exists "authenticated can upload to room-photos" on storage.objects;
drop policy if exists "authenticated can delete from room-photos" on storage.objects;
drop policy if exists "authenticated can read room-photos" on storage.objects;
drop policy if exists "authenticated can upload to logos" on storage.objects;
drop policy if exists "authenticated can read logos" on storage.objects;
drop policy if exists "authenticated can upload to staging-images" on storage.objects;
drop policy if exists "authenticated can read staging-images" on storage.objects;

-- ============================================================
-- room-photos bucket
-- ============================================================
-- INSERT: allows authenticated users to upload room photos.
-- Path scoping (rooms/{roomId}/...) is enforced application-layer
-- via getSignedUploadUrl + Prisma ownership check, not RLS.
create policy "authenticated can upload to room-photos"
on storage.objects for insert to authenticated
with check (bucket_id = 'room-photos');

-- Issue #987: DELETE policy needed for inpaint version FIFO eviction.
-- The application calls storage.remove() for evicted thumbnail paths.
create policy "authenticated can delete from room-photos"
on storage.objects for delete to authenticated
using (bucket_id = 'room-photos');

-- SELECT: public bucket — anyone with the public URL can read.
-- Explicit policy for authenticated users (defense-in-depth):
create policy "authenticated can read room-photos"
on storage.objects for select to authenticated
using (bucket_id = 'room-photos');

-- ============================================================
-- logos bucket
-- ============================================================
create policy "authenticated can upload to logos"
on storage.objects for insert to authenticated
with check (bucket_id = 'logos');

create policy "authenticated can read logos"
on storage.objects for select to authenticated
using (bucket_id = 'logos');

-- ============================================================
-- staging-images bucket (Issue #987: was undocumented)
-- ============================================================
-- Uploads are server-side only (persistInpaintImage in inpaint-status.ts).
-- Path `after-{requestId}.png` uses UUID requestId — unpredictable.
-- If bucket is public (public=true), uploads succeed without policy.
-- If bucket is private, server-side uploads require service role (bypasses RLS).
create policy "authenticated can upload to staging-images"
on storage.objects for insert to authenticated
with check (bucket_id = 'staging-images');

create policy "authenticated can read staging-images"
on storage.objects for select to authenticated
using (bucket_id = 'staging-images');
```

### Policy enforcement summary

| Bucket | App-level enforcement | RLS enforcement |
| --- | --- | --- |
| `room-photos` INSERT | `getSignedUploadUrl` checks `userId → project → room` before issuing URL | INSERT allowed for authenticated (path check is app-level) |
| `room-photos` DELETE | `saveInpaintVersion` Prisma ownership check before evicting thumbnails | DELETE policy added Issue #987 |
| `logos` INSERT | Client uploads from authenticated setup wizard; email in path | INSERT allowed for authenticated |
| `staging-images` INSERT | Server-side only (`persistInpaintImage`); requestId is UUID | INSERT allowed for authenticated (Issue #987 fix) |
| `staging-images` SELECT | Public URL stored in `InpaintRequest.resultUrl` | SELECT policy added Issue #987 |

## Step 4 — Get the other service keys

| Provider | Console URL | Key / setting in `.env.local` | Capability needed |
| --- | --- | --- | --- |
| Supabase | [supabase.com/dashboard](https://supabase.com/dashboard) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `DATABASE_URL` | Postgres project + Email auth (password & magic link) + Storage buckets + auth redirect config (Steps 1–3) |
| Alibaba Cloud Model Studio (DashScope) | [Alibaba Cloud console](https://console.aliyun.com/) → Model Studio → API keys | `ALIBABA_DASHSCOPE_API_KEY` (plus `ALIBABA_BAILIAN_WORKSPACE_ID`) | Access to the **Qwen-Image-2.1 Pro** model — the default inpaint provider since #1240 (`INFERENCE_PROVIDER=alibaba`) |
| OpenAI | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) | `OPENAI_API_KEY` | **gpt-4o-mini** access (lookbook room copy generation); also the GPT-Image inpaint surface when `INFERENCE_PROVIDER=openai` (#1506) |
| Browserless.io | [browserless.io](https://browserless.io) → account → API keys | `BROWSERLESS_API_KEY` | Headless-Chrome PDF rendering plan (lookbook export) |

Notes per provider:

- **Alibaba Cloud DashScope**: create the API key in the Model Studio console. The key is region-bound — a Singapore key cannot call the Beijing endpoint — so `ALIBABA_BAILIAN_WORKSPACE_ID` (which implies the workspace region) must be set to the same region as the key. The optional `ALIBABA_INPAINT_MODEL` selects the model (default `qwen-image-2.1-pro`). `src/lib/alibaba-adapter.ts` throws `MissingEnvVarsError` at call time when `ALIBABA_DASHSCOPE_API_KEY`, `ALIBABA_BAILIAN_WORKSPACE_ID`, or `ALIBABA_INPAINT_MODEL` is missing — at call time, not at import, so the app still builds without them.
- **fal.ai was retired in #1240**: the fal adapter was deleted, `FAL_KEY` is no longer read by the app and is not in `.env.example`. Setting `INFERENCE_PROVIDER=fal` (or `replicate`) now fails with a clear configuration error instead of falling through silently — leave `INFERENCE_PROVIDER` unset (default `alibaba`) or set it to `alibaba`/`openai`. Drop any stale `FAL_KEY` line from your `.env.local`.
- **OpenAI**: the key must belong to a project/org with `gpt-4o-mini` available (any standard API project). Usage-based billing applies to copy generation calls.
- **Browserless**: only needed for PDF export. Without it, everything else works and export returns a 500.
- Two more optional `.env.local` keys are documented inline in `.env.example`: `NEXT_PUBLIC_APP_URL` (dev falls back to `http://localhost:3000`; only matters for local PDF export, which [DEPLOYMENT.md](DEPLOYMENT.md) explains further) and `PREVIEW_TOKEN_SECRET` (optional in dev — a fixed public fallback is used; **required in production**, generate with `openssl rand -base64 32`).

## Step 5 — First-run flow

```bash
# 1. Install dependencies
npm install

# 2. Create your env file
cp .env.example .env.local

# 3. Fill in the values from Steps 1 and 4 (every key in .env.example is
#    listed in the table below):
#    DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
#    OPENAI_API_KEY, ALIBABA_DASHSCOPE_API_KEY, ALIBABA_BAILIAN_WORKSPACE_ID,
#    BROWSERLESS_API_KEY

# 4. Push the Prisma schema to the database
npx prisma db push

# 5. Start the dev server
npm run dev
```

**`npx prisma db push` is the first hard gate.** It talks to live Postgres over `DATABASE_URL` — if the connection string is wrong (bad password, wrong host/port), it fails with `P1001: Can't reach database server` before anything else in the app can work. This is also why there is no offline "first run" without either a hosted Supabase project (Steps 1–3) or the local Supabase stack at the end of this guide. The Prisma schema (`prisma/schema.prisma`) is the source of truth; the project uses `db push`, not migrations.

Every key in `.env.example`, and what to do with it in local dev:

| `.env.local` key | In local dev |
| --- | --- |
| `DATABASE_URL` | **Fill in** — from Step 1 (or the local Supabase stack below) |
| `NEXT_PUBLIC_SUPABASE_URL` | **Fill in** — from Step 1 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Fill in** — from Step 1 |
| `OPENAI_API_KEY` | **Fill in** — from Step 4 |
| `ALIBABA_DASHSCOPE_API_KEY` | **Fill in** — from Step 4 |
| `ALIBABA_BAILIAN_WORKSPACE_ID` | **Fill in** — from Step 4 (must match the key's region) |
| `BROWSERLESS_API_KEY` | **Fill in** — from Step 4 (only needed for PDF export) |
| `ALIBABA_INPAINT_MODEL` | Leave the default (`qwen-image-2.1-pro`) |
| `OPENAI_INPAINT_MODEL` | Leave the default (`gpt-image-2.6-flare`) |
| `OPENAI_INPAINT_COMPOSITE` | Leave unset (commented out in `.env.example`) |
| `INFERENCE_PROVIDER` | Leave the default (`alibaba`); `openai` selects the GPT-Image inpaint surface (#1506) |
| `NEXT_PUBLIC_APP_URL` | Leave the default (`http://localhost:3000`); set it to a public tunnel URL if you want local PDF export |
| `NEXT_PUBLIC_SENTRY_DSN` | Leave blank in dev (Sentry stays a no-op) |
| `DAILY_INPAINT_LIMIT`, `DAILY_COPY_LIMIT`, `DAILY_LABEL_LIMIT`, `DAILY_EXPORT_LIMIT`, `DAILY_SEGMENT_LIMIT` | Leave the defaults (20 / 50 / 50 / 20 / 100) |
| `PREVIEW_TOKEN_SECRET`, `SIGNATURE_ENCRYPTION_KEY` | Optional in dev (fixed public fallbacks); generate with `openssl rand -base64 32` for production |
| `SUPABASE_SERVICE_ROLE_KEY` | Leave alone — no app code reads it today |
| `TYPESAFE_API_KEY` | Leave blank — only `docs/dana-rig/` tooling reads it |
| `E2E_HERMETIC`, `E2E_BROWSERLESS_PDF_URL` | Leave blank — the e2e harness supplies them itself |

Then verify the app end-to-end:

1. **Sign up + log in** — open `http://localhost:3000`, get bounced to `/login`, enter your email, and use the **magic link** toggle. Click the emailed link → you land on `/dashboard`. (First magic-link sign-in with a new email creates the Supabase Auth user; password mode only works for accounts that already have a password.)
2. **Complete the mandatory firm wizard** — you are automatically routed to `/setup` because no `User` row exists yet. Fill firm name + owner name (logo optional — this is the step that exercises the `logos` bucket) and save. The app creates your Prisma `User` row via `POST /api/setup`; you land on `/dashboard`, and future sessions skip `/setup`.
3. **Prove storage works** — go to `/projects` → **New project** → open its workspace → **Add a room** → upload a room photo (jpg/png/webp). This runs the full chain: signed upload URL from the `room-photos` bucket → browser `PUT` → Prisma row update → image renders on the project page. If the image renders, storage, auth, and the database are all wired correctly.

## Alternative: fully local Supabase (offline Postgres/auth/storage)

If you can't or don't want to use a hosted Supabase project for development, the Supabase CLI can run the whole stack locally:

```bash
npm install -g supabase   # or: brew install supabase/tap/supabase
supabase init             # once per repo (creates supabase/ config)
supabase start            # boots Postgres, GoTrue auth, Storage, Studio
```

`supabase start` prints the local values. Map them into `.env.local`:

| `.env.local` variable | Local value |
| --- | --- |
| `DATABASE_URL` | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| `NEXT_PUBLIC_SUPABASE_URL` | `http://127.0.0.1:54321` (the printed **API URL**) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the printed **anon key** |

Then:

- Run `npx prisma db push` against the local database as in Step 5.
- Replicate Step 2 (Site URL + `http://localhost:3000/auth/callback` redirect) and Step 3 (buckets + policies) in the local Studio at [127.0.0.1:54323](http://127.0.0.1:54323), or the equivalent SQL against the local DB.
- **Caveat:** the AI and PDF services have no local equivalents. `ALIBABA_DASHSCOPE_API_KEY` (with `ALIBABA_BAILIAN_WORKSPACE_ID`), `OPENAI_API_KEY`, and `BROWSERLESS_API_KEY` must still be real cloud keys from Step 4 — inpainting, copy generation, and PDF export always hit the cloud, even with a fully local database.
