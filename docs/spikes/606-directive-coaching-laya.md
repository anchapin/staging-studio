# Spike 606 — Real-time directive coaching in the staging editor (Laya)

Issue: [#606](https://github.com/anchapin/staging-studio/issues/606)

## Status

**GATE NOT YET OPEN** — depends on the Dana-triage fine-tuning inference endpoint (see §Gate criteria).

This spike documents current state and the proposed design. No production implementation is warranted until the gate criteria are satisfied.

---

## NOT IMPLEMENTED

Issue #606 is **NOT IMPLEMENTED**. It will not be implemented until the gate criteria are satisfied.

---

## Gate criteria (must both be true before implementation)

| Gate | Issue | Criterion | Current state |
|------|-------|-----------|---------------|
| 1 | #606 | Dana-triage fine-tuning endpoint is deployed and accepting inference requests | **NOT MET** — no fine-tuning endpoint exists; `TYPESAFE_API_KEY` is used only by `docs/dana-rig/triage.js` (offline CLI tool, not a hosted endpoint) |
| 2 | #606 | Laya directive-coaching model meets go criteria: Spearman ≥ 0.7 vs Alex's ratings on specificity; architecture-risk precision ≥ 0.85 at recall ≥ 0.7 on held-out test set | **NOT MET** — zero-shot model is ~random for this task |

Both checkboxes above are **unchecked** in the issue body. The gate is closed.

---

## Background

PR #603 (commit `eb06820`, issue #600) added an inpaint pre-flight quality gate that runs GPT-4o-mini **at submit time**, before `fal.queue.submit`. The gate evaluates:

- `specificity` (0–3): how concrete vs generic the directives are
- `architecture_risk` (noul): populated when directives describe changing walls/flooring/windows/trim/doors/ceiling that the furnishings mask does not cover
- `mentions_furnishings` (noul): positive signal that the mask aligns with stated intent

These warnings ride along with the submission and render as dismissible inline hints in the response UI — advisory only, never blocking.

**The cost problem:** At per-call API pricing, running GPT-4o-mini on every keystroke is prohibitive. PR #603 deliberately limited the check to submit time as a cost compromise.

**The Laya opportunity:** Laya runs at ~33 ms local inference with zero marginal cost. With Laya, the same judgment can run on every keystroke-idle — not as a blocker, but as live coaching the moment it's actionable: before the user commits.

---

## What #606 proposes

Real-time directive coaching in the staging editor: as the user types inpaint directives, on keystroke-idle (debounced ~500 ms) evaluate the directive and surface:

1. **`specificity` (score 0–3)** — rendered as a live meter under the textarea
2. **`architecture_risk` (noul)** — rendered as a dismissible inline hint
3. **`mask_mismatch` (noul)** — rendered as a dismissible inline hint

The rendering contract is identical to the submit-time check: advisory only, never blocking.

---

## Current submit-time check architecture

### Schema

Defined in `src/lib/ai-route-schemas.ts` (`inpaintQualityGateSchema`, lines 277–282):

```typescript
export const inpaintQualityGateSchema = z.object({
  specificity: z.number().int().min(0).max(3),
  architecture_risk: z.string().optional(),  // populated only when risk exists
  mentions_furnishings: z.string().optional(), // populated only when positive
  qualityWarnings: z.array(z.string()),
});
```

### API route

`src/app/api/inpaint/route.ts` (lines 163–198):

```typescript
// Issue #600: inpaint pre-flight quality gate
const qualityWarnings: string[] = [];
if (parsed.data.maskCoverageRatio !== undefined) {
  assertOpenAIConfigured();
  const { object: qg } = await generateObject({
    model: aiModel,           // gpt-4o-mini
    schema: inpaintQualityGateSchema,
    messages: [{ role: "user", content: [...] }],
  });
  if (qg.architecture_risk) qualityWarnings.push(qg.architecture_risk);
  if (qg.qualityWarnings) qualityWarnings.push(...qg.qualityWarnings);
}
// qualityWarnings ride along in the NextResponse.json response
```

The quality gate only runs when `maskCoverageRatio !== undefined` — i.e., after the user has painted a mask.

### Client-side rendering

After submission, the response is:
```json
{ "requestId": "...", "qualityWarnings": ["architecture_risk: ...", "..."] }
```

The UI shows these as dismissible hints (per `qualityWarnings` in the inpaint response). No live meter is shown during editing.

---

## Proposed real-time coaching architecture

### High-level data flow

```
User types → debounce (500 ms idle)
  → POST /api/coaching { directive, maskCoverageRatio }
  → Laya model (local / fine-tuned)
  → { specificity: 0–3, architecture_risk?: string, mask_mismatch?: string }
  → render: specificity meter + optional dismissible warnings
```

### 1. New API route: `POST /api/coaching`

Path: `src/app/api/coaching/route.ts`

Request schema:
```typescript
{
  directive: string;          // current directive text (trimmed, may be empty)
  maskCoverageRatio?: number; // 0–1, from canvas; only set after mask is painted
  roomName?: string;          // for prompt context
}
```

Response schema (Laya output, mirrors `inpaintQualityGateSchema`):
```typescript
{
  specificity: number;        // 0–3
  architecture_risk?: string; // noul unless risk exists
  mask_mismatch?: string;    // noul unless mismatch exists
}
```

**Note on `mask_mismatch`:** The current submit-time gate does NOT have a `mask_mismatch` field. The issue description introduces it as a separate signal from `architecture_risk`. Both describe cases where the directive describes something the mask doesn't cover. Implementation should decide whether to split these or merge — see §Open questions.

**Behavior when `directive` is empty:** Return `{ specificity: 0 }` with no warnings.

**Behavior when `maskCoverageRatio` is undefined:** Laya still evaluates `specificity` (which depends only on directive text) but cannot evaluate `architecture_risk` or `mask_mismatch` (which depend on mask coverage). Return `{ specificity: <n> }` without the risk fields.

### 2. Client-side debounced evaluation

In `inpaint-editor.tsx` (around line 1917), the `onChange` handler already calls `onDirectivesChange?.(e.target.value)`. The parent (`project-detail-view.tsx`) receives this via `editDirectives`.

Two options for where to add the coaching call:

**Option A — in `project-detail-view.tsx`** (simpler, co-locates with existing directive autosave):
- Add a `useEffect` that watches `focusedInputs.roomDirectives` and debounces a coaching call
- Co-locates with the existing autosave controller pattern
- Risk: adds a side-effect to the page-level component

**Option B — in `inpaint-editor.tsx`** (more isolated):
- Add a local `useState` for coaching result and a debounced `useEffect` inside the editor
- Cleaner separation but duplicates the coaching logic if multiple editors exist

**Recommendation: Option A.** The directive autosave pattern already lives in `project-detail-view.tsx` and the coaching call is semantically similar to autosave (a reaction to directive changes). Use the same debounce infrastructure.

```typescript
// In project-detail-view.tsx (sketch)
const [coachingResult, setCoachingResult] = useState<CoachingResult | null>(null);

useEffect(() => {
  const timer = setTimeout(async () => {
    if (!focusedInputs.roomDirectives.trim()) {
      setCoachingResult({ specificity: 0 });
      return;
    }
    const res = await fetch("/api/coaching", {
      method: "POST",
      body: JSON.stringify({
        directive: focusedInputs.roomDirectives,
        maskCoverageRatio: focusedRoom.maskCoverageRatio, // pass from editor if available
        roomName: focusedRoom.name,
      }),
    });
    if (res.ok) setCoachingResult(await res.json());
  }, 500);
  return () => clearTimeout(timer);
}, [focusedInputs.roomDirectives]);
```

### 3. UI rendering

Under the staging directives textarea in `inpaint-editor.tsx` (after line 1921), render:

```tsx
{coachingResult && (
  <DirectiveCoachingMeter
    specificity={coachingResult.specificity}
    architecture_risk={coachingResult.architecture_risk}
    mask_mismatch={coachingResult.mask_mismatch}
  />
)}
```

`DirectiveCoachingMeter` is a new component (proposed path: `src/components/canvas/directive-coaching-meter.tsx`):

- **Specificity meter:** A 4-segment horizontal bar (0–3), filled segments highlighted. No numeric label needed; color: 0-1 amber, 2 green, 3 bright green. Updates on every keystroke-idle result.
- **Warnings:** `architecture_risk` and `mask_mismatch` render as dismissible inline hints (amber background, X dismiss button). Dismissing sets a per-session flag that hides the warning for that `directive` value until the user modifies it.
- **Empty state:** When directive is empty, show nothing (meter hidden, no warnings).

### 4. Go criteria for Laya fine-tuning

The issue specifies the training corpus and acceptance criteria:

**Training corpus:**
- ~200 synthetic directive examples (generated, not human-labeled)
- ~40 hand-checked directives (Alex reviews and rates each)

**Acceptance criteria:**
- `specificity`: Spearman rank correlation ≥ 0.7 vs Alex's manual ratings on a held-out set
- `architecture_risk`: precision ≥ 0.85 at recall ≥ 0.7 on a held-out set

These mirror the data-gated structure of Spike 240. The fine-tuning work and corpus gathering is a separate concern from this spike — tracked under the Dana-triage fine-tuning issue.

---

## Open questions

1. **`mask_mismatch` vs `architecture_risk` split:** The current submit-time gate has one combined concept (`architecture_risk`). The issue describes them as separate signals. Should `mask_mismatch` be a new field in the Laya model output, or is it the same as `architecture_risk` evaluated against a different part of the mask coverage data?

2. **Mask coverage data availability:** The coaching call needs `maskCoverageRatio` to evaluate `architecture_risk` and `mask_mismatch`. This value lives in the mask canvas state. How does the parent (`project-detail-view.tsx`) access it to pass it to the coaching call? The current `InpaintEditorProps` exposes no `maskCoverageRatio` prop.

3. **Per-room coaching state:** Should the coaching result be stored in React state (per-session, lost on refresh) or persisted via the room autosave mechanism? Given it is purely advisory and real-time, per-session React state seems appropriate — no persistence needed.

4. **Relationship to submit-time gate:** Once real-time coaching is deployed, does the submit-time gate still fire? If the coaching is accurate enough, the submit-time gate becomes redundant. Should it be replaced or downgraded to a fallback audit?

5. **Coaching endpoint auth:** The `/api/coaching` route should probably be unauthenticated (like `/api/debug-preview-check`) since it only evaluates directive text with no access to user data. Is this acceptable, or does it need auth?

---

## Files to be created when gate opens

When the gate criteria are satisfied, the following files need to be created:

| File | Purpose |
|------|---------|
| `src/app/api/coaching/route.ts` | New API route — receives directive + maskCoverageRatio, calls Laya, returns coaching result |
| `src/components/canvas/directive-coaching-meter.tsx` | New UI component — specificity meter + dismissible warnings |
| `src/lib/ai-route-schemas.ts` | Add `coachingRequestSchema` and `coachingResponseSchema` |
| `src/app/(dashboard)/projects/[id]/project-detail-view.tsx` | Add coaching state, debounce effect, pass coaching result to `InpaintEditor` |
| `src/components/canvas/inpaint-editor.tsx` | Add `coachingResult` prop, render `<DirectiveCoachingMeter>` below textarea |

---

## Relationship to Dana-triage fine-tuning endpoint

This feature **piggybacks** on the Dana-triage fine-tuning endpoint. The issue explicitly states:

> Do not stand up hosting for this alone — it only ships if the Dana-triage fine-tuning issue earns the inference endpoint first.

This means:
- The Laya model must be deployed as part of the Dana-triage infrastructure
- The `/api/coaching` route calls that same endpoint (or a variant of it)
- If the Dana-triage endpoint is never deployed, this feature is not deployed

This dependency is tracked via Gate 1 above.
