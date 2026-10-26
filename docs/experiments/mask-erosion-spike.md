# Mask erosion / feather spike (issue #1457)

Status: helper landed. Image comparison NOT run, and not runnable as designed (see next section).

## Finding: the provider currently ignores the mask

On the Alibaba path, `src/lib/alibaba-adapter.ts` sends only `[{ image }, { text }]` plus `strength`/`seed`/`size` to DashScope. `maskUrl` is never read (`src/lib/inpaint-submit.ts` notes "Alibaba ignores `maskUrl` because its endpoint is instruction-mode only"). So dilating, eroding or feathering the mask cannot change the model output today, and the A/B below would compare identical requests. The protocol is kept for reference.

Erosion/feathering only matters if a post-composite step is added: keep original pixels outside the mask and paste generated pixels inside it with an eroded/feathered alpha edge. That is the proposed follow-up; one generated image per room is enough to compare edge settings, so it needs almost no provider spend.


## Question

CorridorKey 2.0 (https://youtu.be/svrdRAoIlxM, https://github.com/nikopueringer/CorridorKey) reports that a model fills in detail on an *eroded* hint mask but cannot subtract detail from an over-expanded one. Does the same hold for our inpaint path (DashScope Qwen-Image, `ALIBABA_INPAINT_MODEL`, default `qwen-image-2.1-pro`)?

## What the pipeline does today

- `src/lib/mask-dilation.ts` grows masks outward by `DEFAULT_MASK_EXPANSION_RADIUS` (15 px, UI up to 25) so the model regenerates the bezel/frame rim instead of leaving a "ghost rim" (issue #180).
- `src/lib/mask-feather.ts` blurs the mask in the browser before upload (the "Blend edges" slider). DashScope takes a B/W mask with no blur parameter.
- `erodeRegion` in `src/lib/mask-postprocess.ts` (new, not called by the app) shrinks a mask grid so the sweep can use the same grids as the app.

The 15 px dilation was added on purpose, so erosion may make rims worse. The experiment decides this.

## Protocol

Inputs: the three before/mask pairs in `bake-off/befores/` (vacant-insert, occupied-replace, repeat-stability). Add hard cases (plant, sheer curtain, glassware) if photos are available.

Arms per image (same prompt, same seed, same `strength`):

| Arm | Mask |
| --- | --- |
| A (baseline) | current app default: dilate 15 px, no feather |
| B | no dilation, erode 3 px |
| C | no dilation, erode 6 px |
| D | dilate 15 px, then feather 4 px |

Judge each result for: ghost rim around the replaced object, halo/fringe color, and damage to untouched pixels near the edge. Score blind (shuffle arm labels), 1 to 5 per criterion, record in a table here.

Budget: about 12 images x 3 arms, roughly $0.04 per DashScope image, about $1.50 total. Stop if spend would exceed that.

## Success criteria

- Record a default radius and order of operations (dilate, erode, feather) for `/api/segment` outputs and brush masks, or record that erosion does not help and close the issue with the data.

## Results

_Not run yet._
