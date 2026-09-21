# Spike 240 — DATA-GATED: fine-tuned staging-taxonomy classifier (browser-side ONNX)

Issue: [#240](https://github.com/anchapin/staging-studio/issues/240)

## Status

**GATE NOT YET OPEN** — both prerequisites (#238, #237) are closed, but gate criteria remain unsatisfied.

This spike documents current state. No implementation work is warranted until the gate criteria are satisfied.

---

## NOT IMPLEMENTED

Issue #240 is **NOT IMPLEMENTED** and will not be implemented until both gate criteria are satisfied:

1. [ ] #238 corpus has enough labeled selections (define N after first export review)
2. [ ] #237 CLIP zero-shot measurably insufficient on real firm photos (documented mislabel rate)

Both checkboxes above are **unchecked** in the issue body. The gate is closed.

---

## Gate criteria (must both be true before implementation)

| Gate | Issue | Criterion | Current state |
|------|-------|-----------|---------------|
| 1 | #238 | SelectionLog corpus has enough labeled selections | **NOT MET** — `SelectionLog` model absent from `prisma/schema.prisma` |
| 2 | #237 | CLIP zero-shot measurably insufficient on real firm photos | **NOT MET** — #237 spike exists (`src/lib/clip-zero-shot.ts`) but no firm-photo measurement has been done |

---

## What #240 proposes

Long-term goal: replace browser-side zero-shot CLIP labeling (issue #237 spike, `src/lib/clip-zero-shot.ts`) with a **classifier fine-tuned on this firm's actual selection history**.

Motivation: CLIP zero-shot is a general-purpose model. A classifier fine-tuned on Circle G Designs' specific pick/reject decisions would presumably be more accurate for this firm's aesthetic (e.g., which sofa styles, which rug colors the stager selects).

Technical direction: browser-side ONNX runtime, fine-tuned on the firm's `SelectionLog` corpus.

---

## Current state of prerequisite #238 (SelectionLog)

**Not started.** `SelectionLog` model does not exist in `prisma/schema.prisma`.

Evidence:
- `prisma/schema.prisma` has no `SelectionLog` model (grep confirmed, 0 matches)
- `src/lib/concept-chips.ts` contains `buildSelectionLoggedEvent` (line 123) — a pure function that builds a `SelectionLoggedEvent` object — but **nothing calls it**, so no selection data is currently being logged anywhere
- No API route or server action writes selection events to persistent storage

The `buildSelectionLoggedEvent` shape (from `concept-chips.ts:105`):

```typescript
export interface SelectionLoggedEvent {
  event: "selection_logged";
  roomId: string;
  concept: string;           // active detection concept at toggle time
  instanceIndex: number;    // position in score-ranked response
  score: number | null;     // provider score, or null
  editedLabel?: string;     // present once batch-panel labels exist
}
```

This event currently only goes to `console.log` (if anything emits it at all). For #238, this event needs to be:
1. Captured in a `SelectionLog` Prisma model
2. Written via a new API route or server action
3. Accumulated across real firm projects to form the fine-tuning corpus

Gate criterion for #238: corpus has **enough labeled selections** — threshold not yet defined (likely needs discussion with firm operator to determine minimum viable corpus size).

---

## Current state of prerequisite #237 (CLIP assessment)

**Spike complete, assessment not done.** Issue #237 spike is implemented:

- `src/lib/clip-zero-shot.ts` (418 lines) — spike result, proved transformers.js CLIP runs in-browser via WebGPU/WASM
- `tests/clip-zero-shot.test.ts` (283 lines) — unit tests, all passing
- Spike demonstrates: ~80–200ms/inference (WebGPU), ~300–800ms (WASM), Q4 quantization working

However, the acceptance criterion is: **"CLIP zero-shot measurably insufficient on real firm photos"**. This has NOT been demonstrated. The spike was tested on developer hardware with synthetic furniture crops, not on Circle G Designs' actual photos, and no measurement on firm hardware has been reported.

Evidence from `docs/spikes/278-clip-latency.md`:
> The #237 spike (commit `caa496f`) proved transformers.js CLIP runs in-browser

But there is **no documented measurement** showing CLIP performance is insufficient on the firm's real photos. Issue #278 (commit `8b4f01a`, `feat/issue-278-clip-latency-measurement`) is the measurement protocol — but the operator run has not been completed.

Gate criterion for #237: need **empirical evidence** that CLIP zero-shot produces wrong or low-confidence labels on Circle G's specific furniture photos, making a fine-tuned classifier worthwhile.

---

## Relevant code paths

| File | Role |
|------|------|
| `src/lib/concept-chips.ts` | Taxonomy (`CONCEPT_CHIPS`, `buildSelectionLoggedEvent`) — basis for both current labeling and future fine-tuning label set |
| `src/lib/clip-zero-shot.ts` | Issue #237 spike: browser-side zero-shot CLIP via transformers.js |
| `src/lib/prompt-prefill.ts` | Uses CLIP/labeled concept to pre-fill inpaint prompts |
| `prisma/schema.prisma` | No `SelectionLog` model — needs to be added in #238 |

---

## What this spike would need once gates open

1. **SelectionLog persistence** — write `SelectionLoggedEvent` to a `SelectionLog` Prisma model (roomId, concept, instanceIndex, score, editedLabel, timestamp)
2. **Corpus accumulation** — run the firm through real projects, accumulate thousands of labeled examples
3. **Fine-tune pipeline** — fine-tune a small vision model (e.g., ResNet, EfficientNet, or ONNX-exported CLIP variant) on the SelectionLog corpus
4. **Browser-side ONNX inference** — export fine-tuned model to ONNX, serve via IndexedDB/cached asset, run via ONNX Runtime Web in the browser (similar to how `clip-zero-shot.ts` uses transformers.js)
5. **A/B or replace** — either augment CLIP suggestions with the fine-tuned model, or replace CLIP entirely if quality is substantially better

---

## Spike conclusion (updated after #237 and #238 close)

**Gate remains closed.** Issues #237 and #238 are closed, but the gate criteria (the checkboxes in #240's issue body) are unchecked:

- #238 closed 2026-09-20 — however, the SelectionLog acceptance criteria (unchecked: `[ ]` db:push clean, `[ ]` every toggle writes a row, `[ ]` corpus export script committed) are not reflected as checked. No corpus N has been defined.
- #237 closed 2026-09-19 — however, CLIP zero-shot insufficiency on firm photos has not been empirically demonstrated. The acceptance criteria (unchecked: `[ ]` <3s on firm machines, `[ ]` WebGPU path verified, `[ ]` edits persist, `[ ]` zero new server deps) do not include a documented mislabel rate.

**Gate criterion 1** (#238 corpus N): NOT MET — no documented threshold, no export run
**Gate criterion 2** (#237 mislabel rate): NOT MET — no documented measurement on Circle G photos

Recommend:
1. Complete #238 first (SelectionLog persistence across real firm projects)
2. Complete #237's firm-hardware measurement (issue #278 operator run, or direct assessment)
3. Only then open #240 gate and begin fine-tuned classifier spike
