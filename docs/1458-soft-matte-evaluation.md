# Evaluation: soft-matte refinement stage between segmentation and inpainting (issue #1458)

Desk + offline-probe evaluation. No matting model was run, no paid API was called, and no model weights were downloaded; quality claims about matting output are unverified until the validation step at the end is done. Everything about *this codebase and its provider contract* below was measured or read in-tree. The offline probe is `scripts/soft-matte-alpha-probe.mts` (9/9 probes pass, no network, no keys).

## Verdict

**No-go for the inpaint path as proposed.** A soft-matte stage cannot improve the current Qwen-Image inpaint for translucent furnishings, because the provider boundary is binary: DashScope masks are black/white, so any alpha a matting stage produced would be collapsed to 0/1 before the model ever saw it. The translucency loss the issue describes is real — the probe quantifies it — but it happens at a boundary a pre-provider stage cannot fix. Revisit only if the inpaint provider changes to one that accepts soft alpha, or for a future local-compositing feature (the #1459 hybrid case).

## Facts

| Item | Finding | Source |
| --- | --- | --- |
| Inpaint provider today | Alibaba Cloud DashScope, `ALIBABA_INPAINT_MODEL` default `qwen-image-2.1-pro` (~$0.04/image) | `src/lib/alibaba-adapter.ts:111`, `src/lib/api-quota.ts:39` |
| Provider mask contract | "DashScope masks are binary B/W"; feathering happens client-side via the FineTune `expand` slider (`src/lib/mask-feather.ts`), not via a provider alpha parameter | `src/lib/alibaba-adapter.ts:169-172` |
| Segmentation today | fal.ai SAM 3.1 (`fal-ai/sam-3-1/image`), one text prompt returns one mask per detected object | `src/lib/furnishing-detection.ts:12,32` |
| Binary-mask translucency loss (measured) | A uniform 40%-opaque object occupying 1600 px is classified as **0 painted px** by the repo's binary mask convention (alpha ≥ 128 threshold): the object is left in the photo entirely. Raising the threshold instead paints it fully. A binary mask cannot express "replace this at 40%". | probe P4 (`scripts/soft-matte-alpha-probe.mts`) |
| Coverage vs alpha mass (measured) | On a linear alpha ramp tile, `estimateMaskCoverage()` reports 50.0% "masked" while the alpha-weighted mass is also 50.0% only by coincidence of the ramp; on the uniform 40% tile it reports 0.0% against a true 40.0% alpha mass | probe P2 |
| Non-neural alpha plumbing cost (measured) | 3-pass separable box blur over the alpha channel: ~455 ms CPU at 1024×768, ~344 ms at 2048×1536 (single run, no warm-up). This is a floor for any soft-alpha stage's plumbing, before model inference | probe P3 |
| BiRefNet license / runtime | MIT; PyTorch or ONNX/transformers.js builds (`onnx-community/BiRefNet-ONNX`, MIT) | `docs/birefnet-cutout-assessment.md` (#1459) |
| CorridorKey license | Listed as "Other" on GitHub — borrow the architecture idea only; do not reuse its code or weights without a license review | issue #1458 |
| BiRefNet task fit | Dichotomous / salient-object segmentation (one foreground vs background), not per-object masks in a cluttered room | `docs/birefnet-cutout-assessment.md` (#1459) |

## Analysis

1. **The bottleneck is the provider contract, not the mask source.** SAM's binary output is only the first binarisation. Even a perfect soft matte (CorridorKey-style straight colour + linear alpha) would be re-binarised at the DashScope boundary, because the adapter documents the mask as binary B/W with no alpha parameter. The fake-looking edges on sheer curtains, plants and glassware are therefore not fixable by inserting a stage *before* this provider.
2. **The loss is real and quantified.** Probe P4 shows the failure is not cosmetic edge roughness: below the alpha threshold a translucent object is *entirely preserved* (never restaged), and above it, it is *entirely replaced* (translucency destroyed). No threshold choice avoids one of the two failures.
3. **Cost is not the blocker; physics of the pipeline is.** The non-neural plumbing for a soft stage is cheap (~0.3–0.5 s CPU per image, probe P3) and fal-hosted or local BiRefNet inference would be a modest addition next to the ~$0.04 inpaint. Spending that money buys alpha that the next hop discards.
4. **Where soft alpha *would* pay off.** (a) If the inpaint provider is ever swapped for one accepting soft/alpha masks, this evaluation's insertion point is the mask path in `src/lib/alibaba-adapter.ts` (payload construction) fed by `src/lib/furnishing-detection.ts` masks — the stage would sit between those two. (b) For local compositing features (product cutouts, swatch library), see the #1459 hybrid recommendation; BiRefNet's MIT ONNX build is the candidate there.

## Recommendation

- Close #1458 as **no-go for the current inpaint path**, for the provider-contract reason above — not because matting quality is unproven.
- Do not build the stage now. Keep `scripts/soft-matte-alpha-probe.mts` as the regression evidence: if a future provider claims alpha-mask support, re-run the probe's P2/P4 checks against its payload builder first.
- Re-open this question only alongside an inpaint-provider evaluation, with alpha-mask support as a hard requirement in that evaluation.

## Optional validation if the provider changes

Run `onnx-community/BiRefNet-ONNX` locally on room photos containing curtains, plants and glassware; composite the soft alpha against the candidate provider's documented mask format; record side-by-sides and the measured end-to-end latency/cost in this file. Expect the decision to hinge on the provider's mask contract, not on matte quality alone.
