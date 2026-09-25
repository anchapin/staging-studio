# Spike 190 — holistic full-room mask strategy + TV-frame prompt adherence

Issue: [#190](https://github.com/anchapin/staging-studio/issues/190) — gates W4 (#191).
Decision rule: **architecture fidelity outranks magic** — walls / windows / floor /
ceiling line must survive; the after-image must read as the same room.
Empirical runs: **operator-executed** (4–8 real fal.ai runs, spend approved) on
`porters-mill-living-wide-13.jpg`, **before the Sep 24 develop freeze**. This spike
ships the strategy layer + infrastructure only; **no polished UI** — #191 owns the
one-click preset.

## What shipped (strategy layer)

All pure logic, pinned 1:1 by vitest per repo convention:

| File | Contents |
| --- | --- |
| `src/lib/holistic-mask.ts` | 3 candidate full-room mask strategies (RGBA buffers, natural-dims, DPR-independent), registry + pre-registered default. |
| `src/lib/holistic-prompt.ts` | Aesthetic-derived directive template (a1 thematic / a2 architecture-first incl. explicit TV-removal wording), holistic negative prompt, route-parity prompt composer. |
| `src/lib/prompts.ts` | Additive only: `FRAMING_CONTEXT` exported (reused by the holistic prompt); optional `negativePrompt` override on `buildFalFillPayload` (default unchanged). |
| `src/lib/ai-route-schemas.ts` | `inpaintRequestSchema` gains optional `negativePrompt` (1–2000 chars, default behavior unchanged). |
| `src/app/api/inpaint/route.ts` | Forwards the optional `negativePrompt` into the fal payload. One line. |
| `src/components/canvas/holistic-spike-panel.tsx` | Minimal spike panel (browser-only mask→PNG serialization). |
| `src/components/canvas/inpaint-editor.tsx` | Shared `beginInpaintRun` submit path + the spike panel rendered inside a collapsed `<details>` **below the main action row — not in the toolbar**. |

Tests: `tests/holistic-mask.test.ts`, `tests/holistic-prompt.test.ts` (schema
compatibility with `inpaintRequestSchema` included).

## Candidate mask strategies

| id | Mask | Prompt pairing | Risk profile |
| --- | --- | --- | --- |
| `full-frame` | 100% white — regenerate everything | a1 (`thematic`) or a2 (`architecture-first`) | Max restaging freedom; max architecture-drift risk. |
| `feathered-frame` | White interior, 6%-of-shorter-side grayscale ramp at the outer rim | a2 recommended | Rim lock protects window/TV/wall edges **at the photo boundary** (the TV-frame concern); interior walls still regenerate. |
| `wall-band` | Full-width band between preserved ceiling (14%) and floor (16%) strips; optional edge feather | a2 recommended | Hard-anchors the ceiling line + floor plane — strongest architecture-fidelity guarantee. |

The strategy and prompt variant are orthogonal knobs; the run matrix below crosses them.

## Prompt template

`buildHolisticPrompt(aesthetic, variant)` = `buildInpaintPrompt(aesthetic, directives)`
— i.e. the route composes `{aesthetic} style. {directives} {FRAMING_CONTEXT}`,
exactly as for brush runs (#182 framing language included). The directives:

- **a1 thematic**: "Replace all furniture and decor with {aesthetic} alternatives: …
  Keep the layout believable and the furniture scaled to the room's architecture."
- **a2 architecture-first**: a1 **plus** architecture-preservation language
  ("…must remain faithful to the original photo — the result must read as the same
  room, only restaged") **plus** the explicit TV-removal wording: "Remove any
  television completely, including its bezel, stand, wall mount, and cords, and
  leave the wall behind it clean."

**Holistic negative prompt** (`HOLISTIC_NEGATIVE_PROMPT`): the single-object
`NEGATIVE_PROMPT` suppresses "walls, windows, …, flooring" so generated objects
don't smear into architecture — under a full-room mask those regions ARE the regen
target, so those terms fight the generation. The holistic negative keeps only the
artifact terms (bezel / monitor frame / TV border / screen casing / electronics /
wires / cables / black plastic trim / raw canvas texture) and adds
geometry-drift terms (warped architecture, crooked window frames / ceiling line /
floor line).

## Coverage-validation verification (no change needed)

`mask-coverage.ts` only *warns* when a non-empty mask covers < 0.5% of the canvas
(`shouldWarnLowCoverage`); the inpaint route performs **no** coverage validation at
all. ~100% masks already pass end-to-end, so the holistic path required **zero**
changes to mask validation and **zero** weakening of single-object brush validation.
Pinned by `tests/holistic-mask.test.ts` ("interplay with mask-coverage validation").

## End-to-end path (no new plumbing beyond one schema field)

spike panel → `strategy.build(naturalWidth, naturalHeight)` → RGBA buffer →
`canvas.toDataURL("image/png")` → `POST /api/inpaint` `{maskUrl, promptDirectives:
buildHolisticDirectives(...), negativePrompt: HOLISTIC_NEGATIVE_PROMPT, aesthetic,
roomId, variantSlot, sourceSlot}` → existing fal queue submit → existing status
polling → result persists into the variant slot (`staged-result` / `inpaint-source`
semantics untouched). **Progressive touch-ups stack**: after the holistic run lands,
set "Edit from" to that variant and brush — a variant-source run overwrites the same
slot in place.

## Operator run protocol (4–8 real fal runs)

Prep: dev env with real `FAL_KEY`; run `npm run dev`; sign in; open the
porters-mill project → Living Room → the **before photo is
`porters-mill-living-wide-13.jpg`** → **Edit staging** → expand
**"Holistic staging spike (#190) — internal testing only"** (bottom of the editor).

1. Confirm the directive textarea may be empty for holistic runs (the template
   supplies the directives) and **Edit from = Original photo**.
2. Run the matrix below, one run per row. Between runs, wait for the result to
   land (variant slot), then **Download / save both before & after at full res**
   for the side-by-side sheet (acceptance criterion 1).
3. Variant-slot tip: keep landing results in the *empty* slot so each run's
   before image is the original photo; if the slot selection rotates, temporarily
   download-and-clear between runs.

| # | Mask strategy | Prompt variant | Notes |
| --- | --- | --- | --- |
| 1 | `wall-band` (default) | a2 architecture-first | Pre-registered winner combo. |
| 2 | `wall-band` | a1 thematic | Isolates the wording knob. |
| 3 | `feathered-frame` | a2 architecture-first | TV-frame adherence candidate. |
| 4 | `full-frame` | a2 architecture-first | Max-magic control. |
| 5 (opt) | `full-frame` | a1 thematic | Issue's raw a1. |
| 6 (opt) | TV item-4 iteration | a2 + edited directives | If the TV survives run 1–4: repeat the best combo after typing extra explicit-removal wording into the directives box is NOT needed — instead bump **Mask Expansion** to 25px on a brush mask over the TV (issue #180 dilation knob = the "mask dilation amount" lever), or accept the demo workaround (known-good directives + pre-generated variant). |

Record after each run, per row:
- **"Same room?" verdict** (yes / drifted / no — check window mullions, trim, ceiling line, floor plane, baseboards).
- **TV verdict**: TV removed cleanly? bezel/stand/cord residue? wall behind clean?
- Save the after URL + the slot it landed in.

Post the verdict table as a comment on issue #190 (**go/no-go decision**), attach
the side-by-side sheet, then apply section below.

## Swapping the confirmed winner (one place)

`DEFAULT_HOLISTIC_MASK_STRATEGY_ID` in `src/lib/holistic-mask.ts` (single constant,
pinned by `tests/holistic-mask.test.ts`). If the verdict prefers a different
**prompt variant** default, flip the `useState("architecture-first")` initial value
in `holistic-spike-panel.tsx` — #191 replaces that panel with the real preset
anyway. If the verdict rejects *every* full-room candidate, record no-go on #190;
#191 is then descoped to big-brush + touch-ups only (the (b) control path is the
existing brush flow, no code).

## Out of scope here

One-click preset UX (#191), editor toolbar changes, SAM tool, variant strip UI,
demo docs, real fal.ai execution from this task (operator-run only).
