# Issue #200: Firm Account Email Migration

## Summary
Migrate the firm account from its current email to `lauren@circlegdesigns.com` and complete the password handoff so Lauren can log in under her own credentials.

---

## Current State

**Supabase Auth User:** The account is currently authenticated via Supabase Auth using the original demo/operator email (e.g. `alex@...` or another address set up during initial deployment).

**Prisma `User` row:** Linked to the auth user's email via `User.email`. The `getAuthedPrismaUser()` function in `src/lib/api-auth.ts` resolves the Prisma `User` by matching `user.email` from the verified Supabase session to `prisma.user.email`.

**Settings UI:** `src/app/actions/settings.ts` → `updateUserSettings` does NOT support email changes. It only allows editing: `firmName`, `ownerName`, `logoUrl`, `psychologyPageContent`, `signoffContent`. Email cannot be changed through the UI.

---

## What Needs to Change

### 1. Supabase Auth — Update the auth user's email

Supabase Auth stores the login credential independently of the Prisma `User` row. To migrate:

**Option A — Supabase Dashboard (recommended for one-off)**
1. Log into the Supabase project dashboard → **Authentication** → **Users**
2. Find the current user row → **Edit** → update **Email** to `lauren@circlegdesigns.com`
3. Supabase will send a confirmation email to the new address — Lauren must click it to confirm

**Option B — Supabase Admin API (scripted)**
```bash
# Requires SUPABASE_SERVICE_ROLE_KEY (server-side only, never client-exposed)
curl -X PUT "https://<PROJECT_REF>.supabase.co/auth/v1/admin/users/<USER_ID>" \
  -H "apikey: <SERVICE_ROLE_KEY>" \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"email": "lauren@circlegdesigns.com"}'
```

### 2. Prisma DB — Update the `User.email` field

After the Supabase auth email is confirmed, update the matching `User` row so `getAuthedPrismaUser()` continues to resolve correctly:

```sql
-- Find the row first
SELECT id, email, "firmName", "ownerName" FROM "User";

-- Update email to match the new auth email
UPDATE "User" SET email = 'lauren@circlegdesigns.com' WHERE email = '<PREVIOUS_EMAIL>';
```

Or via Prisma CLI (requires `.env` symlink — see AGENTS.md env-file note):
```bash
npx prisma db execute --stdin <<'SQL'
UPDATE "User" SET email = 'lauren@circlegdesigns.com' WHERE email = '<PREVIOUS_EMAIL>';
SQL
```

### 3. Password Handoff

Since Supabase Auth owns the password, there are two paths:

**Option A — Supabase "Forgot Password" flow (Lauren initiates)**
1. Go to `/login`
2. Click "Forgot password?"
3. Enter `lauren@circlegdesigns.com`
4. Supabase emails a reset link; Lauren sets her own password
5. No operator access to the password itself is needed

**Option B — Operator resets via Supabase Admin API**
```bash
curl -X PUT "https://<PROJECT_REF>.supabase.co/auth/v1/admin/users/<USER_ID>" \
  -H "apikey: <SERVICE_ROLE_KEY>" \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"password": "<NEW_PASSWORD>"}'
```
Then share the temporary password with Lauren securely; she should change it immediately via the settings page.

---

## Verification Steps

1. **Supabase email confirmed** — the auth user shows `lauren@circlegdesigns.com` with status `confirmed` in the Supabase dashboard
2. **Prisma row updated** — `SELECT email FROM "User"` returns `lauren@circlegdesigns.com`
3. **Login works** — navigate to `/login`, authenticate as `lauren@circlegdesigns.com`, reach `/dashboard`
4. **Settings accessible** — `/settings` loads and shows the firm data

---

## Prisma Schema Reference

```
model User {
  id                    String    @id @default(cuid())
  firmName              String    // "Circle G Designs"
  ownerName             String    // "Lauren Chapin"
  logoUrl               String?
  email                 String?   @unique   ← linked to Supabase auth
  psychologyPageContent String?
  signoffContent        String?
  createdAt             DateTime  @default(now())
  projects Project[]
}
```

The `email` field is `unique` and `optional` (`String?`), but `getAuthedPrismaUser()` requires it to match the Supabase auth user's email for the session-to-database linkage to work.

---

## Files Reference

| File | Purpose |
|------|---------|
| `src/lib/api-auth.ts` | `getAuthedPrismaUser()` — resolves Prisma User from Supabase session |
| `src/app/actions/settings.ts` | `updateUserSettings` — branding fields only, no email |
| `src/lib/settings-schema.ts` | Zod schema for settings form (5 fields, email excluded) |
| `prisma/schema.prisma` | `User` model with `email` field |
