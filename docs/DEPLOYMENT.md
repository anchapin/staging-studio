# Deployment Guide

How to deploy StagingStudio and — more importantly — how to get PDF export working, which is the one part of the app whose correctness depends on a deployment-level setting that fails far from its cause.

## The one thing to get right: `NEXT_PUBLIC_APP_URL`

PDF export (`POST /api/export-pdf`, `src/app/api/export-pdf/route.ts`) does not render the lookbook itself. It hands a URL to Browserless.io's **cloud-hosted headless Chrome**, which fetches the printable lookbook page (`/projects/[id]/preview`) and prints it to PDF. That cloud browser is a separate machine: it has no access to `localhost`, your dev machine, or any private network.

The URL it is told to fetch is built by prefixing `NEXT_PUBLIC_APP_URL`:

```
${NEXT_PUBLIC_APP_URL}/projects/${projectId}/preview?token=...
```

The consequences:

- **In production, `NEXT_PUBLIC_APP_URL` is required and must be the deployment's publicly reachable origin** (e.g. `https://stagingstudio.yourfirm.com`). The route hard-fails with a 500 and a structured log (`event: "export_pdf_app_url_missing"`) if it is unset or empty when `NODE_ENV === "production"`.
- **In development the variable falls back to `http://localhost:3000`** — which Browserless's cloud Chrome can never fetch. So with everything else configured correctly, local PDF export fails unless you expose localhost (see [Local development and PDF export](#local-development-and-pdf-export)).
- The trap is that the app looks completely healthy: login, projects, photo upload, inpainting, and AI copy all work with a wrong or missing `NEXT_PUBLIC_APP_URL`. The failure only surfaces when someone exports a lookbook, as a generic export error — nowhere near the misconfiguration that caused it.

Set it to the origin only — scheme + host, **no trailing slash** (the route appends `/projects/...` itself).

Because `NEXT_PUBLIC_APP_URL` is a `NEXT_PUBLIC_*` variable, Next.js inlines it into the client bundle at **build time**. Set it in your hosting provider's environment settings *before* deploying, and re-deploy after changing it — editing it at runtime alone has no effect.

## Documented target: Vercel

StagingStudio is a Next.js 15 (App Router) application, and **Vercel is the documented hosting target**: every external dependency (Supabase, OpenAI, fal.ai, Browserless) is already a hosted SaaS, so the only thing to deploy is the Next.js app itself, which Vercel runs natively.

