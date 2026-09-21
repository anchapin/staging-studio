# Spike 216 — Holistic Mask Strategy Trial Run

Issue: [#216](https://github.com/anchapin/staging-studio/issues/216) — run #190 spike trials and confirm or swap the winning mask strategy.

## Context

Parent spike: [`docs/spikes/190-holistic-mask.md`](190-holistic-mask.md) (issue #190).

## Current Default

`DEFAULT_HOLISTIC_MASK_STRATEGY_ID` at `src/lib/holistic-mask.ts:229`:
```ts
export const DEFAULT_HOLISTIC_MASK_STRATEGY_ID: HolisticMaskStrategyId = "wall-band";
```

Current winner (pre-registered): **`wall-band`** — hard-anchors ceiling line (14%) and floor
plane (16%), recommended with `a2 architecture-first` prompt.

The spike panel's `useState` initial value in `holistic-spike-panel.tsx:72` also references
this constant, so flipping the constant flips both the registered default and the panel's
initial radio selection.

## Decision Rule

**Architecture fidelity outranks magic** — walls/windows/floor/ceiling line must survive; the after-image must read as the same room.

If `wall-band` + a2 wins: no change needed.
If `feathered-frame` wins: flip `DEFAULT_HOLISTIC_MASK_STRATEGY_ID` to `"feathered-frame"`.
If `full-frame` wins: evaluate if architecture drift is acceptable; document and decide.

## Operator Run Protocol

> Requires: dev env with real `FAL_KEY`, `npm run dev`, authenticated session,
> `porters-mill` project → Living Room → before photo `porters-mill-living-wide-13.jpg`.

1. Open **Edit staging** → expand **"Holistic staging spike (#190) — internal testing only"**
   (bottom of the editor, inside `<details>` below the main action row).
2. Confirm **Edit from = Original photo** and leave the directive textarea empty (the
   template supplies directives).
3. Run the matrix below, one run per row. After each result lands, **Download / save
   both before & after at full res** for the side-by-side sheet.
4. Record verdict per row (see Verdict section below).
5. Variant-slot tip: land each run's result in the *empty* slot so the before image
   stays the original photo.

### Mandatory runs (rows 1–4)

| Run | Strategy | Prompt variant | Goal |
|-----|----------|---------------|------|
| 1 | `wall-band` | a1 thematic | Baseline — does wall-band + thematic work? |
| 2 | `wall-band` | a2 architecture-first | Architecture-preserving version |
| 3 | `feathered-frame` | a2 architecture-first | Rim-lock vs wall-band |
| 4 | `full-frame` | a2 architecture-first | Max restaging freedom — acceptable? |

### Optional runs (rows 5–6)

| Run | Strategy | Prompt variant | Goal |
|-----|----------|---------------|------|
| 5 | `feathered-frame` | a1 thematic | Does rim-lock + thematic work? |
| 6 | `full-frame` | a1 thematic | Full freedom + thematic |

## Verdict Recording

Per run, record:

- **"Same room?"** — `yes` / `drifted` / `no` (check: window mullions, trim, ceiling
  line, floor plane, baseboards).
- **TV verdict** — removed cleanly? bezel/stand/cord residue? wall behind clean?
- **After URL** + **slot it landed in**.

Post the completed verdict table as a comment on **issue #190** (go/no-go decision) and
attach the side-by-side sheet.

### Visual comparison checklist

- [ ] Window mullions / glass / frame unchanged
- [ ] Ceiling line straight and continuous
- [ ] Floor plane consistent with before
- [ ] Baseboards present and aligned
- [ ] TV fully absent (no bezel, no stand, no mount, no cords)
- [ ] Wall behind TV clean (no smearing or ghost artifacts)
- [ ] Overall room reads as the same space, only restaged

## If Winner ≠ wall-band: Flip the Constant

```ts
// src/lib/holistic-mask.ts:229
export const DEFAULT_HOLISTIC_MASK_STRATEGY_ID: HolisticMaskStrategyId = "<winner>";
```

Also update the pinned test at `tests/holistic-mask.test.ts:203` if it hardcodes `"wall-band"`.

If the prompt variant (`a1` vs `a2`) is the change, update the `useState` initial value
in `src/components/canvas/holistic-spike-panel.tsx:72`.

## No-Go Path

If every full-room candidate fails the architecture-fidelity check: record **no-go** on
issue #190 and descope #191 to big-brush + touch-ups only. The existing brush flow
requires no code change.

*Operator: fill in the verdict table above, post to #190, then close this issue.*
