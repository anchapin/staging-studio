# Session Handoff Checkpoint
**Timestamp:** 2026-09-28T11:35:00Z
**Repository:** staging-studio
**Branch:** `develop` at `4b5465d8` (synced with `origin/develop`)
**Task:** Hermetic e2e suite triage — resume from #1076, fix CSP blocker, file follow-ups, batch easy fixes.

## 1. Accomplished So Far

- **#1076 fixed & merged (PR #1077, commit `4dac8ca2`)**: extracted `SECURITY_HEADERS` + `CSP_VALUE` into `src/lib/security-headers.ts`; added `http://127.0.0.1:*` and `wss://127.0.0.1:*` to `connect-src` and `img-src`. Pinning test in `tests/next-config.test.ts` (4/4 pass). Loopback wildcard — no production surface.
- **#1080 + #1082 fixed & merged (PR #1086, commit `4b5465d8`)**: relaxed two stale test assertions in `tests/e2e/specs/export-pdf.spec.ts` (assert on stable message `"projectId must be a valid CUID"` instead of never-shipped `"invalid_project_id"` code) and `tests/e2e/specs/version-history.spec.ts` (loose `^${runPrefix}.+\.jpg$` regex for timestamp+UUID filenames).
- **6 follow-up issues filed**: #1078 (sign-project token ordering, high/security), #1079 (cuid-shaped seed projectIds, high), #1081 (batch-staging file input, revised with filechooser fix path after investigation showed original fix paths didn't work), #1083 (lookbook-edit Preview→Export timing), #1084 (rehearsal cascade, depends on #1079), #1085 (Browserless outage drill UI text).
- **Net e2e delta**: 3 passing / 34 failing (pre-PR-1077) → **41 passing / 13 failing** (current on `develop`). One flaky test (mask-paint) observed passing in re-runs.

## 2. Modified Files

**This session did NOT modify tracked files in the main checkout.** All work happened on merged branches:

**Merged via PR #1077 (commit `4dac8ca2`):**
- `next.config.ts` — imports `SECURITY_HEADERS` from new lib
- `src/lib/security-headers.ts` (new, 60 lines) — exports `CSP_VALUE` + `SECURITY_HEADERS`
- `tests/next-config.test.ts` (new, 49 lines) — pins loopback allowlist

**Merged via PR #1086 (commit `4b5465d8`):**
- `tests/e2e/specs/export-pdf.spec.ts` — replaced `body.code === "invalid_project_id"` assertions with `body.message` contains `"projectId must be a valid CUID"`
- `tests/e2e/specs/version-history.spec.ts` — loosened filename regex from `^${runPrefix}\\d+\\.jpg$` to `^${runPrefix}.+\\.jpg$`

**Untracked / not committed (noise, not from this work):**
- `?? docs/dana-rig/.triage-baseline.json`, `?? docs/dana-rig/triage-summary.md` — Dana rig triage artifacts from a prior session (per AGENTS.md, leave for separate housekeeping).

**Archived earlier in this session:** previous `.handoff.md` → `.handoffs/2026-09-28-hermetic-e2e-csp.md` (commit `484ce99c`).

## 3. Current Verification State

- **`develop` HEAD**: `4b5465d8` (synced with `origin/develop`).
- **PR #1077 CI**: ✅ passed (1m 18s) → merged.
- **PR #1086 CI**: ✅ passed (1m 17s) → merged.
- **Hermetic e2e suite (`npm run e2e`)**: 41 passed / 13 failed on `develop` HEAD (was 3 / 34 pre-PR-1077). Remaining 13 failures cascade from 6 open issues:
  - 4 fail on `#1079` (cuid-shaped seed projectIds needed for /api/export-pdf 400 path) — affects `export-pdf.spec.ts:36,86`, `rehearsal.spec.ts:34,211`.
  - 3 fail on `#1078` (sign-project token ordering) — affects `signoff.spec.ts:82,159,189`.
  - 2 fail on `#1081` (batch-staging file input) — affects `batch-staging.spec.ts:78,122`.
  - 1 fails on `#1083` (lookbook-edit Preview→Export timing) — affects `lookbook-edit.spec.ts:113`.
  - 1 fails on `#1085` (Browserless outage drill UI text) — affects `export.spec.ts:45`. May auto-resolve with #1079.
  - ~2 are intermittent (mask-paint flaky).
- **Linter / Typecheck / Unit tests**: ✅ clean for both merged PRs.
- **Vercel preview**: ✅ passed for both PRs.

## 4. Immediate Next Step

**Pick up #1078 — fix `/api/sign-project` token ordering** (the only `high`+`security` open issue and the highest-value remaining work). It's a real security/correctness bug: the route calls `requireUser()` BEFORE validating the HMAC preview token, so anonymous cookie-less signing via the token surface (issue #684's whole point) is currently broken at the API layer.

Concrete next actions in order:
1. Create worktree from `develop`: `git worktree add ../sign-project-token-ordering -b fix/issue-1078-sign-project-token-ordering develop`.
2. Read `src/app/api/sign-project/route.ts` and confirm the gate order: `requireUser()` runs before `verifyPreviewToken(validation.data.token)`.
3. Swap the gate order per the issue body's suggested diff: parse + validate token FIRST, then either trust the token (skip session) or fall through to `requireUser()` as defense-in-depth.
4. Run `npm run e2e -- tests/e2e/specs/signoff.spec.ts` — expect 4/4 pass.
5. Run `npm run e2e` — expect ~46 passed / ~8 failed (3 signoff tests + cascade fixes).
6. Pin the change with a unit test in `tests/sign-project-route.test.ts` if practical (asserts the token is checked before `requireUser`).
7. Open PR against `develop`. Reference #1078.

After #1078 lands, **#1079** (cuid-shaped seed projectIds) is the next highest-leverage fix — it's test-infra only (6-line change in `tests/e2e/env.ts`) and unblocks 4 more e2e failures (#1084 cascade + parts of #1085).

## Related

- **PRs this session:** #1077 (merged), #1086 (merged).
- **Issues filed this session:** #1078, #1079, #1081, #1082, #1083, #1084, #1085.
- **Issues auto-closed:** #1076, #1080, #1082.
- **Open follow-ups at session end:** #1078, #1079, #1081, #1083, #1084, #1085 (6 issues, all hermetic-e2e).
- **Prior merged context:** #1075 (Dana rig Playwright 1.55 downgrade), #1074 (Obscura CDP sidecar spike).
- **Prior spike (not merged):** `spike/dana-rig-obscura` (commit `c22986d8`) contains the OBSCURA env-var gotchas documentation + the missing `OBSCURA_ALLOW_PRIVATE_NETWORK=1` fix that did NOT ship with PR #1074.
