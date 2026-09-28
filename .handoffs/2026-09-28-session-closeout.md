# Session Handoff Checkpoint
**Timestamp:** 2026-09-28T18:36:20Z
**Branch:** `develop` — synced with origin. `develop` ⊇ `main` (guard passing).
**Task:** Close out a long session — quota test, credential recovery, release to Production, release guard, and the #1095 hook auto-activation. **All committed, pushed, no work in flight.**

## 1. Accomplished So Far

- **Covered the `/api/v1/export-pdf` 429 branch** in e2e (`b3b87663`). Overturned the prior handoff's premise: the export counter is a **Postgres `DailyApiUsage` row** (#784), not an in-process Map, so a spec can seed it. `DAILY_EXPORT_LIMIT: "0"` would have been *wrong* — process-wide, and it 429s every export spec including their success paths. New `tests/e2e/quota.ts` restores the prior count in a `finally`.
- **Fixed real doc drift found en route:** AGENTS.md described the `copy`/`label`/`export`/`segment` counters as in-process Maps, with a now-false caveat about export usage under-counting on cold starts. All four lines corrected.
- **Recovered a credential-destroying incident.** `vercel env pull` defaults to writing `.env.local` — the app's real env file — wiping 7 keys and the `.env` symlink. Recovered 3 from Vercel; the other 4 were `[SENSITIVE]` and unrecoverable, so the user re-issued them. Also stripped quotes that made `DATABASE_URL` unparseable, and reverted a `.env*` line the Vercel CLI added to `.gitignore`. DB confirmed working: PostgreSQL 17, `User=1 Project=3 Room=5`.
- **Deleted `.github/workflows/preview.yml`** (`a38d3ff6`) — it had never run (all three secrets unset) yet made every push red, while Vercel's git integration did all the deploying. Closed #1096 as superseded.
- **Released to Production via PR #1097** (merged, `69459a84`). Not a fast-forward: `main` held 5 commits `develop` never had. Resolved 3 conflicts, all to develop's side after verifying superset. Back-merged `main` → `develop` afterward.
- **Caught a real drift bug mid-merge:** the e2e suite failed 3 tests because main's #1018 renamed `API-Version` → `X-Supabase-API-Version` and had shipped 2 days earlier. `develop` never saw it. Code and unit tests were right; the develop-side spec was stale. **That header rename is a breaking change for external API clients and is now live.**
- **Cleared the solo-maintainer branch-protection deadlock** (1 required review + `enforce_admins` = unmeetable and un-overridable). Now 0 reviews, `enforce_admins` on, force-pushes/deletions blocked, and `Lint · Typecheck · Unit tests` required with `strict: true`.
- **Added a release guard** (`b24a9c45`): `scripts/check-develop-catchup.sh` + `npm run release:check` + a CI `release-guard` job scoped to `base_ref == 'main'`. Catches a hotfix reaching `main` without `develop` — the root cause of all the merge pain. Merge commits deliberately excluded, or it would fail after every release.
- **Fixed #1095 and closed it** (3 commits): `scripts/enable-hooks.sh` as the `prepare` lifecycle script auto-enables `core.hooksPath` on `npm install`; docs updated in the hook comment, AGENTS.md, and README. **Also fixed a second bug it exposed** — the guard's own remediation `git checkout -- tsconfig.json` cannot undo a *staged* flip (that form restores from the index), so following the hook's advice looped forever. Now `git checkout HEAD -- tsconfig.json`.
- Consulted Foreman twice: 0.91 to delete the redundant deploy path; it **abstained** on branch protection, correctly flagging that as a trust-boundary call for the user.

## 2. Modified Files

- `tests/e2e/quota.ts` — **new**. `withExportUsageAtLimit` + `dailyUsageDayKey`.
- `tests/e2e/specs/export-pdf-v1.spec.ts` — +1 test (429); header-name fix.
- `tests/e2e/env.ts` — `E2E_DAILY_EXPORT_LIMIT`.
- `scripts/check-develop-catchup.sh` — **new**, `100755`. Release guard.
- `scripts/enable-hooks.sh` — **new**, `100755`. Hook auto-activation.
- `scripts/check-tsconfig-flip.sh` — remediation advice corrected.
- `.github/workflows/ci.yml` — added `release-guard` job.
- `.githooks/pre-commit` — comment updated.
- `package.json` — added `release:check` and `prepare`.
- `.gitignore` — added `!.env.example`; `AGENTS.md` — quota counters, release-flow section, branch-protection posture, hook guard, staged-flip advice; `README.md` — hook line in Getting Started.
- `.github/workflows/preview.yml` — **deleted**.

Not ours, left alone: `docs/dana-rig/.triage-baseline.json`, `docs/dana-rig/triage-summary.md` (untracked, pre-existing).

## 3. Current Verification State

