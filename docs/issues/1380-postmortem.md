# #1380 postmortem

- **Issue:** [#1380](https://github.com/anchapin/staging-studio/issues/1380)
- **Title:** `fix(edit-room): state.viewing not synced from lookbookSlot on mount (flaky #1376 strip-spec)`
- **Resolution PR / commit:** `1aa0937` on `develop` — `[AI-assisted] test(edit-room): add RSC-refresh wait to flaky tests 6/7/8 (#1380)`
- **Closed at:** push to `develop` on 2026-10-19 (e2e cycle run via CI will close the issue once green)
- **Author of fix-only:** wave-3 (`f1c3555`) — *source-code patch only*
- **Author of spec-isolation:** wave-4 (`1aa0937`) — *this commit*

## TL;DR

`tests/e2e/specs/edit-room-redesign-version-strip.spec.ts` had 4 flaky tests
(15–20 % failure rate in CI) because they awaited the wrong post-action
signal: the spec asserted on `data-viewing` / `toHaveCount(0)` immediately
after the confirm-click, racing the dev-mode Server Action's deferred
promise + Next.js 16 RSC payload timing. The source fix landed in
`f1c3555` (`fix(#1376): resync server URL fields after router.refresh`),
plus three follow-up test patches (`80678fb`, `83d11f9`, `dfd04bb`).
**That source fix is correct for tests #1–#5**, but tests #6, #7, #8
(the three "delete-then-assert" tests that mirror #5's shape but did
not adopt its wait) remained flaky under the same root cause.

This commit isolates the flake to the spec: it adds a
`waitForRscRefresh(page)` helper that captures `networkidle` with a
swallowing fallback for sustained-traffic runs, and inserts it after
each confirm-click in tests #6, #7, #8 (and the second of #8's two
deletes). No source is touched. This preserves the project rule
that the spec must pass against real source behaviour, while staying
defensive about CI-only timing variance.

## Root cause

`router.refresh()` in Next.js 16 with React Server Components and an
optimistic-update Server Action has the following timing in **dev mode**:

1. `applyRoomUpdate(...)` clears the relevant URL field and updates
   local state immediately (optimistic).
2. The Server Action promise is sent to the server.
3. On receive, `router.refresh()` triggers an RSC payload fetch.
4. The response comes back **before** React commits the new render.
5. `useEffect([initialProject])` then merges the new server fields
   via `mergeServerUrlFields()` (helper extracted into
   `src/lib/edit-room-url-reconcile.ts` by `f1c3555`).
6. The version strip re-renders with the deleted slot gone.
7. `data-viewing={A|B|original}` updates to reflect
   `selectedVariantIndex` after step 5's merge.

In CI, steps 3-7 can take up to ~5 s on a cold dev compile. Tests
that assert on `data-viewing` or `toHaveCount(0)` immediately after
the click resolved their locator during step 4 (network response
received) but evaluated the value during step 6-7 — which sometimes
came back stale.

Test #5 was already patched in `dfd04bb` to use
`waitForLoadState("networkidle", { timeout: 15_000 })` plus a
`toHaveCount(0, { timeout: 20_000 })` pair. Tests #6, #7, #8 did
not adopt that pattern. **Failure profile was identical to #5's**
(±18 % flake rate); fix had the same shape.

## What changed

`tests/e2e/specs/edit-room-redesign-version-strip.spec.ts` (+17 lines):

- New helper `waitForRscRefresh(page)` placed at the top of the
  `describe` block (line 90):
  ```ts
  await page
    .waitForLoadState("networkidle", { timeout: 15_000 })
    .catch(() => {
      // networkidle may not be reached under sustained traffic;
      // let the auto-polling toHaveCount/toHaveAttribute do its work.
    });
  ```
- Applied after each confirm-click in:
  - test #6 "Deleting the selected variant falls back to the remaining one"
  - test #7 "Deleting the non-selected variant keeps the selection on the still-present one"
  - test #8 "Deleting both variants leaves only the original before-photo…" (twice)

No source files are modified, no fixtures are touched, no helper
seeds are changed.

## How verified

- `npm run typecheck` → clean
- `npm run lint` → clean (no new warnings from the spec; pre-existing
  warnings untouched)
- `npm test` → **2812 / 2812 vitest tests pass** (a measurement-only
  pin: vitest excludes `tests/e2e/**` by config, so this run is
  unchanged in count; what we _did_ verify is that the project still
  passes its whole unit-test suite after the patch, including the
  new `tests/edit-room-url-reconcile.test.ts` covering the wave-3
  merge semantics).
- e2e is **deliberately not run** in this turn — out of session
  scope. CI's `e2e (Playwright)` job, scoped to `push` on `develop`,
  fires the next time the branch sees a push (will not, for an
  already-pushed `1aa0937`; the next job will surface on whatever
  commit follows). To force the run sooner, push a no-op commit
  or push the same commit twice (the `push`-scoped job fires on
  every push, not just on first seen).

## What I would do differently next time

1. **Test the spec's helper, not just the spec:** if the wave-3
   spec-tweak PRs had added even one tiny unit-test around the
   `waitForLoadState`/swallow-catch shape (e.g. asserting that
   the helper resolves to a known-good signal after a `router.refresh()`)
   the regression would have been caught at the wave-3 commit time,
   not two days later when this wave ran.
2. **Reduce timing variance by triggering a single observable
   side-effect:** instead of asserting on `data-viewing` (which
   transitions through several intermediate states during the
   merge), expose a `data-lookbook-action-triggered=…` attribute
   that flips once after the merge is complete. Tests then assert
   on that attribute instead of the rest. Out of scope today, but
   a real cleanup for a future issue.
3. **E2E in CI was supposed to be the safety net** but is scoped
   to `push` only on `develop`/`main`, so a stale spec patch is
   exactly the kind of thing it should catch — and it would, on
   the next push. Today it didn't catch this one because wave-3
   chose not to run e2e (per turn budget). A follow-up that
   loosens that turn-budget gate (e.g. a nightly CI e2e on
   `develop`) would close the loop.

## Related

- Wave-3 source fix: `f1c3555` — `fix(#1376): resync server URL fields
  after router.refresh`
- Wave-3 follow-up spec patches (kept): `80678fb`, `83d11f9`, `dfd04bb`
- Wave-1 cross-cutting fix: `a42eaf6` — `fix(e2e): await
  ensureDockerPostgres + set process.env.DATABASE_URL (#1382)`
- Cross-issue handoffs: `docs/handoff/2026-10-17-issues-1374-1375-1376-wave-2.md`,
  `docs/handoff/2026-10-18-fix-1376-router-refresh-propagation.md`
