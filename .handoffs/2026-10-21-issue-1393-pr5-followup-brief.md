# Handoff brief — issue #1393 follow-up (after PR #1412)

## Context

Phase-2 PR-5 of the Wave-5 service-split revival (#1389, #1393) shipped
as **PR #1412** (`feat/issue-1393-require-user-helper` → `develop`,
branch-only, NOT YET MERGED). The diff:

- `src/lib/test/require-user.ts` (new, 73 LOC) — shared factory
- `tests/require-user.test.ts` (new, 63 LOC) — 6 unit tests
- `tests/export-pdf-service.test.ts`, `tests/generate-copy-service.test.ts`,
  `tests/label-instances-service.test.ts`, `tests/segment-furnishings-service.test.ts`
  — migrated to the helper

CI `Lint · Typecheck · Unit tests` is green. Full `npm test` (232 files /
2903 tests) green. `npm run build` succeeds. The required check for `main`
is satisfied, but `main` does not yet have the helper — that's the
release-management gap this brief addresses.

Companion handoffs (read in order):
- `.handoffs/2026-10-20-issue-1393-mock-helper-brief.md` — original
  PR-5 brief (history, scope, decisions)
- `.handoffs/2026-10-20-issue-1393-require-user-helper-plan.md` —
  implementation plan with design rationale
- `.handoffs/2026-10-20-issue-1393-pr5-self-report.md` — self-report,
  decisions surfaced, CI status snapshot

## What landed vs. what was deferred

Land PR-5 as-is:

- `requireUser()` returns `{ user, mockGetAuthedPrismaUser }`. Deps-injected
  services bind the mock; param-passed services bind the user literal.
  Both halves travel from one call so they cannot drift apart.
- Auth-failure tests keep their own `vi.fn(async () => null)`. The
  helper is user-present only.

Deliberately deferred from PR-5 (do NOT touch in this PR):

- Per-test `expect(deps.getAuthedPrismaUser).toHaveBeenCalledTimes(1)`
  assertions. The brief framed the capability as something the helper
  *unlocks*, not requires. Downstream `claimDailyQuota(..., userId, ...)`
  assertions already exercise the "user flow" path.
- The route-level `tests/api/label-instances-route.test.ts` and
  `tests/api/segment-furnishings-route.test.ts` still mock
  `requireProjectOwnershipOrThrow` at the module level. Migrating those
  to use `requireUser()` for parity is a separate refactor.

## Task list (priority order)

The next session's job: drive PR #1412 to merge and close #1393 cleanly.
Steps in order, with the verification each one requires.

### 1. Review PR #1412

`gh pr view 1412 --comments`. Confirm the diff matches
`.handoffs/2026-10-20-issue-1393-pr5-self-report.md` and the merge
target is still `develop`. If reviews requested changes, address them
on the same branch via `git push` — do not open a new PR.

### 2. Merge PR #1412 into develop

`gh pr merge 1412 --squash` (or `--merge` if commits should stay distinct;
the brief doesn't dictate — use the project's default convention). Per
AGENTS.md "`develop` is unprotected and ordinary work is pushed to it
directly", so a self-merge is permitted. The required `Lint · Typecheck
· Unit tests` check is already green.

### 3. Verify the merge's e2e run

The `e2e` job is **push-scoped on `develop`/`main`** but **NOT `pull_request`-scoped**
(per AGENTS.md "it scopes to `push` because the work lives on develop").
A push to `develop` should fire the e2e run. Watch it:

```
gh run watch --repo anchapin/staging-studio
```

OR check the runs on `origin/develop` post-merge:

```
gh run list --branch develop --limit 5
```

The e2e suite is hermetic (Docker + mock providers), so no secrets are
needed. It runs ~62 specs against a production build. PR-5 doesn't touch
the routes it exercises (those go through `tests/e2e/specs/export-pdf*`),
but a green run is a useful regression signal. If it fails, inspect
whether the failure is in any of the affected files
(`src/lib/test/`, the four `tests/*-service.test.ts` files — none of
which the e2e suite imports); if not, the e2e failure is environmental
and out of scope for #1393.

### 4. Update issue #1393

Post a closing comment on `#1393` with:
- PR link (`#1412`) and merge commit SHA
- Brief stats: 6 files / +154 / −36 LOC
- The deferred items above so the next wave-5 sub-task has them

Then run `gh issue close 1393 --reason completed` (or use a "Done" label
if the repo uses labels instead of state). Confirm with the project's
closeout convention via `gh issue view 1393 --comments` first.

### 5. Back-merge develop → main (release cycle)

This step is NOT this session's job — it belongs to the next release
flow. Record it as a follow-up and surface it as a comment on the merged
PR so the next release reviewer picks it up. The pattern (per AGENTS.md
"Releasing to Production"):

1. From a release branch off `main`, merge `develop` in.
2. Open a `develop → main` PR.
3. The `release-guard` job checks that `develop` is caught up — it will
   fire if the only divergence is the new helper. Resolve by landing
   the helper on `main` (which this PR does via the merge-back).

Until that release, `main` runs the e2e suite without the helper. None
of the e2e specs import `src/lib/test/require-user.ts`, so this is safe
but worth tracking.

### 6. Track the deferred items as follow-up issues (optional)

If you want the deferred items to land cleanly rather than
disappear, open two issues now so the wave-5 closeout stays accurate:

- **"Add `getAuthedPrismaUser()` call-count assertions across the four
  service tests"** — small, focused, ~4 lines of edits per test.
- **"Migrate `tests/api/{label-instances,segment-furnishings}-route.test.ts`
  to use `requireUser()` for parity"** — route-level auth mocking
  refactor; bigger diff, may touch `tests/api/*.ts` imports.

Both are explicitly out of scope for PR-5. If they don't have a
specific upcoming driver, leave them as a comment on PR #1412 instead
of new issues — the PR's discussion is searchable and
`gh issue list --search "requireUser"` will find it.

## Constraints (carried over from #1393 PR-5 brief)

- Do NOT introduce a per-test `getAuthedPrismaUser` call-count assertion
  in this PR. That's the deferred item above; PR-5 didn't land it,
  and un-deferring it requires its own discussion.
- Do NOT touch the route-level auth mocks. Out of scope.
- Do NOT auto-merge the same PR you're driving twice. If the merge
  triggers a CI regression, open a fix PR rather than force-pushing
  to the closed `#1412`.
- Do NOT skip the e2e watch in step 3. The e2e suite is the only
  browser-level regression check on this PR (the push-scoped job is
  the canonical signal).

## Output expectations

When this brief's session closes, write a one-section addendum to
`.handoffs/2026-10-20-issue-1393-pr5-self-report.md` (or a sibling
`2026-10-21-issue-1393-pr5-followup-report.md`) with:

- PR merge SHA and merge commit link
- e2e run link + pass/fail (with the run ID for traceability)
- `#1393` close status and any follow-up issue numbers opened
- Any decisions surfaced during merge review

Reference this brief by path. Do not restate it.