- `npm test` → **2083 passed / 5 skipped** (152 files). `npm run e2e` → **62 passed / 0 failed**. typecheck clean. lint clean (1 pre-existing `layout.tsx` warning).
- `npm run release:check` → **OK** against the remote. `core.hooksPath` → `.githooks`.
- CI green on the last pushed commit. Working tree **clean** — nothing uncommitted, nothing staged. 0 ahead / 0 behind.
- Production is live on the merged code and healthy; the user confirmed real project cards render on `/projects`, which is what verified the new `DATABASE_URL`.
- The three provider keys were **not** rotated, so the 12-day-old Vercel copies remain valid. No action needed.
- Open issues: only **#1070** (Hydracept spike, explicitly a side experiment). No open PRs.

## 4. Immediate Next Step

**Nothing is blocked, in flight, or queued.** There is no exact next action required — the natural thing is to pick from §5 deliberately, as every prior session did.

If continuing on code, the most valuable remaining item is **adding the e2e suite to CI** (a `fast-checks` sibling job). The required check covers lint + typecheck + vitest but **not** Playwright, so an e2e-only regression can still reach Production — which is exactly the class of bug the 429 test and the header-drift fix caught this session. `ubuntu-latest` has Docker and the suite is hermetic, so it is feasible; the cost is roughly 5–8 minutes per push, which is a real trade-off worth deciding deliberately.

Cheaper alternatives: document the `vercel env pull` footgun (destroyed real credentials this session, ~5 min, not yet filed), or the v1 export **403** branch — the last uncovered e2e branch, but it needs the mock Supabase server to issue a second GoTrue identity, so it is a harness task rather than a quick test.

## 5. Traps Confirmed This Session (highest-value knowledge)

- **`vercel env pull` writes `.env.local` by default** — in this repo that is the app env file *and* the symlink target. Always pass an explicit path.
- **Vercel stores Secrets unrecoverably** (`[SENSITIVE]`); only `Config`-type values pull back. Vercel is *not* a backup for API keys or `DATABASE_URL`. And `vercel env ls`'s `created` column does **not** bump when a value is edited in place — it is not proof of a sync.
- **Supabase API keys ≠ DB password.** A `service_role` JWT can never satisfy a `postgresql://` URL. Pooler username is `postgres.<ref>`. For **Prisma 5** use the pooler on **port 5432** (session mode), not 6543 — transaction mode has no prepared-statement support.
- **Vercel dashboard copy-paste includes double quotes**, which makes `DATABASE_URL` fail Prisma's URL validation with a misleading "must start with the protocol" error.
- **`git checkout -- <file>` restores from the index**, so it cannot undo a staged change. Use the `HEAD` form.
- **A `Ready` deployment proves nothing** about credentials, and neither does `/api/setup/check` (returns the same body on "no user" and "DB error"). Only a signed-in, DB-backed page verifies.
- **In bash, `read` returns non-zero at EOF** even when it captured a value — `set -e` aborts. Use `IFS= read -rs PW || true`.
- **Don't nest JS in a bash single-quoted `node -e`** — a `'` in a regex breaks the quoting. Use a separate `.mjs`.
- **ESM resolves from the script's location, not cwd** — use `createRequire("<repo path>")` for repo imports from `/tmp`.
- **A gitignore negation cannot re-include what a later rule blocks** — `!.env.example` must come *after* any tool-added `.env*`.
- **`git merge-base --is-ancestor` needs `fetch-depth: 0` in CI.**
- **I deleted the tracked `.env.example`** with a careless test loop (`touch` then `rm -f` on a real filename). Caught it in `git status` and restored. Never `rm` a filename that might be tracked.
- Tracked-but-gitignored `node_modules/.vite/**/results.json` and the `tsconfig.json` jsx flip both re-dirty on every build/test run. Revert before staging.
- Don't quote a commit hash inside the file that commit carries; use `git log -N`.

## 6. Related

- **This session's 15 commits:** read `git log --oneline -15`. Highlights: `b3b87663` (429 test), `a38d3ff6` (preview.yml removal), `b9ad5742`/`aa111a8a` (release merge + header fix), `245a2e76` (back-merge), `b24a9c45` (release guard), `7d042305`/`c688701d`/`7241a9aa` (#1095).
- **Issues:** #1081 #1083 #1084 #1085 #1095 #1096 closed; #1070 open (spike).
- **PRs:** #1097 merged (the release).
- **Archived handoffs:** `.handoffs/` (12 files; most recent `2026-09-28-hooks-guard-auto-activation.md`).
- **Scripts in `/tmp/opencode/`:** `check-db.mjs` (read-only DB check, prints no values), `set-db-password.sh` + `splice-pw.mjs`, `env.local.vercel-backup` (the clobbered file — worthless, kept only for the record). These are **not** in the repo and will not survive a machine reset.
- **Unrelated:** `spike/dana-rig-obscura` (`c22986d8`) remains unmerged.
