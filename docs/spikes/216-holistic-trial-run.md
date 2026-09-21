# Trial Run Log — Issue #216

## Context

Parent spike: [`docs/spikes/190-holistic-mask.md`](190-holistic-mask.md) (issue #190).

This document records the operator's empirical verdict from the 4–8 approved fal.ai runs
executed before the Sep 24 develop freeze.

---

## Current default

**Constant:** `DEFAULT_HOLISTIC_MASK_STRATEGY_ID` in `src/lib/holistic-mask.ts:229`

```ts
export const DEFAULT_HOLISTIC_MASK_STRATEGY_ID: HolisticMaskStrategy_ID = "wall-band";
```

Current winner (pre-registered): **`wall-band`** — hard-anchors ceiling line (14%) and floor
plane (16%), recommended with `a2 architecture-first` prompt.

The spike panel's `useState` initial value in `holistic-spike-panel.tsx:72` also references
this constant, so flipping the constant flips both the registered default and the panel's
initial radio selection.

---

## What would change the default

The decision rule from #190: **"architecture fidelity outranks magic"** — the after-image
must read as the same room. Window mullions, ceiling line, floor plane, baseboards, and
trim must survive. A strategy wins if it produces a believable restaged room with clean
TV removal.

| If verdict prefers … | Change required |
|---|---|
| `feathered-frame` (rim lock) | Flip `DEFAULT_HOLISTIC_MASK_STRATEGY_ID` to `"feathered-frame"` |
| `full-frame` (max magic) | Flip `DEFAULT_HOLISTIC_MASK_STRATEGY_ID` to `"full-frame"` |
| `wall-band` (already the default) | No change needed |
| Prompt variant `a1 thematic` wins | Change `useState("architecture-first")` initial value in `holistic-spike-panel.tsx:72` to `"thematic"` (pinned by #191) |
| All candidates fail | Record no-go on #190; #191 descopes to big-brush + touch-ups only |

---

## Operator run protocol

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

### Run matrix

| # | Mask strategy | Prompt variant | Status |
|---|---|---|---|
| 1 | `wall-band` (default) | `a2 architecture-first` | ☐ |
| 2 | `wall-band` | `a1 thematic` | ☐ |
| 3 | `feathered-frame` | `a2 architecture-first` | ☐ |
| 4 | `full-frame` | `a2 architecture-first` | ☐ |
| 5 (opt) | `full-frame` | `a1 thematic` | ☐ |
| 6 (opt) | TV item-4 iteration | `a2` + brush dilation 25px | ☐ |

---

## Verdict recording

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

---

## Constant to flip

If a strategy other than `wall-band` wins: **one constant** in `src/lib/holistic-mask.ts:229`.

```ts
// change this line:
export const DEFAULT_HOLISTIC_MASK_STRATEGY_ID: HolisticMaskStrategyId = "wall-band";
// to e.g.:
export const DEFAULT_HOLISTIC_MASK_STRATEGY_ID: HolisticMaskStrategyId = "feathered-frame";
```

This constant is pinned by `tests/holistic-mask.test.ts:203` (`expect(DEFAULT_HOLISTIC_MASK_STRATEGY_ID).toBe("wall-band")`),
which must also be updated to pass.

If the prompt variant (`a1` vs `a2`) is the change, update the `useState` initial value
in `src/components/canvas/holistic-spike-panel.tsx:72` (replaced by #191 anyway).

---

## No-go path

If every full-room candidate fails the architecture-fidelity check: record **no-go** on
issue #190 and descope #191 to big-brush + touch-ups only. The existing brush flow
requires no code change.

---

*Operator: fill in the verdict table above, post to #190, then close this issue.*
