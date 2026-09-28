# Session Handoff Checkpoint
**Timestamp:** 2026-09-28T01:50:00Z
**Repository:** staging-studio
**Branch:** `develop` (local at `b07011ae`; `origin/develop` ahead at `9bc279ee` — needs `git pull`)
**Task:** Resume Dana rig Flight stream regression work (#1073); pivot to Path A1 (Playwright 1.55 downgrade); file hermetic-e2e follow-up issue; merge PR.

## 1. Accomplished So Far

- **Path B1 (Obscura CDP) eliminated** in earlier session (PR #1074 spike). Hydration fails under Obscura identically to Chromium 142+.
- **Path A1 (Playwright 1.55 downgrade) verified working end-to-end**:
  - Set up worktree `dana-rig-playwright-downgrade` on branch `fix/dana-rig-playwright-downgrade` from `develop`.
  - Modified two rig files (see §2).
  - Brought the rig up with `UX_PROTO_APP_URL=http://172.21.0.1:39901` (docker bridge gateway — `127.0.0.1` inside the driver container is itself, not the app).
  - Ran hydration assertion: **36 DOM elements with `__reactFiber$` + `__reactProps$`; email input has `__reactEvents$` (full hydration including event handlers).**
  - Full login flow works: Magic Link click → email fill → Send Magic Link → server response ("not_found" rendered).
- **Re-based onto `origin/develop`** after PR #1074 (Obscura sidecar) was merged between filing PR #1075 and trying to merge it. Resolved conflicts in `Dockerfile.driver` (kept v1.55.0-noble + npm 1.55.0) and `driver.js` (preserved PR #1074's `if (CDP_URL)` branch structure, updated only chromium-1243 → chromium-1187 inside the legacy `chromium.launch()` branch).
- **Re-verified after rebase**: same hydration result (36 fibers), full login flow.
- **CI passed** in 1m 3s (`ci-wait1075`).
- **PR #1075 squash-merged** into `develop` as commit `9bc279ee`.
- **Issue #1073 closed** (resolved).
- **Issue #1076 filed**: `fix(hermetic-e2e): CSP connect-src blocks auth fetch to local mock Supabase (127.0.0.1:39911)` — labeled `high`, `tooling`, `test-infrastructure`, `reliability`. Body includes the failing-test pattern, the offending CSP header dump, three suggested fix paths (A: allow `127.0.0.1:39911/39912` in CSP — recommended; B: per-env relaxation; C: same-port mock), and acceptance criteria. **Open, unassigned.**
- **Worktree + branch cleaned up**: `dana-rig-playwright-downgrade` worktree removed; `fix/dana-rig-playwright-downgrade` branch deleted locally and on remote.

## 2. Modified Files

This session did NOT modify tracked files in the main checkout. Changes happened on the `fix/dana-rig-playwright-downgrade` branch (now merged) and on the issue tracker.

**Merged into `develop` via PR #1075 (commit `9bc279ee`):**
- `docs/dana-rig/docker/Dockerfile.driver`: image tag `v1.63.0-noble` → `v1.55.0-noble`; `npm i playwright@1.63.0` → `1.55.0`; restored legacy comment style + added Obscura-cross-reference note.
- `docs/dana-rig/driver.js`: chromium-1243 → chromium-1187 in the legacy `chromium.launch()` fallback paths (PR #1074's CDP branch preserved unchanged).

**Untracked / not committed in this checkout (noise, not from this work):**
- `D .handoff.md` (staged delete of stale wave-orchestration stub — this file).
- `M .vitest/json/output.json` + `node_modules/.vite/vitest/.../results.json` (rtk/vitest artifact from earlier test run).
- `?? docs/dana-rig/.triage-baseline.json`, `docs/dana-rig/triage-summary.md` (Dana rig triage artifacts from a prior session).

## 3. Current Verification State

- **`develop` HEAD ahead of local**: `origin/develop` at `9bc279ee` (PR #1075 merged), local `develop` at `b07011ae`. `git pull` needed before next session's work.
- **Dana rig (Playwright 1.55.0 / Chromium 140.0.7339.16) hydration**: ✅ verified end-to-end on the rebased commit `ca0e8f11` before merge.
- **Dana rig end-to-end login flow**: ✅ verified (Magic Link → email → Send Magic Link → server response → "not_found" rendered).
- **Hermetic e2e suite (`npm run e2e`)**: ❌ broken on `develop` HEAD — verified under BOTH Playwright 1.55 and 1.63. CSP `connect-src` mismatch (whitelists `*.supabase.co`, mock runs at `127.0.0.1:39911`). Tracked separately in **#1076** — NOT fixed by PR #1075.
- **Linter / Typecheck / Unit tests**: ✅ passed for PR #1075 (CI: 1m 3s).
- **Vercel preview**: ✅ passed.
- **Obscura CDP path (UX_PROTO_CDP_URL set)**: ⚠️ still has pre-existing gotchas from PR #1074:
  1. `OBSCURA_CDP_TOKEN` default `uxproto-dev-token` is 15 bytes; Obscura requires ≥32 bytes when bound on `0.0.0.0` — container won't start with the default.
  2. Missing `OBSCURA_ALLOW_PRIVATE_NETWORK=1` — Obscura's SSRF guard rejects RFC1918; browser cannot reach `web:39901`.
  3. These were documented in the spike branch (commit `c22986d8` on `spike/dana-rig-obscura`) but NOT merged with PR #1074. Any future use of the Obscura path needs these wired in.

## 4. Immediate Next Step

**Pick up the hermetic e2e fix (#1076).** Suggested Path A from the issue body — one-line change to `next.config.ts`:

```
connect-src 'self' http://127.0.0.1:39911 http://127.0.0.1:39912 https://*.supabase.co ...
img-src 'self' data: http://127.0.0.1:39911 http://127.0.0.1:39912 https://*.supabase.co ...
```

Concrete next actions in order:
1. `git pull origin develop` to bring local `develop` to `9bc279ee`.
2. Create worktree from `develop`: `git worktree add ../hermetic-e2e-csp-fix -b fix/hermetic-e2e-csp -b develop`.
3. Modify `next.config.ts:6` to add `http://127.0.0.1:39911` and `http://127.0.0.1:39912` to both `connect-src` and `img-src` directives.
4. Run `npm run e2e -- tests/e2e/specs/batch-staging.spec.ts:63` to verify the single test passes (was the proxy for the whole suite failing on login).
5. Run the full suite: `npm run e2e`. Expect 50+/55+ pass (the 3 currently-passing tests + most of the 34 currently-failing).
6. Pin the change with a unit test if practical (e.g., a `tests/next-config.test.ts` asserting the CSP string contains the loopback URLs).
7. Open PR against `develop`. Reference #1076.
8. After merge, optionally extend CI to include `npm run e2e` so future regressions get caught automatically.

If Path A doesn't fully resolve the suite (some specs may have their own post-login failures), triage spec-by-spec against the new trace and address each. Likely most are now unblocked once auth works.

## Related

- PR #1075: https://github.com/anchapin/staging-studio/pull/1075 (MERGED — Path A1 fix)
- Issue #1073: https://github.com/anchapin/staging-studio/issues/1073 (CLOSED — resolved)
- Issue #1076: https://github.com/anchapin/staging-studio/issues/1076 (OPEN — hermetic e2e CSP fix, next action)
- PR #1074: https://github.com/anchapin/staging-studio/pull/1074 (MERGED — Obscura CDP sidecar, separate scope)
- Spike branch `spike/dana-rig-obscura` (commit `c22986d8`): contains the OBSCURA env gotchas documentation + the missing `OBSCURA_ALLOW_PRIVATE_NETWORK=1` fix that did NOT get merged with PR #1074.