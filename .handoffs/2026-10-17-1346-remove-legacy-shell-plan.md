# Issue #1346 plan — remove the legacy `InpaintEditor` + `Zen/Focus` + `OperationMode` shell

## Goal

Once `#1345` merged (`EditRoomStudio` is the only mounted editor under the
`NEXT_PUBLIC_EDIT_ROOM_REDESIGN` flag), delete the entire legacy editor stack
and drop the kill-switch flag. Production behavior stays identical because
`develop` only ships with the flag ON in the e2e specs (per the prior session
summary); in this commit we leave the default OFF so local dev still works the
same as before the redesign until the release-merge retires the flag defaults
entirely (or a follow-up flips default ON — see "After merge" below).

## Scope (from issue #1346 body)

- All **26 component files** in `src/components/canvas/` that belong to the
  legacy editor stack are deleted (Zen/Focus/OperationMode/inpaint-editor).
- All **14 co-located hooks** (`use-zen-workspace`, `use-*-zen`, etc.) are
  deleted.
- All **8 lib files** in `src/lib/` that exist only for the legacy shell are
  deleted (or inlined; nothing in the new surface consumes them).
- The 2 remaining `src/app/.../project-detail-view.tsx` branches that mount
  legacy code (the `!isEditRoomRedesignEnabled` else-branch at line ~1651 and
  the variant-touch-up pill at ~1515) collapse to always render the new
  `EditRoomStudio` mount.
- The `src/lib/edit-room-flag.ts` module is removed; the `project-detail-view`
  no longer reads it; the `NEXT_PUBLIC_EDIT_ROOM_REDESIGN` env var is dropped
  from `.env.example`.
- 11 e2e specs that the prior session retargeted onto the new surface
  (`edit-room-redesign-*.spec.ts` × 4, plus `mask-paint`, `editor-layout`,
  `rehearsal`, `studio-workflow`, `upload`, `version-history`, `preview`) keep
  working without the flag.
- `tests/edit-room-studio-mount.test.tsx` and
  `tests/edit-room-lookbook-badge.test.tsx` lose the kill-switch branches.

## Out of scope

- The 8 new shared hooks the new surface still imports
  (`use-inpaint-runs`, `use-mask-buffer`, `use-mask-painting`, …) — kept.
- `src/lib/api-quota.ts`, `src/lib/preview-token.ts`, anything API-route or
  server-action adjacent.
- `BatchStagingPanel`, `BrushToolRail`, `MaskCanvasStage`, `MaskCanvasToolbar`
  if they are still consumed by the new surface. **Audit required before
  deletion** — see Commit 1 audit step.
- Anything outside `src/components/canvas/`, `src/lib/`, `src/app/(dashboard)/projects/[id]/`,
  `src/components/edit-room/`, and the affected test files.

## Commit plan (three commits, matches the wave-2/3/4 pattern)

### Commit 1 — `refactor(#1346): flip default ON, collapse legacy branches to always-mount <EditRoomStudio>`

- Audit every consumer of legacy `src/components/canvas/*.tsx` and
  `use-*-zen*.ts` (the co-located hooks) to find the smallest set the new
  surface still needs. Anything in the audit's "delete" list keeps the new
  surface compiling.
- In `src/lib/edit-room-flag.ts`, change `isEditRoomRedesignEnabled()` to
  return `true` always, but keep the env read live (so a `NEXT_PUBLIC_EDIT_ROOM_REDESIGN=false`
  still opts out — gives us a single env-driven brake while we delete the
  legacy code). Document the brake in a code comment referencing #1346.
- In `project-detail-view.tsx`:
  - Drop the `!isEditRoomRedesignEnabled && focusedEditingSlot !== null`
    branch that renders `<InpaintEditor … />` and replace it with a single
    `isEditRoomRedesignEnabled && focusedEditingSlot !== null ? <EditRoomStudioMount … /> : null`.
  - Drop the parallel "variant-touch-up" pill branch (the
    `!isEditRoomRedesignEnabled` short-circuit around it) and let the pill
    only render in the new path.
  - Drop the now-unused `InpaintEditor` import.
- In `src/app/(dashboard)/projects/[id]/refine/page.tsx` and
  `edit-room-studio-mount.tsx`: same simplification — the
  `isEditRoomRedesignEnabled ? <EditRoomStudioMount … /> : <RefineStudioClient … />`
  collapses to a single `<EditRoomStudioMount … />`.
- Update `tests/edit-room-studio-mount.test.tsx` and
  `tests/edit-room-lookbook-badge.test.tsx` to drop the "renders legacy when
  flag is off" branches.
- Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`.
  The e2e suite is **not** re-run yet — the legacy file still exists for
  reference and to keep the e2e specs that use `openFocusedEditor()` working
  one more commit. (They were retargeted by prior sessions, but
  `mask-paint.spec.ts` line 246 still has a legacy `openFocusedEditor()` call
  shape that needs to be verified next commit.)

### Commit 2 — `refactor(#1346): delete legacy inpaint-editor / mask-canvas / zen / focus / operation-mode shell`

- Delete the 26 legacy components (full list in the audit below).
- Delete the 14 legacy co-located hooks.
- Delete the 8 legacy lib files:
  - `src/lib/focus-mode.ts` (the lib — the component lives in
    `canvas/focus-mode.tsx`; the new surface does not consume either).
  - `src/lib/inspector-panel.ts` (legacy inspector width math).
  - `src/lib/operation-mode-availability.ts`.
  - `src/lib/canvas-coords.ts`, `src/lib/tool-rail.ts`,
    `src/lib/workbench-layout.ts`, `src/lib/precision-slider.ts`,
    `src/lib/multi-select-batch.ts` — verify no
    `src/components/edit-room/*.tsx` consumes these before deletion.
  - `src/lib/zen-*.ts` (none expected — the new surface has no Zen path).
- Delete `src/lib/edit-room-flag.ts` (the env read is gone, so the file is
  dead).
- Drop `NEXT_PUBLIC_EDIT_ROOM_REDESIGN` from `.env.example` (the only file
  that mentions it; the e2e harness's `nextEnv()` in `tests/e2e/env.ts` sets
  it to `"1"` explicitly, which the e2e specs still need, so it is added
  BACK into `nextEnv()` as a hard-coded literal — the env stays in the e2e
  harness but is no longer read by the app).
- Update any remaining `tests/*.test.ts` that imports the deleted lib files.
- Run lint + typecheck + vitest + `next build` to confirm the production
  bundle still builds. Run `npm run e2e` end-to-end. The expected outcome
  is green because the e2e specs were retargeted to the new surface in
  `#1343`/`#1344`/`#1345`.

### Commit 3 — `chore(#1346): retire NEXT_PUBLIC_EDIT_ROOM_REDESIGN env var (e2e harness, docs, AGENTS.md)`

- Drop the env var from `tests/e2e/env.ts#nextEnv()`.
- Drop the env var mention from `AGENTS.md` (the only place the `mp-redesign`
  flag appears is in `#1344`'s description there).
- Update `docs/DEPLOYMENT.md` if it lists the var (audit first; probably
  doesn't — was added in #1343).
- Update `docs/post-demo-backlog.md` and `docs/DESIGN_SYSTEM.md` if they
  mention the flag.

## After merge

- The next wave closes the parent epic #1336.
- Production can be flipped to default-ON by removing the `isEditRoomRedesignEnabled`
  function call from `project-detail-view.tsx` and `refine/page.tsx` (a
  one-line follow-up). That's not part of this PR because the issue body
  explicitly says "leave the env brake in place until a follow-up confirms
  production wants the new IA as default."

## Acceptance criteria

- [ ] No source file in `src/` imports a deleted legacy module (CI lint passes).
- [ ] `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` all green.
- [ ] `npm run e2e` green.
- [ ] `NEXT_PUBLIC_EDIT_ROOM_REDESIGN` not read by any `src/` or
      `middleware.ts` code (only by `tests/e2e/env.ts` if at all).
- [ ] Commit 1 keeps the env-brake for one commit; Commit 3 retires it.
- [ ] The audit file at `.handoffs/2026-10-17-1346-legacy-canvas-audit.md`
      lists the 26 / 14 / 8 files with the "keep" set (the new surface's
      remaining consumers) called out.

## Risk register

- **Hidden consumer of a legacy module**: the new `edit-room` components
  import some `use-*` hooks and `lib/*.ts` files that the wave-2/3/4 PRs
  added but the issue body lumps into the "delete" set. The Commit 1 audit
  resolves this. If the audit finds a `use-*-mask-undo` or similar that the
  new surface still uses, it gets moved to Commit 1's "keep" set and the
  issue's "26 / 14 / 8" counts shrink — that's fine, the counts in the
  issue body are descriptive, not contractual.
- **E2E specs still relying on the legacy DOM**: `mask-paint.spec.ts` and
  `editor-layout.spec.ts` were retargeted but the diff is small enough that
  any miss shows up in Commit 2's e2e run.
- **tsconfig flip on `npm run build`**: the wave-4 PR also flipped it. The
  pre-commit hook (`scripts/check-tsconfig-flip.sh`) blocks the commit, and
  `git checkout HEAD -- tsconfig.json` restores it. Already a known drill.
