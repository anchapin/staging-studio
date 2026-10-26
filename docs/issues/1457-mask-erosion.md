# Issue #1457 — mask erosion (code slice)

**Scope of this note:** the code half of staging-studio issue #1457 — erode /
feather SAM masks before Qwen-Image inpaint to reduce edge halos. The live
A/B inpaint experiment described in the issue is **not** part of this change
(it needs paid Alibaba/Qwen API calls) and remains the follow-up.

## Why

SAM-derived segment masks tend to be *over-expanded*: the segmentation
includes a halo of background pixels around the object. Qwen-Image inpaint
regenerates exactly the painted region, so that halo is regenerated too and
shows up as a bright/soft rim around the object ("edge halo"). The mask
pipeline already grows masks outward for the opposite reason (issue #180:
`src/lib/mask-dilation.ts`), which makes the halo worse for segment output.

## What was added

- `src/lib/mask-erosion.ts` — pure grid erosion, the inverse of dilation:
  - `erodeMaskGrid(grid, width, height, radius)` — circular (Euclidean)
    kernel, the same disc `dilateMaskGrid` stamps, so `erode(dilate(x))`
    recovers `x` for interior shapes. Binary `Uint8Array` grid, 1 = painted,
    indexed `y * width + x`. Never mutates the input; returns a new grid and
    its `paintedCount`; returns `null` for malformed geometry.
  - `DEFAULT_SEGMENT_MASK_EROSION_RADIUS = 4` — the documented default
    preprocessing step for segment-output masks. The issue names 2–6 px as
    the sweep range; 4 px sits in the middle of it (see the sweep bounds
    `MIN_SEGMENT_MASK_EROSION_RADIUS = 0` /
    `MAX_SEGMENT_MASK_EROSION_RADIUS = 6`).
  - `erodeSegmentMask(...)` — the named default preprocessing step, i.e.
    erosion with the default radius (0 disables it).
- `src/lib/mask-postprocess.ts` — now reuses the shared `erodeMaskGrid`
  instead of keeping a private copy (no behaviour change; `closeRegion` is
  unchanged).
- `tests/mask-erosion.test.ts` — pins the erosion semantics: painted
  regions shrink, radius 0 is an identity, thin features vanish, malformed
  geometry returns `null`, the input grid is never mutated, and
  `erode(dilate(x)) === x` for an interior shape.

## Not in this change

- No API route / provider call changes.
- `mask-dilation.ts` and `mask-feather.ts` behaviour is untouched (feather
  already exists as a browser canvas utility and was not duplicated).
- **The live A/B inpaint experiment was not run** — it requires paid
  Alibaba/Qwen API calls and stays a follow-up. The default radius of 4 px
  is the sweep midpoint the issue names, chosen to be a safe starting point
  until the A/B lands.
