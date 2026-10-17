# #1346 audit — what `src/components/canvas/` and `src/lib/` files the new `EditRoomStudio` surface actually still needs

Generated for the wave-5 delete pass. The issue body's "26 components / 14
hooks / 8 lib files" counts were estimated before the wave-2/3/4 PRs landed;
the actual import map is much smaller. The delete commit shrinks dramatically.

## Methodology

Two greps from the worktree root:
- `grep -rln "from \"@/components/canvas/<base>\"" src/` (external = outside `canvas/`)
- `grep -rln "from \"@/lib/<base>\"" src/ tests/` (external = outside the lib file itself)

Plus a per-file scan of `src/components/edit-room/*.tsx` to enumerate
their `@/lib/*` imports, and a search for any `edit-room/*` file
importing from `@/components/canvas/*` (zero hits — the new surface has no
direct `canvas/` dependency).

## The keep set (new surface genuinely depends on these — DO NOT DELETE)

### `src/lib/` (5 files)
- `canvas-coords.ts` — used by `edit-room/CanvasStage.tsx`,
  `edit-room/object-overlay.tsx` (object-box style math).
- `comparison-slider-geometry.ts` — used by `edit-room/CompareLayer.tsx`.
- `inpaint-source.ts` — used by `edit-room/EditRoomRunCluster.tsx`.
- `autosave-controller.ts` — used by `edit-room/EditRoomStudio.tsx`.
- `staged-result.ts` — used by `lookbook/room-spread.tsx` (also outside
  the delete scope, but a wave-5 candidate to leave alone).

### `src/components/canvas/` (3 files, used OUTSIDE `edit-room/`)
- `comparison-pill.tsx` — used by `lookbook/room-spread.tsx` (lookbook page).
- `comparison-slider.tsx` — used by `lookbook/room-spread.tsx` (lookbook page).
- `use-inpaint-runs.ts` — used by `edit-room/EditRoomRunCluster.tsx`
  (the only edit-room → canvas/ link that survived the wave PRs; the hook
  itself is not legacy — it has no dependency on `InpaintEditor`).

## The delete set (everything else in `canvas/` and legacy lib files)

The issue body estimated "26 components / 14 hooks / 8 lib files". The
actual external-consumer map (greps from the worktree root, this audit
was generated before Commit 2):

### `src/components/canvas/` — 52 files to delete (revised count)

**43 files with ZERO external consumers** (used only by the legacy
`inpaint-editor` subtree, all of which is also being deleted):

```
batch-staging-panel.tsx
collapsible-section.tsx
detect-tab-panel.tsx
editor-canvas-pane.tsx
editor-inspector-column.tsx
editor-inspector-save-status.tsx
editor-tab-bar.tsx
entire-tab-panel.tsx
exit-to-project-button.tsx
focus-restore-pill.tsx
inpaint-editor.tsx
inpaint-editor-props.ts
inpaint-mask-canvas.tsx
inpaint-mask-canvas-props.ts
inpaint-operation-mode-tabs.tsx
inspector-collapsed-rail.tsx
inspector-footer-panels.tsx
inspector-header.tsx
manual-tab-panel.tsx
mask-canvas-stage.tsx
mask-canvas-toolbar.tsx
mask-composition.ts
mask-dilation-controls.tsx
source-image-header.tsx
source-selector-fieldset.tsx
stage-entire-room-preset.tsx
use-concept-detection.ts
use-editor-tabs.ts
use-image-dimensions.ts
use-mask-buffer.ts
use-mask-keyboard-painting.ts
use-mask-overlay-layer.ts
use-mask-painting.ts
use-segment-prewarm.ts
use-selection-mask-composer.ts
use-source-selection.ts
use-version-history.ts
use-workspace-shortcuts.ts
use-zen-workspace.ts
version-history-pills.tsx
zen-first-visit-hint.tsx
zen-mode-toolbar.tsx
zen-tool-rail.tsx
```

**5 files used ONLY by `refine-studio-client.tsx`** (the legacy refine
shell, also being deleted):

```
BrushToolRail.tsx
buffered-directives-textarea.tsx
generated-variation-grid.tsx
inspector-collapsed-rail.tsx
split-comparison-canvas.tsx
```

