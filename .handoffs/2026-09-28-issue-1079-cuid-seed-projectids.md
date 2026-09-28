# Session Handoff Checkpoint
**Timestamp:** 2026-09-28T11:40:02Z
**Repository:** staging-studio
**Branch:** `develop` at `2c3126c6` (synced with `origin/develop`)
**Task:** Hermetic e2e suite triage — continue past #1078, pick up #1079 (cuid-shaped seed projectIds) next.

## 1. Accomplished So Far

- **#1078 fixed & merged (PR #1087, commit `4c81a27e`)**: swapped the gate order in `src/app/api/sign-project/route.ts` so payload parse + `verifyPreviewToken` + `tokenMatchesProject` run BEFORE `getAuthedPrismaUser`. Cookie-less preview visitors (the whole point of the issue #684 token surface) now reach the Prisma write. Authenticated firm users still go through the ownership check as defense-in-depth. Pinned by 12 new cases in `tests/sign-project-route.test.ts` (including a `verifyPreviewToken`-before-`getAuthedPrismaUser` call-order assertion) and an updated stale pin in `tests/api/sign-project-route.test.ts`.
- **PR #1087 CI**: ✅ passed (1m 18s) → squash-merged. Issue **#1078 auto-closed** by the PR merge.
- **Worktree cleaned up**: `../sign-project-token-ordering` removed; branch `fix/issue-1078-sign-project-token-ordering` deleted locally and on `origin`.
- **Handoff archived**: previous `.handoff.md` → `.handoffs/2026-09-28-issue-1078-sign-project-token-ordering.md` (commit `2c3126c6`).
- **Net e2e delta expected**: 41 passed / 13 failed → ~**44 passed / 10 failed** (3 signoff tests in `signoff.spec.ts:82,159,189` should flip from red to green; remaining 10 failures cascade to #1079/#1081/#1083/#1084/#1085).

## 2. Modified Files

**This session did NOT modify tracked files in the main checkout.** All work happened on the merged branch:

**Merged via PR #1087 (commit `4c81a27e`):**
- `src/app/api/sign-project/route.ts` — gate-order swap; `verifyPreviewToken` now runs before `getAuthedPrismaUser`; ownership check moved inside `if (user)` block so cookie-less preview visitors bypass it; JSDoc updated to describe the new contract.
- `tests/api/sign-project-route.test.ts` — replaced the stale "rejects unauthenticated requests with 401 → 'Unauthorized'" pin (which encoded the bug) with one expecting "expired or is invalid" + annotated with #1078.
- `tests/sign-project-route.test.ts` (new, 295 lines) — 12 cases pinning the new gate order, including a call-order regression pin (`verifyOrder < getUserOrder`), cookie-less 200, tampered-token 401, wrong-project 401, auth+ownership 200, auth+no-ownership 403, missing-project 404, already-Signed 409, invalid projectId 400, missing-token 401, Prisma-failure 500 (with `sign_project_save_failed` log), and `withRetry` wrapper presence.

**Committed locally only (not pushed):**
- `.handoffs/2026-09-28-issue-1078-sign-project-token-ordering.md` — archived handoff (commit `2c3126c6`). No follow-up commit planned; `origin/develop` is already at `4c81a27e` and contains the handoff archive path implicitly via the next commit when one lands.

**Untracked / not committed (noise, not from this work):**
- `?? docs/dana-rig/.triage-baseline.json`, `?? docs/dana-rig/triage-summary.md` — Dana rig triage artifacts from a prior session (per AGENTS.md, leave for separate housekeeping).

## 3. Current Verification State

- **`develop` HEAD**: `2c3126c6` (synced with `origin/develop` via PR #1087 merge).
- **PR #1087 CI**: ✅ passed (1m 18s) → merged.
- **Linter** (`npm run lint`): ✅ clean (0 errors; pre-existing `src/app/layout.tsx:49` custom-font warning unchanged).
- **Typecheck** (`npm run typecheck`): ✅ clean.
- **Unit tests** (`npx vitest run`): ✅ **2070 passed / 5 skipped / 0 failed**.
- **Targeted unit tests** (`tests/sign-project-route.test.ts` + `tests/api/sign-project-route.test.ts`): ✅ **17/17 passed**.
- **Hermetic e2e suite** (`npm run e2e`): NOT RUN this session (requires Docker). Expectation: 41 → ~44 passing on `develop` HEAD (3 signoff tests flip green). Remaining ~10 failures cascade to #1079/#1081/#1083/#1084/#1085.
- **Vercel preview**: ✅ passed for PR #1087 (CI green).

## 4. Immediate Next Step

**Pick up #1079 — fix e2e seed `projectId` shape (cuid vs nanoid)** (the next highest-leverage hermetic-e2e fix). It's a 6-line change in `tests/e2e/env.ts` and unblocks 4 e2e failures (`export-pdf.spec.ts:36,86`, `rehearsal.spec.ts:34,211`, plus cascade into #1084 and parts of #1085). Per the issue body, the seeded projectIds must match Prisma's cuid pattern (`/^c[a-z0-9]{24}$/`, enforced by `lib/sign-project-schema.ts:16`) so the `/api/export-pdf` 400 path can be asserted in tests that mint a token for the seeded project.

Concrete next actions in order:
1. Create worktree from `develop`: `git worktree add ../cuid-seed-projectids -b fix/issue-1079-cuid-seed-projectids develop`.
2. Read `tests/e2e/env.ts` (the `E2E_*_PROJECT_ID` constants) and confirm the seeded strings aren't already cuid-shaped.
3. Read `tests/e2e/global-setup.ts` to confirm it sets `id` from those constants when seeding (or change it to do so); if Prisma auto-generates cuids anyway, the env-constant fix alone may be sufficient.
4. Replace any nanoid-shaped constants with cuid-shaped ones (e.g. `csignoff00000000000000aa`, `creport0000000000000aaaa`, `clookbook000000000000aaaa`, `cpreview0000000000000aaaa`) — verify each new value matches `PROJECT_ID_PATTERN`.
5. Run `npx vitest run` (the seed changes can affect unit tests that import the constants).
6. Run `npm run e2e -- tests/e2e/specs/export-pdf.spec.ts tests/e2e/specs/rehearsal.spec.ts` — expect ~6 of the 4 remaining-cascade failures to flip green.
7. Run the full `npm run e2e` — expect ~50 passed / ~6 failed (4 export-pdf/rehearsal + parts of #1085 may auto-resolve).
8. Open PR against `develop`. Reference #1079.

After #1079 lands, **#1081** (batch-staging file input — the filechooser fix path) is next, then **#1083** (lookbook-edit Preview→Export timing), then **#1084** (rehearsal cascade, depends on #1079), then **#1085** (Browserless outage drill UI text — likely auto-resolves once #1079 lands).

## Related

- **PRs this session:** #1087 (merged).
- **Issues filed/closed this session:** #1078 (closed via PR #1087).
- **Open hermetic-e2e follow-ups at session end:** #1079, #1081, #1083, #1084, #1085 (5 issues).
- **Prior merged context:** #1077 (Dana rig Playwright 1.55 downgrade), #1074 (Obscura CDP sidecar spike), #1086 (relax two stale e2e assertions).
- **Prior spike (not merged):** `spike/dana-rig-obscura` (commit `c22986d8`) contains the OBSCURA env-var gotchas documentation + the missing `OBSCURA_ALLOW_PRIVATE_NETWORK=1` fix that did NOT ship with PR #1074.