The general shape (standard Vercel workflow; consult Vercel's docs for specifics):

1. Import the Git repository into a Vercel project (framework preset: Next.js).
2. Add **all** environment variables from the table below in Project → Settings → Environment Variables, for the Production environment.
3. Deploy. `npm install` runs `prisma generate` automatically (the `postinstall` script in `package.json`), so the Prisma client is built during the install step.

### Environment variables

These match `.env.example` exactly — that file is the source of truth for what reads each key and where to source it.

| Variable | Required in production? | What it does | Where it comes from |
| --- | --- | --- | --- |
| `DATABASE_URL` | **Yes** | Postgres connection string used by Prisma (`prisma/schema.prisma` datasource) | Supabase dashboard → Project Settings → Database → Connection string |
| `NEXT_PUBLIC_SUPABASE_URL` | **Yes** | Supabase project URL, read by `middleware.ts`, `lib/supabase.ts`, `api/setup*`, `auth/callback` | Supabase dashboard → Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Yes** | Supabase anon public key (browser-safe by design), read wherever the project URL is | Supabase dashboard → Project Settings → API → anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | No — **reserved** | Not read by any code today. Do not configure or distribute unless you add server-side admin usage; if ever used it must stay server-side only | Supabase dashboard → Project Settings → API → service_role key |
| `OPENAI_API_KEY` | **Yes** | Read by `lib/ai.ts` (call-time check) for gpt-4o-mini lookbook copy | platform.openai.com → API keys |
| `FAL_KEY` | **Yes** | Read by `lib/fal.ts` (throws at import when missing) for FLUX.1 Fill inpainting | fal.ai dashboard → keys |
| `BROWSERLESS_API_KEY` | **Yes** (for PDF export) | Read by `api/export-pdf`; missing key returns a 500 on export | browserless.io → account API keys |
| `NEXT_PUBLIC_APP_URL` | **Yes** | The app's public origin (not a PDF-export-only value). `api/export-pdf` builds the cookie-less preview URL its cloud browser fetches from it. **Must be publicly reachable.** See [the section above](#the-one-thing-to-get-right-next_public_app_url) | Your deployment's URL (e.g. the Vercel production domain) |
| `PREVIEW_TOKEN_SECRET` | **Yes** | HMAC secret signing short-lived (5 min) lookbook-preview tokens, read by `lib/preview-token.ts`. Optional in dev, where a fixed **public** fallback is used — production must set a real secret | Generate with `openssl rand -base64 32` |

Why `PREVIEW_TOKEN_SECRET` matters for export: Browserless's Chrome is a cookie-less browser, so the preview page would redirect it to `/login` and the PDF would capture the login page. The export route instead mints a signed token (scoped to one project, 5-minute TTL) that both the root middleware and the preview page verify. An unset secret in production means every deployment runs on a publicly known key.

### Supabase auth configuration

Login on the deployed domain uses the same Supabase project as local development, so add the deployed origin to the allowed redirect URLs in the Supabase dashboard (Authentication → URL Configuration: set the Site URL and add your production origin to Redirect URLs). Without this, sign-in on the deployed URL fails, which blocks the verification checklist below.

### Database schema

Prisma uses `db push` (schema-first, no migration history). After the Supabase project exists and `DATABASE_URL` is set, push the schema once from a machine that has the connection string:

```bash
npx prisma db push
```

Re-run this after any change to `prisma/schema.prisma` (regenerate the client locally with `npm run db:generate`).

## Local development and PDF export

The dev fallback for `NEXT_PUBLIC_APP_URL` is `http://localhost:3000`, which Browserless's cloud Chrome cannot reach — so PDF export is the one feature that does not work out of the box locally. The workaround is to expose your dev server through a public tunnel and point `NEXT_PUBLIC_APP_URL` at it:

```bash
# Option A: ngrok
ngrok http 3000
# Option B: cloudflared
cloudflared tunnel --url http://localhost:3000
```

Then in `.env.local` set `NEXT_PUBLIC_APP_URL` to the tunnel URL (e.g. `https://<random>.ngrok-free.app`) — no trailing slash — and restart `npm run dev`. Note that because it is a `NEXT_PUBLIC_*` variable, a change requires a dev-server restart. Remember the tunnel URL changes between runs (on free tiers), so update the variable accordingly.

Everything else (login, projects, upload, inpainting, AI copy) works locally without a tunnel.

## Verification checklist

Run through this after every fresh deployment:

1. **Deploy** with all nine env vars configured (eight required + optionally nothing for `SUPABASE_SERVICE_ROLE_KEY`, which should stay unset).
2. **First-run setup works**: visit the deployed URL while signed in — you should land on `/setup` (no `User` row exists yet) and be able to save the firm's name and logo.
3. **Log in** on the deployed URL (password or magic link) and reach `/dashboard` → `/projects`.
4. **Create a project** via `/projects/new`.
5. **Upload room photos** in the project workspace and run an AI staging (inpaint) pass.
6. **Generate AI room copy** for a room.
7. **Export a lookbook PDF from the deployed URL** (the preview page's export action) and **assert a valid PDF downloads** — not an error, and the file opens.

Step 7 is the only step that exercises `NEXT_PUBLIC_APP_URL` + `BROWSERLESS_API_KEY` end-to-end. If it fails, check the server logs for these structured events from `src/app/api/export-pdf/route.ts`:

| Log event | Meaning |
| --- | --- |
| `export_pdf_app_url_missing` | `NEXT_PUBLIC_APP_URL` unset/empty in production — set it and redeploy (build-time inlining means a redeploy is required) |
| `export_pdf_browserless_error` | Browserless rejected or failed the render — verify `BROWSERLESS_API_KEY`, and that `NEXT_PUBLIC_APP_URL` points to a publicly reachable origin (the cloud Chrome could not fetch the preview page) |
| `export_pdf_non_pdf_response` | The fetch succeeded but the payload was not a PDF — usually the cloud browser fetched something other than the lookbook (check reachability and the Supabase redirect configuration) |
| `export_pdf_failed` | Unexpected error — see the logged exception |

Two distinct 500 messages distinguish the misconfigurations at a glance: *"PDF export is not properly configured"* means `NEXT_PUBLIC_APP_URL` is missing in production; *"PDF export service is not properly configured"* means `BROWSERLESS_API_KEY` is missing.

## Other hosting targets

Nothing in the codebase is Vercel-specific: any host that runs a Next.js 15 App Router app on Node works, provided it can make outbound HTTPS calls to Supabase, OpenAI, fal.ai, and Browserless, and the same environment variables are configured there. The `NEXT_PUBLIC_APP_URL` reachability contract and the verification checklist apply unchanged — only the mechanics of setting env vars differ.
