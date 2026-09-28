# Session Handoff — #1099 fixed

**Date:** 2026-09-28
**Branch:** `develop` — synced with origin (0 ahead / 0 behind). `develop` ⊇ `main`.
**Outcome:** #1099 fixed, committed (`5552a727`), pushed, CI green, issue closed. Nothing in flight.

## What was done

`/api/v1/sign-project` was the only v1 route still hardcoding the version header name as a
string literal. Six siblings go through `buildVersionHeaders()` (emits `X-Supabase-API-Version`,
renamed from `API-Version` by the #1018 hotfix that landed on `main` and never reached this route).
The v1 surface therefore answered in two dialects at once, live in Production.

Commit `5552a727` (`fix(api): emit X-Supabase-API-Version from /api/v1/sign-project (#1099)`):

- `src/app/api/v1/sign-project/route.ts` — both literals (POST proxy + `OPTIONS` preflight) now
  use `...buildVersionHeaders("v1")`.
- `docs/API_VERSIONING.md` — header table + all three examples corrected. Its endpoint table was
  also listing only 6 of 7 routes (`sign-project` missing); now listed.
- 5 sibling routes — stale `Version header: API-Version: v1` doc comments corrected (comments only).
- `tests/api/v1-version-header.test.ts` (new, 17 tests) — the recurrence guard.

## The new test (the important part)

Two-sided, because the failure mode was a hardcoded name:

1. **Source-level table** over every v1 route, discovered from disk (`describe.each`), so a newly
   added route is covered automatically and cannot skip the shared helper. Also asserts the table
   is non-empty, so it can't pass vacuously.
2. **Behavioural** assertions on sign-project's POST and OPTIONS responses — text matching alone
   can't prove the runtime header.

The legacy name is matched with a negative lookbehind `(?<!X-Supabase-)`, because
`X-Supabase-API-Version` *contains* `API-Version` — a plain substring check false-positives on
every correct usage.

**Verified to fail:** reinstating the two literals fails 4 assertions (2 source + 2 behavioural).
This was done deliberately, not assumed.

## Verification

- `npm test` → **2100 passed / 5 skipped** (153 files) — up exactly 17 from the 2083 baseline.
- `npm run e2e` → **62 passed / 0 failed** (1.8m).
- `npm run lint` → clean (1 pre-existing `layout.tsx` `no-page-custom-font` warning).
- `npm run typecheck` → clean.
- CI run `36470787621` on `5552a727` (sha matched HEAD): `Lint · Typecheck · Unit tests` ✓,
  `E2E (Playwright)` ✓, `Release guard` correctly skipped.
- `tsconfig.json` → `"jsx": "preserve"` (the e2e build flipped it; reverted pre-commit).

## Open issues

**#1100** `vercel env pull` overwrites `.env.local` (destroyed 4 credentials) — ~5 min, docs only.
**#1101** v1 export 403 branch — needs a second GoTrue identity in the mock; a *harness* task.
**#1102** e2e can touch the real DB because dotenv won't override an explicit `DATABASE_URL`; interacts with #1098.
**#1103** 13 stale worktrees, 14 unmerged commits, incl. two orphaned duplicate
`requireProjectOwnership` implementations. **Audit first, prune second — never `--force`.**
**#1104** markdown pushes still pay a full ~3m e2e run; `paths-ignore: ['**.md']` would fix it.
Plus **#1098** (Prisma upgrade) and **#1070** (Hydracept spike). No open PRs.

## Traps — read before acting

- **Revert the `tsconfig.json` flip before staging.** `next build`/`next dev` force
  `"jsx": "preserve"` → `"react-jsx"`. Use `git checkout HEAD -- tsconfig.json`; the bare
  `git checkout -- <file>` form restores from the *index* and cannot undo a staged flip.
  `npm ci` alone does **not** cause it.
- **`ci-wait` does not accept a commit SHA** — it took `5552a727` as a PR number and returned
  `FAILED ... after 0m 0s` against a run that was still *queued*. That conclusion was entirely
  bogus. Pass a PR number, or use `gh run watch <id> --exit-status` (redirect to a file; never
  pipe into `head`).
- **Editing YAML by replacement can silently drop a sibling key** — a `timeout-minutes: 30`
  vanished mid-session. Parse and assert keys.
- **Never `rm` a filename that might be tracked** — a prior session destroyed `.env.example`.
- The e2e harness cannot run twice concurrently (fixed ports 39901/39911/39921/39931, fixed
  container `staging-studio-e2e-pg`).
- Untracked, **pre-existing, not ours — leave alone:** `docs/dana-rig/.triage-baseline.json`,
  `docs/dana-rig/triage-summary.md`.

## Immediate next step

**#1100** — the ~5-minute docs-only fix, highest value-per-minute remaining. Then **#1103**,
starting with the per-branch content audit (do **not** begin by pruning).
