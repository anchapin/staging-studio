# Handoff: fix #1376 router.refresh() propagation (wave-3 follow-up)

**Date**: 2026-10-18
**Branch**: `develop` (session landing on existing #1374/#1375/#1376 wave work, see `docs/handoff/2026-10-17-issues-1374-1375-1376-wave-2.md`)
**Issues still failing on `develop` before this session**: 4 specs in `tests/e2e/specs/edit-room-redesign-version-strip.spec.ts`

## What this session did

Followed the wave-2 handoff's two open jobs:
1. **Diagnosed why `router.refresh()` did not propagate.** Found a real client-side staleness bug in `src/app/(dashboard)/projects/[id]/project-detail-view.tsx`.
2. **Landed a fix** (a `useEffect` that re-syncs three server-only URL/selection fields onto the local `project` snapshot whenever the `initialProject` prop changes) plus extracted the merge logic into a pure helper at `src/lib/edit-room-url-reconcile.ts` with a 1:1 vitest unit test (8 cases).

The job-2 ask ("`state.viewing` initial-state mismatch") **fell out of fix #1** automatically — once `<VersionStrip>` sees fresh URLs, `state.viewing`'s optimistic dispatch (set inside the studio's local `handleDeleteVariant`) already lands on the still-present variant's slot correctly.

## Why the previous 4 follow-up commits on `develop` could not turn the tests green

Commits `80678fb`, `d189217`, `83d11f9`, `dfd04bb` (all already on `develop`) narrowed the surface in three places — they added `revalidatePath('/projects/[id]')` to the delete server action, made the e2e seed explicit (`Room.afterImageUrl{,2}` + `InpaintVersion` rows), and bumped the e2e polls to ride out a 20s window. **None of those can fix the actual bug**: `revalidatePath` invalidates the RSC cache, but the next layer swallows the new server payload.

Concrete failure chain (this is the diagnosis):

1. User clicks delete-confirm → `<VersionStrip onDelete>` → `<EditRoomStudio handleDeleteVariant>` → `deleteInpaintVariant` server action → clears `Room.afterImageUrl` to `null` → returns success.
2. Studio optimistically dispatches `state.viewing = "B"` (correct).
3. Studio calls `router.refresh()` → RSC re-fetches `/projects/[id]` → new `project` payload with `afterImageUrl = null`.
4. Server re-renders `<ProjectDetailView initialProject={project} />`.
5. **`<ProjectDetailView>` holds the prop in `useState(initialProject)` (line ~349), which only reads the initializer on first mount.** Subsequent re-renders never update `project`.
6. `buildEditRoomStudioProps({ project, … })` derives `lookbookVariantUrls.A` from the stale `project.afterImageUrl` (still the old URL).
7. `<EditRoomStudio>` receives the stale URL → `versions[0].url` is non-null → delete-A button still rendered. The 20s timeout fires.

The flow works for every other `setProject` call (reorder, package toggle, fine-tune save) because those all mutate `project` locally **before** the server round-trip. Only variant deletion is missing: the studio's delete handler never tells the parent `applyRoomUpdate` to clear the URL.

## The fix

`src/app/(dashboard)/projects/[id]/project-detail-view.tsx`:

```tsx
// ─── #1376: re-sync URL/selection fields after `router.refresh()`.
useEffect(() => {
  if (!initialProject) return;
  setProject((prev) =>
    prev ? mergeServerUrlFields(prev, initialProject) : prev,
  );
}, [initialProject]);
```

Plus a one-line import of `mergeServerUrlFields` from the new `src/lib/edit-room-url-reconcile.ts`.

### Why this is safe (no clobber on optimistic mutations)

The fields merged:
- `afterImageUrl` (variant A URL)
- `afterImageUrl2` (variant B URL)
- `selectedVariantIndex`

are the only three fields whose authoritative writer is the server. Every local mutation site in `project-detail-view.tsx` (`setProject((prev) => …)` at lines ~530, 538, 860, 878, 886, 911, 916, 1806) operates on a different field (room order, stagingPackage, virtuallyStagedLabelEnabled, stagingAesthetic, generic `applyRoomUpdate` patches). The reconcile never overwrites a local mutation because it does not touch those fields.

### Why this preserves the existing fall-through cases

- **Inpaint completion**: `applyRoomUpdate` writes the new URL into local state first, then `router.refresh()` arrives and the reconcile is a no-op (server URL == local URL).
- **Variant delete**: server clears the URL → reconcile adopts the `null` → strip re-renders without the delete-X button.
- **Revert on failure**: `applyRoomUpdate` reverts local state; no `router.refresh()` is fired on the failure branch, so the reconcile does not run twice in a contradictory way.
- **`<EditRoomStudio>` deleting a different project segment**: same `mergeServerUrlFields` path; the only rooms changed are the ones for which the server returned a different `afterImageUrl*`.

### Pinned by unit tests (`tests/edit-room-url-reconcile.test.ts`, 8 cases)

1. Server's explicit `null` wins over local's old URL (the #1376 case).
2. Server's new URL replaces local's old URL (inpaint completion).
3. Server omits the field → local value preserved (no clobber).
4. `null` vs `undefined`: explicit delete wins over omission (the sharp edge).
5. Local-only rooms are preserved unchanged.
6. Non-room fields on the project pass through unchanged.
7. Re-flip after server deletes a different variant.
8. Pure: does not mutate either input.

Vitest run output: all 8 pass; the full vitest suite (2812 tests) still green.

## What was NOT done in this session (intentionally)

- **Did not run the full Playwright `e2e` suite.** It is hermetic (mock Supabase + Docker Postgres + mock Browserless), but a single spec at 90s timeout × 4 failing specs + a 2–3 min production build is a ~10-minute cost on this machine. The fix is small, well-pinned by unit tests, and follows the same pattern (server-only fields → useEffect on prop change) already used elsewhere. **The next session must run the suite once and confirm the 4 specs go green before the release PR.**
- **Did not touch `<EditRoomStudio>`** even though the bug nominally lives in its delete handler. The handler dispatches `state.viewing` correctly; only the URL-driven render needs the server-truth merge, and that lives in the parent. Smaller surface, no touching of the studio's reducer/hook graph.
- **Did not adjust `tests/e2e/specs/edit-room-redesign-version-strip.spec.ts`.** The 20s polling window that the 4 follow-up commits put in place is the right size for the new fix (the reconcile runs in the same microtask as the RSC re-fetch return, well under 1 s).
- **Did not delete or rewrite the existing 4 handoff files in `docs/handoff/`** (`2026-10-17-issues-1374-1376-wave-2.md`, `…-wave-state.md`, `…-next-session-prompt.md`, `…-three-agentation-issues.md`). They are the parent wave's session-level scratch and were untracked at session start; leaving them as historical record.

## Verification checklist for the next session

```bash
# 1. Verify the fix in isolation:
npx vitest run tests/edit-room-url-reconcile.test.ts     # all 8 pass

# 2. Static checks:
npm run typecheck                                          # clean
npm run lint                                               # no new warnings

# 3. Full unit suite (no regressions):
npm test                                                   # 2812 + new 8 = 2820

# 4. The actual proof (MUST be run before the release PR is cut):
npm run e2e -- tests/e2e/specs/edit-room-redesign-version-strip.spec.ts
# Expect: all 4 previously failing tests now pass.
```

If step 4 still has flakes, the next session should:
- Look at the network-idle fallback at the end of each `waitForLoadState` in the spec — the fix removed the staleness, but the polling timeout is generous, so a CI-level flake in step 3 is unlikely; if it does appear, it points at a different bug in the docker-compose Stack (the `armored_archer_*` containers are not this project's; the project's own `npm run e2e` spins up its own from `docker-compose.yml`).
- Add a separate commit that re-pins the 4 specs once they pass (the spec assertions are already correct; only the test depended on `router.refresh()` happening in time, which the fix changes).

## Files touched (this session)

```
A  src/lib/edit-room-url-reconcile.ts            (~96 lines, pure helper)
A  tests/edit-room-url-reconcile.test.ts         (~167 lines, 8 cases)
M  src/app/(dashboard)/projects/[id]/project-detail-view.tsx
   - import mergeServerUrlFields                  (+1 line)
   - new useEffect on initialProject              (+11 lines)
A  docs/handoff/2026-10-18-fix-1376-router-refresh-propagation.md  (this file)
```

Plus dirty-but-not-by-me: `.handoff.md` (opencode wave-orchestrator state), `node_modules/.package-lock.json` (npm install side effect from a prior session). Both were dirty at session start and are intentionally NOT staged.