(also `workbench-dock.tsx` — used by `refine-studio-client` AND
`rooms-studio-client` (out of scope). After `refine-studio-client`
deletion, `rooms-studio-client` is the only consumer → **KEEP**.)

**4 files used ONLY by `project-detail-view.tsx` for the room-card
preview** (NOT the legacy editor) — **KEEP** (out of scope):

```
batch-room-upload.tsx       room-canvas.tsx
generate-copy-form.tsx      staged-result-image.tsx
variant-thumbnail-strip.tsx
```

These 4 are used in the per-room card preview (the focused room's
small thumbnail + the no-beforeImage upload state). They survive.

### `src/lib/` — 3 files to delete (revised count)

After the 52 canvas/ deletions, these 3 lib files have ZERO consumers
and are dead code:

- `inspector-panel.ts` — used by deleted canvas/ tree + test.
- `operation-mode-availability.ts` — used by deleted `inpaint-operation-mode-tabs` + test.
- `tool-rail.ts` — used by deleted `BrushToolRail` + test.

**Note**: `focus-mode.ts` was initially on the delete list but a
typecheck pass showed it's still imported by `project-detail-view.tsx`
for its `resolveFocusedRoom` + `resolveRoomLayoutMode` exports (pure
logic, used by the keep set's room layout). It stays. The legacy
"focus mode" UI is `canvas/focus-restore-pill.tsx` (in the canvas/
delete set), which is what the audit was actually targeting.

And 3 test files for the deleted lib files:
- `tests/inspector-panel.test.ts`
- `tests/operation-mode-availability.test.ts`
- `tests/tool-rail.test.ts`

(Confirmed by grep: `precision-slider.ts`, `workbench-layout.ts`,
`multi-select-batch.ts`, `instance-overlays.ts` are still used by
`rooms-studio-client.tsx` (out of scope) or the keep set, so they
survive. `use-inpaint-status.ts` is a co-located hook for
`use-inpaint-runs.ts`, which is the only edit-room → canvas/ survivor.)

### `src/components/canvas/version-history-panel.tsx` — split before delete

`use-inpaint-runs.ts` (the keep hook) imports
`generateThumbnailFromUrl` from `./version-history-panel`. The function
is a ~30-line pure browser helper. Before deleting the panel, extract
the helper to `src/lib/inpaint-thumbnail.ts` and re-point the import.

### `src/app/(dashboard)/projects/[id]/refine/` — 1 file to delete

- `refine-studio-client.tsx` (the legacy refine shell).

### `src/lib/edit-room-flag.ts` — delete

The kill-switch file. The `NEXT_PUBLIC_EDIT_ROOM_REDESIGN` env var is
retired in Commit 3; the file is deleted in Commit 2.

## Out-of-scope consumers (do NOT touch)

- `src/app/(dashboard)/projects/[id]/rooms/rooms-studio-client.tsx` —
  the `/rooms` per-room staging studio. NOT in the redesign scope
  (no `EditRoomStudio` references; the issue bodies for #1343 / #1344
  / #1345 / #1346 do not mention it). It still mounts the legacy
  `<InpaintEditor>`. Leave it alone — touching it would scope-creep
  the PR.
- `src/app/(dashboard)/projects/[id]/setup/setup-studio-client.tsx` —
  the project-intake workflow stepper. Same story: not in scope, no
  `EditRoomStudio` references.
- `src/components/lookbook/room-spread.tsx` — depends on
  `canvas/comparison-slider` + `canvas/comparison-pill`. Those are
  the 2 keep files.
- `src/lib/api-quota.ts`, `src/lib/preview-token.ts`, anything API-route
  or server-action adjacent — out of scope.
- `src/lib/staged-result.ts` — used by `lookbook/`. Keep.

## Commit 1 caveat (default-ON, env-brake)

The plan keeps `NEXT_PUBLIC_EDIT_ROOM_REDESIGN` live as an env-brake
during the delete PR. The new behavior: the env var is read ONLY by
`src/lib/edit-room-flag.ts`; setting it to `false` re-enables the
delete-blocked code path. After Commit 3 the env var is dropped
entirely from `tests/e2e/env.ts`, and the `edit-room-flag.ts` module
itself is deleted.
