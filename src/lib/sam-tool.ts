/**
 * Feature flag: SAM click-to-select ("Select Object") mask tool.
 *
 * Issue #189 (demo wave 2): the SAM click-to-select UX is opaque — no
 * processing feedback and a slow first impression — so the tool is hidden
 * from the editor UI for the demo. The demo path is brush-only (plus the
 * Fill Region flood-fill).
 *
 * ALL SAM implementation is retained behind this flag, nothing is deleted:
 * the canvas select path and keyboard selection branch
 * (`inpaint-mask-canvas.tsx`), the parent's /api/segment wiring
 * (`inpaint-editor.tsx`), the `POST /api/segment` route, the
 * `src/lib/segment-mask.ts` helpers, and the select-object e2e specs
 * (skipped while the flag is off).
 *
 * Post-demo revival = flip to `true` (tracked as issue #202; multi-select
 * on SAM is issue #203) — a real design pass should land with it.
 */
export const SAM_TOOL_ENABLED = false;
