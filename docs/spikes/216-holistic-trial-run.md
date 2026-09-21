# Spike 216 — Holistic Mask Strategy Trial Run

Issue: [#216](https://github.com/anchapin/staging-studio/issues/216) — run #190 spike trials and confirm or swap the winning mask strategy.

## Current Default

`DEFAULT_HOLISTIC_MASK_STRATEGY_ID` at `src/lib/holistic-mask.ts:229`:
```ts
export const DEFAULT_HOLISTIC_MASK_STRATEGY_ID: HolisticMaskStrategyId = "wall-band";
```

## Trial Protocol

Run on `porters-mill-living-wide-13.jpg` (4–8 fal.ai runs, approved spend).

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

## Decision Rule

**Architecture fidelity outranks magic** — walls/windows/floor/ceiling line must survive; the after-image must read as the same room.

If `wall-band` + a2 wins: no change needed.
If `feathered-frame` wins: flip `DEFAULT_HOLISTIC_MASK_STRATEGY_ID` to `"feathered-frame"`.
If `full-frame` wins: evaluate if architecture drift is acceptable; document and decide.

## Verdict Recording

1. Save side-by-side comparison images
2. Evaluate: room identity preserved? TV removed? Ceiling/floor lines intact?
3. Record verdict on issue #216 or #190 with:
   - Winning strategy id
   - Prompt variant
   - Evidence images
   - One-sentence rationale

## If Winner ≠ wall-band: Flip the Constant

```ts
// src/lib/holistic-mask.ts:229
export const DEFAULT_HOLISTIC_MASK_STRATEGY_ID: HolisticMaskStrategyId = "<winner>";
```

Also update the pinned test at `tests/holistic-mask.test.ts:203` if it hardcodes `"wall-band"`.

## No-Go Path

If trials cannot complete before the Sep 24 develop freeze: document the blocker on #216 and defer to post-demo.
