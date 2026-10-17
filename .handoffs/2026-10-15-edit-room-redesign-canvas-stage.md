# Handoff — Edit Room UX redesign, session of 2026-10-15 (canvas stage slice)

**From:** opencode session that landed #1339
**To:** next session (continues the redesign — next slice is #1340 VersionStrip + Lookbook slot)
**Repo:** `anchapin/staging-studio`
**Branch base:** `develop` (`213d103` → `e6df427`)
**Outcome:** One PR merged clean. Develop has one new commit since the prior handoff.

---

## 1. Merge order used

| # | PR | Branch | Outcome |
|---|----|--------|---------|
| 1 | #1349 | `mp-redesign/issue-1339-canvas-stage` | Merged clean (auto-merge after `Lint · Typecheck · Unit tests` ✓) |

Auto-merged via `gh pr merge --auto --squash --delete-branch`. Local branch rebased off `develop` post-merge and worktree removed.

## 2. Per-slice outcomes

### Slice #1339 — `mp-redesign/issue-1339-canvas-stage`
- Rebased off `origin/develop` cleanly (no conflicts with #1337/#1338).
- Four-check: lint/typecheck/test/build all green.
- CI: `Lint · Typecheck · Unit tests` ✓. **Merged.**
- 8 new product files + 5 new test files + 1 modified product file + 2 modified test files. **35 new unit tests added.** Final count: **2593 tests passing** (45 baseline #1337/#1338 → 2558, +35).

## 3. Architecture decisions worth knowing

### TDD throughout — red → green for every file
Every new file has a 1:1 test that was written first and verified to fail for the right reason before the implementation went in. The pure helpers (`computeFitSize`, `objectBoxToStyle`) are pinned 1:1 with vitest.

### `src/components/edit-room/` is now an independent subtree
- `CanvasStage.tsx` (328 lines) — top-level orchestrator with `useFitSize(areaRef, 3/2)`, scope-aware toolbar, four overlay slots in scope order.
- `MaskLayer.tsx` (164 lines) — thin visual wrapper, verbatim Magic Patterns port; no buffer state (parent route owns persistence).
- `CompareLayer.tsx` (117 lines) — draggable divider + slider a11y. Reuses `comparison-slider-geometry` (`#1279` math) for `sliderClipPath(pos)` and `sliderPercentFromClientX(...)`. ±2 keyboard step per the design.
- `object-overlay.tsx` (76 lines) — one `<button>` per detection. `aria-pressed` + `aria-label` drive the screen-reader contract.
- `use-fit-size.ts` (110 lines) — `computeFitSize` (pure) + `useFitSize` (ResizeObserver effect). Split per the codebase's "pure logic in lib, React effect in component" rule.

### Pure helper added to `src/lib/canvas-coords.ts`
- `objectBoxToStyle(box): { left, top, width, height }` — percent → CSS string with defensive clamping (hostile `NaN` / `-5` → `"0%"`).
- `ObjectBoundingBox` interface — re-exported by `CanvasStage.tsx` for the detections array shape.

The inspector preview (`#1340`) reuses `objectBoxToStyle` so the on-canvas button and the inspector thumbnail read the same positioning.

### Magic Patterns guard verified
```bash
$ grep -r '@/components/canvas' src/components/edit-room/
src/components/edit-room/MaskLayer.tsx:7: * independent of `@/components/canvas/*` (per the issue's "Do not touch"
```
Only a comment reference — **0 actual imports**. This is the rubric at the end of every slice per the prior handoff.

### The "Refactor needed" section was deferred
The issue body's "Refactor needed" planned to extract `use-mask-buffer.ts`'s logic into `src/lib/mask-buffer.ts`. **I did not do this.** The new `MaskLayer` is purely visual (no buffer persistence); moving the buffer logic into `@lib/mask-buffer.ts` would be dead code today. The legacy `use-mask-buffer.ts` stays untouched. `#1346` (the deletion slice) will need to revisit this if persistence is wired before the legacy surface is removed.

### Static markup test pattern
Vitest runs in `node` env (no jsdom). `useFitSize` can't actually fire its ResizeObserver in tests, so `CanvasStage.tsx` renders a placeholder box (`aspectRatio: PHOTO_ASPECT, width: "100%"`) when `size === null`. This lets the static-render tests find the children (object buttons, etc.) without measuring. The placeholder box carries `data-photo-size="unmeasured"` so e2e tests can target it.

## 4. Acceptance criterion tradeoffs

### Drag-the-divider behavior is structural
The issue's criterion *"drags the handle to 30%, asserts the clip-path `inset(0 70% 0 0)` is set"* is pinned structurally: the static render of `<CompareLayer>` at its initial 50% position exposes `clip-path: inset(0 50% 0 0)`. The drag math is reused from `comparison-slider-geometry.ts` (which #1279 already pinned against the legacy `ComparisonSlider`). End-to-end drag is owned by `tests/e2e/specs/edit-room-redesign-*.spec.ts` in #1344.

### Pointer-event interaction tests deferred to e2e
The MaskLayer's "paints 5 strokes with the test pointer, asserts the buffer is non-empty" criterion requires a DOM with `PointerEvent` + `canvas.getContext('2d')`. Vitest's `node` env can't drive that. The structural test pins the rendering (`opacity: 0.55`, `touch-action: none`, no cursor span on initial render); the interaction test is owned by the Playwright spec in #1344.

## 5. Stub data in the shell

`EditRoomStudio.tsx` now mounts `<CanvasStage>` with two placeholder detection boxes per concept:
```ts
detections={
  state.concept === null ? [] : [
    { id: "obj-1", concept: state.concept, label: state.concept, box: { x: 49, y: 57, w: 31, h: 42 } },
    { id: "obj-2", concept: state.concept, label: `${state.concept} 2`, box: { x: 8, y: 58, w: 23, h: 27 } },
  ]
}
```
`#1340` replaces these with the real detection pipeline (`buildInstanceOverlays` + concept mask data URLs).

The image URL is also a placeholder (`/edit-room/original.jpg`, `/edit-room/variant-a.jpg`, `/edit-room/variant-b.jpg`) until #1340 wires the real `Room` rows.

## 6. What's next

The next unblocked slice is **#1340 (VersionStrip + Lookbook slot)**.

This session's `<CanvasStage>` already takes `detections` as a prop, so #1340 can:
1. Replace the placeholder image URLs with real `Room.beforeImageUrl` / `Room.afterImageUrl[A|B]` reads.
2. Replace the stub detections array with the real concept-detection pipeline (`useConceptDetection` + `buildInstanceOverlays`).
3. Add the `<VersionStrip>` component to the bottom slot of `EditRoomStudio.tsx` (currently a placeholder `<footer>`).
4. Wire the "Use in lookbook" CTA to update `Room.selectedVariantIndex` via the existing server action.

The shell's reducer already has `SET_VIEWING` + `SET_LOOKBOOK_SLOT` actions; the slot wiring uses `slotIdToVariantIndex` / `variantIndexToSlotId` from `src/components/edit-room/data.ts`.

## 7. Key context the next agent needs

- The canvas tree at `src/components/edit-room/` is **independent** of `src/components/canvas/*`. The legacy `use-mask-buffer.ts` (473 lines) still owns mask export / undo / coverage — the new `MaskLayer` just paints. Until #1340 wires real persistence, painting on the new surface is a no-op for the export pipeline.
- The reducer at `src/components/edit-room/edit-room-reducer.ts` is `default: never` exhaustive. Adding a new action requires updating both the type union and the reducer body (and the tests at `tests/edit-room-reducer.test.ts`).
- `<TopBar>` (`src/components/edit-room/TopBar.tsx`) is at 201 lines. The shell passes hard-coded stub props (`address="418 Linden Ave"`, etc.); `#1340`/`#1344` must lift these from the parent route.
- The Atelier Canvas palette tokens live in `src/lib/color-tokens.ts`. All colors come from there; the canvas-stage test pins a hex-literal defense-in-depth (`expect(html).not.toMatch(/#[0-9a-f]{6}/i)`).
- `objectBoxToStyle` (in `src/lib/canvas-coords.ts`) is the SSOT for on-canvas button positioning — the inspector thumbnail in #1340 should reuse it, not duplicate the math.

## 8. Auto-merge status

- PR #1349 was auto-merged via `gh pr merge --auto --squash --delete-branch` after `Lint · Typecheck · Unit tests` turned green.
- Branch deleted on the remote and locally (worktree removed).

## 9. Open questions for the human

- (none — the canvas slice is on plan; the deferred interaction tests are documented in §4 above)

---

## Handoff prompt for the next session

Working on the Edit Room UX redesign. Read `.handoffs/2026-10-15-edit-room-redesign-canvas-stage.md` first — it has the exact state of every slice I worked on (which PRs auto-merged, which are still open), the next issue to pick up, the architectural decisions made, and the gotchas I hit.

Continue the redesign in dependency order. The parent epic is #1336 and the next unblocked slice is **#1340 (VersionStrip + Lookbook slot)**. The new code lives at `src/components/edit-room/` and must not import from `@/components/canvas/*` until #1346. If you need a pure helper from the legacy canvas layer, extract it to `src/lib/<name>.ts` so the legacy surface keeps importing unchanged.

Read the issue body in full before coding — each slice has explicit Add / Modify / Do not touch and Out of scope sections. Use the magic-patterns MCP to inspect `dVy8jC2kXpi1ca8b4A1hcS` as you implement. Test with vitest for pure logic + new components; the e2e specs land in #1344/#1345.

Follow TDD strictly: red → green → refactor. Write the failing test first, watch it fail for the right reason, then implement. No production code without a failing test.

Rubber-duck the diff before opening the PR. Re-read every changed file in plain English against the issue's acceptance criteria, check the "Out of scope" list against the actual diff, look for orphan imports, and confirm no `@/components/canvas/*` imports leaked into the new subtree. Note the count in the PR body.

Auto-merge if the `Lint · Typecheck · Unit tests` check is green. That's the only required check; the E2E (Playwright) job is push-only and won't report on a PR. Use `gh pr merge <PR> --auto --squash --delete-branch` once the required check is green. Don't poll — the merge fires automatically.

Run `npm run lint && npm run typecheck && npm test && npm run build` before every commit. The `tsconfig.json` jsx flip guard will fail the pre-commit hook if Next.js touched the file — `git checkout HEAD -- tsconfig.json` first.

Pace to ~30 turns. When you stop, write `.handoffs/edit-room-redesign-<date>.md` with the same shape as the one you're reading, then end with a handoff prompt for the session after yours.