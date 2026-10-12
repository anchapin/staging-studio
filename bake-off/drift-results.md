# Drift test (issue #1240 follow-up)

Run: 2026-10-12.
Script: `scripts/bake-off-drift-test.mts` (3 identical runs per slot,
fixed seed=42, prompt from `bake-off/vacant-insert.json`).

Diff is mean RGB delta in the **mask-complement region** — i.e. every pixel
outside the centered rectangle. Lower = more stable.

| Slot | Mean delta | Max delta | Latency | Cost | Verdict |
|---|---|---|---|---|---|
| flux-pro-fill | ~2.8 | 221 | ~20s | $0.05/MP | essentially no drift (JPEG noise floor) |
| seedream-5-flash | ~43 | 255 | ~20s | $0.027/image | heavy drift |
| seedream-5-pro | ~52 | 255 | ~130s | $0.0675/image | even more drift than Flash |

## Finding

The Picsart comparison article
(https://picsart.com/blog/seedream-5-0-models-comparison/) claims Pro and
Flash both "let you point at the edit" and "the rest of the frame stays as
it was." On fal's queue endpoints (`bytedance/seedream/v5/{pro,flash}/edit`),
this is **not true** — neither accepts a mask_url field, and Pro drifts
~20% MORE than Flash despite being the higher-quality tier and ~7× slower
per call. The "region-precise editing" appears to depend on sketch
annotations or layer decomposition features that the fal queue endpoint does
not surface.

## Implication

Neither Seedream variant is a clean mask-fill incumbent replacement on the
fal wire. The drift is real and visible. A user-facing "compare both" mode
would compare a stable FLUX edit against a Seedream output that re-painted
the whole room — not a meaningful comparison.

## Recommendation

Do NOT switch the inpaint incumbent to either Seedream variant. The mask-fill
alternatives from the original bake-off (`flux-kontext-lora-inpaint` and
`z-image-turbo-inpaint`) are the candidates worth a drift test — both accept
real masks and are architecturally designed for the regional-edit behavior
we need.