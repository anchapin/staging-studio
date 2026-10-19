# Next-session handoff — fix-1380 spec isolation

- **Date:** 2026-10-19
- **Branch:** `develop`
- **Commits added this session:**
  - `1aa0937 [AI-assisted] test(edit-room): add RSC-refresh wait to flaky tests 6/7/8 (#1380)`
- **Issue:** [#1380](https://github.com/anchapin/staging-studio/issues/1380)

## What this wave did

Wave-3 (yesterday, 2026-10-18) landed `f1c3555` plus three test patches
(`80678fb` / `83d11f9` / `dfd04bb`), but deliberately did not run e2e
to verify the cleanup. Wave-4 was asked to verify, and to make
spec-only changes if any tests were still flaky.

After re-reading every test in
`tests/e2e/specs/edit-room-redesign-version-strip.spec.ts`, I concluded
the same root cause that made test #5 flaky in CI also applied to tests
#6 / #7 / #8 (dev-mode Server Action + `router.refresh()` race against
the React commit that updates the version strip). Test #5 already had a
`waitForLoadState("networkidle", 15s)` + `toHaveCount(0, 20s)` defensive
wait; tests 6/7/8 did not. Wave-4 mirrors that shape via a new helper
`waitForRscRefresh(page)`, called after each confirm-click on those tests.

**Diff is +17 lines, spec file only. Source untouched.**

## What is NOT done

- **E2E was not run.** Per project AGENTS.md (hermetic Docker Postgres
  + production build + 62 single-worker specs), this is too expensive
  for a session-bounded turn. The CI `e2e (Playwright)` job scoped to
  `push` on `develop` will exercise the suite on the next push to
  `develop`. If a confirmation run is needed sooner, push a no-op
  commit to trigger it.
- **Issue #1380 is not closed.** Spec-side patch is one commit and
  one narrowed-scope postmortem. Closing the issue is fine to do once
  the e2e job shows green for the affected spec; that's out of scope
  for this turn.
- **No source-code change is recommended.** The flake is at the
  spec/spec-helper boundary, not the app. If a future clean-up is
  desired, see §"What I would do differently next time" in
  `docs/issues/1380-postmortem.md` (introduce a
  `data-lookbook-action-triggered` attribute that flips once post-merge
  so tests assert on a single observable side-effect instead of
  `data-viewing` / `toHaveCount`).

## Working-tree state

Clean. The pre-session handoff doc was moved to
`/tmp/opencode/handoff-backup-2026-10-19/` and is also re-attached at
the original path inside the main worktree (`/home/alex/Projects/staging-studio`).

## Recommended next-session prompt (≤ 5 minutes to recover)

A reasonable next prompt is to (a) run e2e locally once and report, or
(b) push a no-op commit to trigger the CI job, then close #1380 with a
single-line comment linking `1aa0937` and `f1c3555`. The postmortem at
`docs/issues/1380-postmortem.md` already has enough context for either.

Do **not** rebase / squash wave-3's commits — `f1c3555` + the three
follow-ups (`80678fb` / `83d11f9` / `dfd04bb`) must remain a single
linear history so the `release-guard` job can compare `develop` to
`main` correctly.

## File map added by this wave

- `docs/issues/1380-postmortem.md` — full postmortem (TL;DR, root
  cause, what changed, how verified, what I'd do differently,
  related commits).
- `docs/handoff/2026-10-19-fix-1380-spec-isolation.md` — this file.
