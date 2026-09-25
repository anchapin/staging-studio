# From-Zero Setup Guide: Supabase, Auth, Storage, and Service Keys

Everything a fresh clone needs to reach a **working login** and a **successful room-photo upload** — with no prior Supabase project and no trial-and-error across provider dashboards. Follow the steps in order; each step lists what to click and how to verify it.

> **Scope:** this guide is the **development setup** — creating the backing services and running the app locally.
> Already deployed or deploying to production? See [docs/DEPLOYMENT.md](DEPLOYMENT.md), which covers deploy operations, the production env-var table, and why `NEXT_PUBLIC_APP_URL` must be publicly reachable for PDF export. The Supabase project you create here is shared by local dev and production: Step 2's redirect-URL list is where the production origin gets added later.

## Prerequisites

- Node.js 18.18+ (Next.js 15's minimum; 20 LTS recommended) and npm
- A Supabase account ([supabase.com](https://supabase.com) → sign in with GitHub or email)
- Accounts on the other three providers, created in Step 4 as you reach them: fal.ai, OpenAI, Browserless.io

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
3. **Add the callback to Redirect URLs** — Authentication → URL Configuration → **Redirect URLs**, add:
   - `http://localhost:3000/auth/callback`

   The login form sends `emailRedirectTo: <origin>/auth/callback`, and `/auth/callback` exchanges the code for a session and lands the user on `/dashboard`. Without this entry, Supabase refuses the redirect and sign-in dead-ends.

**Production:** when you deploy, the production origin must also be on this list (Site URL stays pointing at your primary origin; add the deployed URL to Redirect URLs). [docs/DEPLOYMENT.md](DEPLOYMENT.md) → *Supabase auth configuration* covers it; sign-in on the deployed URL silently fails without it.

**Magic-link email delivery:** Supabase's built-in email sender works out of the box for development but is rate-limited (a few emails per hour) — fine for a solo contributor; configure custom SMTP in Authentication → Emails if you need more.

## Step 3 — Create the storage buckets

The code hard-depends on **two** buckets, by exact name:

| Bucket | Created by | What goes in it |
| --- | --- | --- |
| `room-photos` | `src/app/actions/room-photos.ts` (signed upload URLs) | Room before-images: `rooms/{roomId}/before-image[-2].{jpg\|jpeg\|png\|webp}` |
| `logos` | `src/app/(auth)/setup/setup-form.tsx` (direct client upload) | Firm logo uploaded by the mandatory `/setup` wizard |

**Both buckets must be public.** The app calls `getPublicUrl()` and stores the resulting URL in Postgres (room image columns, the firm logo URL, inpaint result URLs), then renders those URLs through `next/image`. A private bucket makes every stored URL 404 — upload would "succeed" and the image would still never display.

**Via the dashboard** (per bucket):

1. Storage → **New bucket** → name it exactly `room-photos` (then `logos`) → toggle **Public bucket** on → Create.
2. Still in Storage → **Policies** (per bucket) → New policy → template **"Allow access to authenticated users only"** with `INSERT` checked. Public buckets are readable by anyone via public URLs; the policy is what lets *signed-in app users* upload.

**Via the SQL Editor** (one paste does both buckets and both policies):

```sql
insert into storage.buckets (id, name, public)
values ('room-photos', 'room-photos', true), ('logos', 'logos', true)
on conflict (id) do update set public = true;

create policy "authenticated can upload to room-photos"
on storage.objects for insert to authenticated
with check (bucket_id = 'room-photos');

create policy "authenticated can upload to logos"
on storage.objects for insert to authenticated
with check (bucket_id = 'logos');
```

Notes:

- Without the INSERT policies, the room-photo flow fails with `new row violates row-level security policy` when the server requests a signed upload URL, and the logo upload fails in the `/setup` wizard.
- Bucket-level allowed-MIME/size limits are optional hardening; the app already enforces `jpg|jpeg|png|webp` extensions in code. If you do set MIME types on the bucket, allow at least `image/jpeg`, `image/png`, `image/webp` or uploads will be rejected by Storage.

## Step 4 — Get the other service keys

| Provider | Console URL | Key / setting in `.env.local` | Capability needed |
| --- | --- | --- | --- |
| Supabase | [supabase.com/dashboard](https://supabase.com/dashboard) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `DATABASE_URL` | Postgres project + Email auth (password & magic link) + Storage buckets + auth redirect config (Steps 1–3) |
| fal.ai | [fal.ai/dashboard/keys](https://fal.ai/dashboard/keys) | `FAL_KEY` | Access to the **FLUX.1 Fill** model — the app queues `fal-ai/flux-fill` for room inpainting |
| OpenAI | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) | `OPENAI_API_KEY` | **gpt-4o-mini** access (lookbook room copy generation) |
| Browserless.io | [browserless.io](https://browserless.io) → account → API keys | `BROWSERLESS_API_KEY` | Headless-Chrome PDF rendering plan (lookbook export) |

Notes per provider:

- **fal.ai**: create an API key on the keys page; the key gets access to fal's public models including `fal-ai/flux-fill`. `lib/fal.ts` throws at import when `FAL_KEY` is missing, so the app can't even build without it.
- **OpenAI**: the key must belong to a project/org with `gpt-4o-mini` available (any standard API project). Usage-based billing applies to copy generation calls.
- **Browserless**: only needed for PDF export. Without it, everything else works and export returns a 500.
- Two more optional `.env.local` keys are documented inline in `.env.example`: `NEXT_PUBLIC_APP_URL` (dev falls back to `http://localhost:3000`; only matters for local PDF export, which [DEPLOYMENT.md](DEPLOYMENT.md) explains further) and `PREVIEW_TOKEN_SECRET` (optional in dev — a fixed public fallback is used; **required in production**, generate with `openssl rand -base64 32`).

## Step 5 — First-run flow

```bash
# 1. Install dependencies
npm install

# 2. Create your env file
cp .env.example .env.local

# 3. Fill in the values from Steps 1 and 4:
#    DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
#    OPENAI_API_KEY, FAL_KEY, BROWSERLESS_API_KEY

# 4. Push the Prisma schema to the database
npx prisma db push

# 5. Start the dev server
npm run dev
```

**`npx prisma db push` is the first hard gate.** It talks to live Postgres over `DATABASE_URL` — if the connection string is wrong (bad password, wrong host/port), it fails with `P1001: Can't reach database server` before anything else in the app can work. This is also why there is no offline "first run" without either a hosted Supabase project (Steps 1–3) or the local Supabase stack at the end of this guide. The Prisma schema (`prisma/schema.prisma`) is the source of truth; the project uses `db push`, not migrations.

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
- **Caveat:** the AI and PDF services have no local equivalents. `FAL_KEY`, `OPENAI_API_KEY`, and `BROWSERLESS_API_KEY` must still be real cloud keys from Step 4 — inpainting, copy generation, and PDF export always hit the cloud, even with a fully local database.
