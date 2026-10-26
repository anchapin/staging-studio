# Evaluation: a soft-matte refinement stage between segmentation and inpainting (issue #1458)

**Issue:** [#1458](https://github.com/anchapin/staging-studio/issues/1458) — evaluate a soft-matte refinement stage between segmentation and inpainting for translucent furnishings (curtains, plants, glass), ending in a go/no-go recommendation.
**Date:** 2026-10-26
**Status:** Research-only — **no production inpaint/segmentation behaviour changed** by this issue. The only code artefact is an offline probe harness (`scripts/soft-matte-alpha-probe.mts`, §7); it imports repo modules, calls no API and downloads no weights.
**Labels:** `inpainting`, `research`
**Sibling docs:** [`docs/birefnet-cutout-assessment.md`](birefnet-cutout-assessment.md) — the #1459 assessment merged in PR #1464 (the BiRefNet licence/cost facts reused in §6 are taken from that doc); [`docs/1446-abacus-dcr-sam-qk-edit-evaluation.md`](1446-abacus-dcr-sam-qk-edit-evaluation.md) — the #1446 evaluation (same house style); [`docs/issues/1457-mask-erosion.md`](issues/1457-mask-erosion.md) — the mask-grid conventions reused in §3.

**Placement rationale (repo convention):** the evaluation family (#1444, #1445, #1446) lives at the root of `docs/` as `<topic>-evaluation.md`; issue-numbered evaluations prefix the number (`1446-abacus-…`). This file follows that convention.

---

## 0. TL;DR — verdict: **CONDITIONAL GO** (design spike yes, integration no)

- **The stage as described cannot change a single production pixel today, for two reasons that are both in this tree, not in the issue text.** (1) **The mask never reaches the inpaint provider.** `buildInpaintPayloadForActiveProvider()` returns exactly `{ image_url, prompt }` (`src/lib/prompts.ts:448`, `:539`) and the DashScope request body carries no mask field (`src/lib/alibaba-adapter.ts`, `dashscopeGenerate`). (2) **The repo's mask representation is binary.** Every decoder thresholds alpha at 128 (`src/lib/mask-flood-fill.ts:43,55`; `src/lib/mask-coverage.ts:26,34`), so a soft matte is collapsed to 0/1 before it is used. A soft-matte stage inserted between segmentation and inpainting is therefore a **no-op** until both are fixed.
- **The issue's premise about the current pipeline is partly stale.** The brief describes "fal.ai SAM segmentation → Alibaba DashScope Qwen-Image inpainting". The inpaint half is right (`ALIBABA_INPAINT_MODEL=qwen-image-2.1-pro`, `.env.example:41`; `src/lib/alibaba-adapter.ts:106-121`). The segmentation half is **not**: the fal/Replicate adapters were retired in #1240 (`src/lib/inference.ts:286-300` throws for `INFERENCE_PROVIDER=fal|replicate`), the Alibaba adapter only wires `FLUX_FILL` (`src/lib/alibaba-adapter.ts:106-121` — `SAM_3_1_IMAGE` hits the exhaustiveness `throw`), and **no client calls `/api/segment/furnishings` at all** — the editor renders hard-coded placeholder detections (`src/components/edit-room/EditRoomStudio.tsx:718-734`). This matches the #1446 evaluation's finding (b)/(d) and is re-verified here with today's line numbers (§3.2).
- **Quality argument for the stage is real but narrow.** For a sheer curtain, a 40%-opaque plant, or a glass panel, the current binary mask can only say *replace everything* or *replace nothing* — measured in §7 (probe P2d/P4: a uniformly 40%-opaque tile reads as **0.0 % "masked"** while its alpha-weighted mass is **40 %**). The existing free capability — `featherMask()` (`src/lib/mask-feather.ts:67`), the FineTune "Blend edges" slider — softens the *edge of a binary region*; it does not model per-pixel opacity. A matte stage is only worth its cost if it beats that free edge blur on the three categories below.
- **Cost/latency:** the inpaint itself is ~$0.04/image (`src/app/api/inpaint/route.ts:324` comment) and takes ~30 s synchronously on DashScope (`src/app/api/inpaint/route.ts:30-34`, #1262). A hosted matting call adds a network round trip plus queue on top of that; a local BiRefNet run on 6–8 GB VRAM class hardware adds GPU time and a GPU host that this repo does not have today (no GPU service is wired; Vercel serverless cannot host it). The **cost ceiling that makes sense today is $0**: a hosted matting call priced like SAM (~$0.005, `docs/birefnet-cutout-assessment.md:16`) is acceptable; a per-call price above ~$0.01 doubles the *segmentation* line for a marginal gain on three categories.
- **Licence:** **CorridorKey is excluded.** The issue states its licence is "Other" (not verified from this sandbox — no network); we take the architecture idea from the issue text only and adopt **no CorridorKey code and no CorridorKey weights**. **BiRefNet is MIT** (`docs/birefnet-cutout-assessment.md:13-14`, upstream `LICENSE` + the `onnx-community/BiRefNet-ONNX` build) — MIT permits reuse of the code **and** the weights, with the notice retained, so it is the only matting candidate this evaluation considers adoptable (§6).
- **Conditions (all five must hold before an integration PR):** C1 mask reaches the provider · C2 alpha survives end-to-end · C3 offline quality evidence on committed photos with an MIT/Apache-2.0 model · C4 added cost ≤ $0.01/run and added latency ≤ 25 % of the inpaint call · C5 scope limited to concept-scoped instances (`curtains`, `plant`) behind a flag.

---

## 1. Scope, method, evidence rules

**Issue.** #1458 asks for an evaluation of a soft-matte refinement stage placed between segmentation and inpainting, targeting translucent furnishings, ending in a go/no-go. This document is the deliverable.

**Evidence rules applied.**

1. Every claim about *this repo* cites a `file:line` that exists in this worktree (base commit `e945c38`).
2. Claims about *external* projects (BiRefNet, CorridorKey, fal.ai prices) are labelled by their source: the issue text, the sibling #1459 doc, or the upstream page the sibling doc cites. Anything not verifiable inside this sandbox is marked **not re-verified here** rather than asserted.
3. Repo evidence outranks the issue text.
4. Licence facts are quoted from the sibling evaluation (which cites the upstream `LICENSE` files), not from memory.

**Limits of this pass — what was NOT run, and why.**

| Not run | Why | Consequence |
| --- | --- | --- |
| Any fal.ai call (SAM, or a hosted matting endpoint) | Paid API; forbidden by the brief and by the repo's spend discipline (`src/lib/fal-spend-guard.ts`) | No live provider latency, no live price, no live mask bytes |
| Any DashScope / Qwen-Image call | Paid API; forbidden by the brief | No before/after inpaint images, no output-quality delta |
| Any matting model (BiRefNet, CorridorKey, anything) | Sandbox has neither `torch` nor `onnxruntime` (`python3 -c "import torch"` → `ModuleNotFoundError`; same for `onnxruntime`), no GPU, and the brief forbids downloading large weights | **No empirical quality or model-latency number exists in this document.** Every quality statement is an architectural argument plus a measured property of the repo's own mask code |
| `npm test` / `npm run typecheck` / `npm run lint` | `node_modules/` in this worktree is empty (no packages installed), so vitest/tsc/oxlint are not runnable here | The probe harness was validated by executing it with Node 24 directly (§7) |

**What WAS run:** `node scripts/soft-matte-alpha-probe.mts` — 9 offline probes against the repo's own modules, output quoted in §7.

---

## 2. The problem the stage would solve

A translucent object (sheer curtain, plant foliage, glass panel) has **no binary region**. Three failure modes exist in the current flow:

1. *Object survives.* A 40 %-opaque object thresholds below the repo's `MASK_PIXEL_THRESHOLD = 128` and is classified "preserve" — it stays in the photo after the inpaint (measured, §7 P2d/P4).
2. *Object is fully replaced.* The user paints the object to be sure it is covered; the binary mask replaces the whole silhouette, so the curtain's translucency (and the light it casts on the floor) is destroyed with it.
3. *Halo / hard edge.* A binary silhouette replaced by a generative model leaves a hard cut-out edge; the current mitigation is a geometric edge blur (`featherMask`), which softens the boundary but keeps the interior binary.

The stage's premise is that a per-pixel alpha ("matte") would let the model replace *partially transparent* content *partially*, preserving the light-transmission character of a curtain and the see-through character of glass.

---

## 3. The current pipeline, traced (this tree, `e945c38`)

### 3.1 What actually runs today

```
browser  user paints with the brush
  └─ src/components/edit-room/MaskLayer.tsx:136   onChange(dataUrl)   (freehand PNG, per stroke)
      └─ src/app/(dashboard)/projects/[id]/project-detail-view.tsx:1630
             featherMask(maskDataUrl, expandPx)      ← src/lib/mask-feather.ts:67  (geometric edge blur, client-side)
      └─ src/components/canvas/use-inpaint-runs.ts:322  POST /api/inpaint  { imageUrl, maskUrl, … }
          └─ src/app/api/inpaint/route.ts:301  maskUrl → submitInpaintToActiveProvider(...)
              └─ src/lib/inpaint-submit.ts:375  submitInpaintToActiveProvider()
                  ├─ buildInpaintPrompt(aesthetic, promptDirectives)         src/lib/prompts.ts
                  ├─ buildInpaintPayloadForActiveProvider(logicalInput)      src/lib/prompts.ts:539
                  │     └─ provider = "alibaba" → buildAlibabaFillPayload()   src/lib/prompts.ts:448
                  │           ⇒ returns { image_url, prompt }  ← THE MASK IS DROPPED HERE
                  └─ client.submit(LOGICAL_MODEL.FLUX_FILL, { input })      src/lib/alibaba-adapter.ts
                        └─ resolveAlibabaModel()  →  ALIBABA_INPAINT_MODEL || "qwen-image-2.1-pro"
                                                        src/lib/alibaba-adapter.ts:106-121
                        └─ dashscopeGenerate(): body = { model, input.messages[{image,text}],
                                        parameters:{ n:1, watermark:false, prompt_extend:true,
                                                     strength, seed?, size:"2048*1536" } }
                                                        src/lib/alibaba-adapter.ts:200-224
```

`ALIBABA_INPAINT_MODEL` is read in exactly two places: `src/lib/alibaba-adapter.ts:78` (`requireAlibabaEnv`) and `:111` (`resolveAlibabaModel`), with the default `qwen-image-2.1-pro` (also the value in `.env.example:41`).

### 3.2 What does *not* run today (contradiction with the issue's premise)

| Claim in the brief | This tree | Evidence |
| --- | --- | --- |
| "fal.ai SAM segmentation" is the current segmentation stage | The fal/Replicate adapters are **retired**: `assertInferenceConfigured()` throws for `INFERENCE_PROVIDER=fal\|replicate`, and `getInferenceClient()` throws the same | `src/lib/inference.ts:286-300`, `:315-327` |
| — | The Alibaba adapter only maps `LOGICAL_MODEL.FLUX_FILL`; `SAM_3_1_IMAGE` falls into the exhaustiveness `throw` ("unknown logical model") | `src/lib/alibaba-adapter.ts:106-121`; `src/lib/inference.ts:50` (`SAM_3_1_IMAGE: "sam-3-1-image"`) |
| — | **No client calls `/api/segment/furnishings`.** The concept chip submit only sets local state, and the editor renders two hard-coded placeholder detections | `src/components/edit-room/EditRoomStudio.tsx:718-734` |
| — | The segment route still exists and is quota-guarded, but its provider dispatch would throw | `src/app/api/segment/furnishings/route.ts:72,143`; `src/lib/segment-furnishings-service.ts:118-120,248,261`; `src/lib/furnishing-detection.ts:32,106` (`fal-ai/sam-3-1/image`) |

**Consequence for this issue:** a "soft-matte stage between segmentation and inpainting" cannot be inserted *after* a working segmentation stage, because in this tree segmentation is not on the live path. The only live segmentation-adjacent artefacts are the **concept taxonomy** (client) and the **placeholder detections** (hard-coded). This is a contradiction between the issue's framing and the code, and it is the reason the verdict is conditional rather than a plain go.

### 3.3 The mask representation (why "soft" dies before the provider)

Every consumer of mask pixels in this repo is **binary**:

| Site | Behaviour |
| --- | --- |
| `src/lib/mask-flood-fill.ts:43` | `CUTOUT_ALPHA_THRESHOLD = 128` |
| `src/lib/mask-flood-fill.ts:55` `maskGridFromAlphaPixels()` | alpha ≥ 128 ⇒ 1, else 0 |
| `src/lib/mask-flood-fill.ts:27` `maskGridFromPixels()` | `isMaskedPixel()`: alpha ≥ 128 **and** luminance ≥ 128 ⇒ 1, else 0 |
| `src/lib/mask-coverage.ts:26,34` | `MASK_PIXEL_THRESHOLD = 128`, same rule |
| `src/lib/mask-coverage.ts:45` `estimateMaskCoverage()` | counts binary-masked pixels / total |
| `src/lib/multi-select-batch.ts:547` `unionMaskBuffers()` | OR-union of binary grids |
| `src/lib/mask-dilation.ts:74`, `src/lib/mask-erosion.ts:97` | binary grid dilate/erode (the #1457 default is a 4 px erosion) |
| `src/lib/mask-feather.ts:67` `featherMask()` | **the one soft operation in the repo** — a CSS `blur(Npx)` pass over the *binary* mask PNG, browser-side, radius ≤ 40 px |

So a matte (an alpha channel) would be destroyed by the very first decoder it meets, unless a parallel alpha-carrying representation is introduced.

---

## 4. Where a soft-alpha stage would plug in

Three seams exist, in increasing order of intrusiveness. Named precisely:

**S1 — client-side mask emission (recommended seam; lowest risk, no server change).**
`MaskLayer.onChange` (`src/components/edit-room/MaskLayer.tsx:136`) → `featherMask(maskDataUrl, expandPx)` (`src/app/(dashboard)/projects/[id]/project-detail-view.tsx:1630`, implementation `src/lib/mask-feather.ts:67`) → `maskUrl` body field (`src/app/api/inpaint/route.ts:301`).
A matting stage would sit exactly where the blur sits: take the painted region + the source photo, produce an **alpha-masked PNG** (RGB = the photo, A = per-pixel opacity) instead of a blurred binary mask. This seam already owns "how soft is the edge", it is already client-side (no new server cost), and it is already gated by a user-facing slider (`FineTune`'s "Blend edges").
*Blocker:* the mask PNG is consumed as a white-on-black binary buffer by `isMaskedPixel()`/`estimateMaskCoverage()` and by the provider; an alpha PNG would need a parallel representation (C2).

**S2 — server-side per-instance refinement (the literal "between segmentation and inpainting" seam).**
`runFurnishingDetection()` (`src/lib/segment-furnishings-service.ts:248`) → mask fetch → `parseFurnishingDetectionResponse()` (`src/lib/furnishing-detection.ts:148`) → `FurnishingDetectionResult.masks` (RGBA data URLs) → client `SegmentCache` (`src/lib/segment-cache.ts:84` `buildSegmentCacheKey`).
A matting stage would refine each instance's alpha **before** the mask is cached, i.e. per (image, concept) — cacheable, so it is paid once per detection, not once per inpaint.
*Blockers:* (a) this route is not on the live path (§3.2); (b) the decoders that consume those RGBA masks (`src/lib/mask-format.ts` `maskGridFromProviderPixels`, `paintMaskPixels`) re-binarise them.

**S3 — the union seam (batch runs).**
`unionMaskBuffers()` (`src/lib/multi-select-batch.ts:547`) OR-unions instance masks for the thematic/per-object batch plans (`buildBatchPlan`, `:645`). A soft alpha must be unioned with *max* (or "over"), not OR, or the merge semantics of #252 break.

**S4 — the provider seam (the actual blocker for all three).**
`buildAlibabaFillPayload()` (`src/lib/prompts.ts:448`) returns `{ image_url, prompt }`; `dashscopeGenerate()` (`src/lib/alibaba-adapter.ts:200-224`) posts `input.messages = [{ content: [{ image }, { text }] }]`. There is **no mask slot**. Until a mask-capable provider (or a DashScope endpoint that accepts one) is wired, S1–S3 produce a nicer mask that no model ever sees.

**Recommended insertion point if/when the conditions are met: S1 first** (it is the only seam with a user-facing control and no server spend), then S2 (per-instance, cacheable) once segmentation is live again, then S3 for batches. S4 is a precondition for all of them.

---

## 5. Which categories the stage targets

The issue names *curtains, plants, glass*. In this tree:

| Category | Exists as a detection concept? | Evidence |
| --- | --- | --- |
| **curtains** | ✅ yes — a concept chip | `src/lib/concept-chips.ts:41` (`"curtains"`) |
| **plant** | ✅ yes — a concept chip | `src/lib/concept-chips.ts:40` (`"plant"`) |
| **glass** | ❌ **no** — not a chip, not a validation-allowed concept in the taxonomy; "glass" appears only as a **material swatch / moodboard string** | `src/components/lookbook/material-swatch-card.tsx:13-14`; `src/lib/moodboard-themes.ts:84-86`; repo-wide grep for `curtain|plant|glass` in `src/` returns only the two chips above plus those swatch strings |
| *vision labels* | The **vision-label** output is a free-text noun phrase per instance ("accent chair", "coffee table"), not a fixed category taxonomy — there is no "translucent" label class today | `src/lib/label-instances-service.ts:161` `buildLabelPromptMessages()`; schema `src/lib/ai-route-schemas.ts:275` `visionLabelOutputSchema` |

Consequences:

- A "glass" target would need a **new concept chip** plus its client/server validation mirrors (`isValidConceptName` at `src/lib/concept-chips.ts:78`, `segmentConceptSchema` at `src/lib/ai-route-schemas.ts`), and — per the #223 spike recorded in `src/lib/furnishing-detection.ts:11-27` — a **bare single-concept probe** (multi-term comma lists returned ZERO masks).
- The stage's natural trigger is therefore **concept-scoped, not label-scoped**: apply the matte only to instances selected under the concepts `curtains` / `plant` (and a future `glass` chip). A "label contains 'glass'" rule would be unstable because labels are model-generated free text.
- "plants" in the issue maps to the chip **`plant`** (singular) — the chip list is the taxonomy, and SAM prompts are bare concepts.

---

## 6. Quality vs. added latency and cost

### 6.1 Options

| Option | Quality potential | Added latency per run | Added cost per run | Licence | Notes |
| --- | --- | --- | --- | --- | --- |
| **A. No stage (status quo)** | Binary region only; translucent objects survive or are fully replaced; hard edge softened by the existing free blur | 0 | $0 | — | `featherMask` is already client-side and free |
| **B. fal.ai-hosted matting** (a hosted BiRefNet-class endpoint) | Same weights as local ⇒ same quality ceiling; best-effort per call | +1 network round trip + provider queue (order: seconds); **not measured here** | Per-call price — **not verified here**; SAM-class reference ~$0.005 (`docs/birefnet-cutout-assessment.md:16`); matting endpoints are typically dearer | Weights served by the provider; redistribution terms are the provider's, not ours | Only option that needs no GPU host; adds a second paid dependency and a second failure mode |
| **C. Local BiRefNet (PyTorch) on 6–8 GB VRAM class hardware** | Same weights as B | GPU inference time — **not measured here**; must be measured on the target card | No per-call vendor cost; a GPU host cost that this repo does not have today (no GPU service is wired; serverless cannot host it) | **MIT** (`docs/birefnet-cutout-assessment.md:13`) — code and weights reusable with the notice retained | Cost only wins if the hardware already exists; the #1459 assessment reached the same conclusion for the cutout use case |
| **D. Local BiRefNet ONNX / transformers.js on CPU** | Same weights | Far too slow to sit inside a request path: the *alpha plumbing alone* (one 3-pass separable box blur, no network model) already costs ~170 ms at 1024×768 and ~370 ms at 2048×1536 on this sandbox's CPU (§7 P3) — a full matting network is orders of magnitude more | $0 marginal | MIT (`docs/birefnet-cutout-assessment.md:14`) | Only viable in a background worker, which reintroduces the async problem |

### 6.2 Budget arithmetic (repo's own numbers)

- Inpaint: **~$0.04/image** (`src/app/api/inpaint/route.ts:324` comment; also `docs/birefnet-cutout-assessment.md:17`), cap `DAILY_INPAINT_LIMIT=20`/user/day (`.env.example:83`, `src/lib/api-quota.ts:54`).
- Segment: cap `DAILY_SEGMENT_LIMIT=100`/user/day (`.env.example:95`, `src/lib/api-quota.ts:58`).
- DashScope inpaint is **synchronous ≈30 s** and already sits at the Vercel function ceiling (`src/app/api/inpaint/route.ts:30-34`, #1262: `maxDuration = 60`).
- ⇒ A matte stage that adds **one extra provider call per detection** (option B, ~$0.005–0.01) is ~12–25 % of the inpaint line and is *cacheable* per (image, concept) — acceptable **if** it is per-detection and not per-inpaint.
- ⇒ A matte stage that adds a call **per inpaint run** (worst case 20/user/day) is 20 × $0.005–0.01 = **$0.10–0.20/user/day** — a 2.5–5 % increase on the inpaint line, still small in absolute terms, but it is a *second* paid dependency on the hot path, and it lengthens a flow that is already at its duration ceiling.
- ⇒ A local GPU option (C) only wins if the GPU is already paid for; the repo has no GPU footprint, and Vercel serverless functions cannot host a 6–8 GB VRAM model.

### 6.3 Quality argument, stated honestly

- **Where the stage clearly wins:** a *uniformly* translucent object (sheer curtain, glass panel). The binary mask cannot express "replace at 40 %" (§7 P2d/P4) — the measured failure is not a matter of degree but of expressiveness.
- **Where it likely does not win:** a *leafy* plant. Foliage is not a smooth alpha field; a matte network will produce a plausible-but-wrong alpha, and the generative inpaint has to reconcile a 2048×1536 photo with a matte that does not match the actual object. The #1459 assessment reached a compatible conclusion for BiRefNet in a different task ("dichotomous / salient-object segmentation", `docs/birefnet-cutout-assessment.md:15`): the weights are built for *object vs background*, not for *transmission estimation*.
- **Where it must beat the incumbent:** `featherMask()` is free, client-side, and already produces a soft edge. Any matte stage must show a *measurable* output delta against "binary mask + free edge blur" on the same photos, or it is not worth a second provider.
- **Unmeasurable today:** the actual delta cannot be measured in this sandbox (§1) — no provider calls, no model weights. That is precisely why C3 exists.

---

## 7. What the offline probe measured

`scripts/soft-matte-alpha-probe.mts` — no network, no API key, no model weights; it imports the repo's own modules (`src/lib/prompts.ts`, `src/lib/mask-flood-fill.ts`, `src/lib/mask-coverage.ts`) via a 12-line ESM resolve hook that maps the repo's extensionless relative imports to `.ts`.

```
$ node scripts/soft-matte-alpha-probe.mts
soft-matte alpha probe — issue #1458 (offline, no API, no weights)

[PASS] P1 provider payload carries NO mask
       buildInpaintPayloadForActiveProvider() returned keys [image_url, prompt] — the maskUrl argument is dropped before the wire. …
[PASS] P1b DashScope request body
       the DashScope body built in src/lib/alibaba-adapter.ts has no mask field (inputs: image + text only).
[PASS] P2 alpha grid is binary
       maskGridFromAlphaPixels() collapsed a 256-level alpha ramp into 2 levels {0,1} — the repo's mask representation carries no opacity information (threshold CUTOUT_ALPHA_THRESHOLD=128).
[INFO] P2b luminance decoder on the same buffer
       maskGridFromPixels() → 2 distinct levels {0, 1}; isMaskedPixel() requires alpha >= 128 AND luminance >= 128, so a translucent pixel is classified as "preserve" …
[INFO] P2c coverage vs. alpha mass (alpha ramp)
       estimateMaskCoverage() = 50.0% "masked" while the alpha-weighted mass = 50.0% …
[INFO] P2d uniform 40%-opaque tile
       estimateMaskCoverage() = 0.0% "masked" while the alpha-weighted mass = 40.0%. The binary mask says "replace nothing" for an object that is 40% transparent …
[INFO] P3 alpha blur cost @ mask canvas 1024x768
       radius=8px → 168.7 ms CPU for a 3-pass separable box blur over 786432 alpha samples (single run, no warm-up). Soft band = 6.86% of the canvas; alpha mass preserved = 48.1%.
[INFO] P3 alpha blur cost @ provider size 2048x1536
       radius=15px → 369.5 ms CPU for a 3-pass separable box blur over 3145728 alpha samples (single run, no warm-up). Soft band = 6.23% of the canvas; alpha mass preserved = 48.0%.
[INFO] P4 translucent object after binarisation
       a 40%-opaque object over 1600 px (4.0% of the canvas) is classified as 0 painted px (0.0%) …

9/9 probes passed; no network call, no API key, no model weights were used.
```

(The P3 timings vary between runs on this shared sandbox — 113–169 ms at 1024×768 and 172–370 ms at 2048×1536 across three executions. They are **unoptimised single-run CPU baselines for the alpha plumbing only**, not matting-model latencies.)

What the probes establish:

1. **P1/P1b** — the production provider payload contains no mask ⇒ *a soft-matte stage cannot change the provider's output today*.
2. **P2/P2b** — the repo's mask decoders collapse any alpha to 0/1 ⇒ *a soft matte must be carried in a channel the repo does not have yet*.
3. **P2d/P4** — a uniformly 40 %-opaque object reads as **0 % masked** ⇒ *the current binary path silently preserves translucent objects*, which is the user-visible bug the stage targets.
4. **P3** — the *non-neural* part of an alpha stage is a few hundred ms of CPU at the sizes this repo uses (mask canvas ≤ 1024 long edge per `src/lib/mask-postprocess.ts:36`; provider `size: "2048*1536"` per `src/lib/alibaba-adapter.ts:221`). A neural matte would add its own inference time on top (unmeasured).

---

## 8. Licence position

| Artefact | Licence | Position | Source |
| --- | --- | --- | --- |
| **CorridorKey** | "Other" (as stated in #1458) | **Do not adopt — no code, no weights, no vendored artefacts.** "Other" is not an OSI-permissive grant; redistribution and commercial-use rights are unstated. The *architecture idea* (an alpha-matte refinement between segmentation and inpainting) is taken from the issue text only and is not an expression of CorridorKey's code. If the team wants CorridorKey's specific weights later, a licence review (or a written grant from the author) must precede any use. | issue #1458 (not re-verified from this sandbox — no network) |
| **BiRefNet** (upstream repo) | **MIT** | **Adoptable** — MIT permits commercial use, modification, redistribution and (since the licence covers the distributed artefacts) use of the weights, provided the copyright notice and licence text are retained and the "AS IS" disclaimer is carried. | `docs/birefnet-cutout-assessment.md:13` (cites `github.com/ZhengPeng7/BiRefNet/blob/main/LICENSE`) — recorded in-repo; **not re-verified in this pass** (no network in the sandbox) |
| **`onnx-community/BiRefNet-ONNX`** | **MIT** | **Adoptable** — the ONNX/transformers.js build is the practical one for a 6–8 GB VRAM class host or a CPU worker. Same conditions: retain the notice; pin the artifact hash. | `docs/birefnet-cutout-assessment.md:14` |
| Any *new* runtime dependency | — | **None proposed.** No package.json change is part of this issue. | — |

**Reuse conditions if BiRefNet is adopted later:** (i) retain the MIT licence text and copyright notice in whatever artefact is vendored, (ii) pin the exact model artifact (repo revision / HF revision) in the repo, (iii) re-read the upstream `LICENSE` and the model card at adoption time (this pass had no network), (iv) never mix CorridorKey code or weights into the same artefact.

---

## 9. Recommendation — **CONDITIONAL GO**

**Go** for a *design spike* (no production change), **No-Go** for integrating the stage now.

**Why not a plain go:** with the mask dropped at `src/lib/prompts.ts:448` and every mask decoder binary (`src/lib/mask-flood-fill.ts:43`, `src/lib/mask-coverage.ts:26`), a soft-matte stage would cost money and latency and change **nothing** in the output. That is a measured fact (§7 P1/P2), not a preference.

**Why not a plain no-go:** the underlying defect is real and measurable — a 40 %-transparent object is classified as *preserve* by the current mask contract (§7 P2d/P4) — and the fix has a cheap, licence-clean candidate (MIT BiRefNet, already assessed in #1459).

### The five conditions (all must hold before an integration PR)

- **C1 — the mask reaches the provider.** Either a mask-capable inpaint provider is selected, or DashScope mask support is verified and wired. Until then the stage is a no-op. *Owner: provider evaluation.*
- **C2 — alpha survives end-to-end.** Introduce an alpha-carrying mask representation alongside the binary grid (`mask-flood-fill.ts`, `mask-coverage.ts`, `multi-select-batch.ts:547`, `mask-feather.ts`) and make the union semantics max/over, not OR. *Owner: lib work, feature-flagged.*
- **C3 — offline quality evidence.** Run an **MIT-licensed** matting model (BiRefNet, `onnx-community/BiRefNet-ONNX`) offline over the committed photos in `bake-off/befores/` plus a translucent-object set (sheer curtain, glass panel, plant), and record the delta **against the incumbent** (binary mask + `featherMask`) in this file. A delta that is not visible without side-by-side images is a no-go. *Owner: spike.*
- **C4 — cost and latency ceiling.** Added cost ≤ **$0.01 per detection** (cacheable per (image, concept), never per inpaint run) and added latency ≤ **25 %** of the ~30 s DashScope inpaint call; a hosted endpoint's per-call price must be verified from its price page before it is used. *Owner: spike.*
- **C5 — scope.** The stage is enabled only for concept-scoped instances — `curtains` and `plant` today (`src/lib/concept-chips.ts:40-41`); a `glass` chip (plus its validation mirrors and a bare-concept SAM probe) is a separate, later decision; the stage is behind a flag and off by default.

**Explicitly out of scope / rejected in this evaluation**

- Adopting CorridorKey in any form (§8).
- A GPU host commitment (option C) before C3/C4 show the quality delta is worth it.
- Changing production inpaint or segmentation behaviour — nothing in this issue does.
- A `glass` detection concept — separate issue.

### If the conditions cannot be met

If C1 cannot be met (the provider keeps ignoring masks), the correct outcome is **close as no-go** for this issue: the soft-matte stage has no mechanism to influence output, and the "translucent object survives" defect should instead be filed as a *mask-contract* defect (the binary threshold at `src/lib/mask-coverage.ts:26`), which is fixable without a matting model — e.g. an explicit "also replace partially transparent regions" control, or an eraser/brush interaction that lets a user force-replace a translucent region.

---

## 10. Evidence table

| # | Claim | Source | Kind |
| --- | --- | --- | --- |
| 1 | The inpaint provider is Alibaba DashScope; model id comes from `ALIBABA_INPAINT_MODEL`, default `qwen-image-2.1-pro` | `src/lib/alibaba-adapter.ts:78,106-121`; `.env.example:41` | repo code |
| 2 | The provider payload carries only `image_url` + `prompt`; the mask is dropped | `src/lib/prompts.ts:448,539`; `src/lib/alibaba-adapter.ts:200-224`; **measured** by probe P1/P1b (§7) | repo code + offline run |
| 3 | Every mask decoder is binary at threshold 128 | `src/lib/mask-flood-fill.ts:43,55`; `src/lib/mask-coverage.ts:26,34,45` | repo code |
| 4 | A uniformly 40 %-opaque object reads as 0 % masked | probe P2d/P4 (§7) | offline run |
| 5 | The mask that drives an inpaint is the freehand brush output; feathering is a client-side blur | `src/components/edit-room/MaskLayer.tsx:136`; `src/lib/mask-feather.ts:67`; `src/app/(dashboard)/projects/[id]/project-detail-view.tsx:1630` | repo code |
| 6 | The fal/Replicate adapters are retired; `SAM_3_1_IMAGE` is not wired on the Alibaba adapter | `src/lib/inference.ts:286-300,315-327`; `src/lib/alibaba-adapter.ts:106-121` | repo code |
| 7 | No client calls `/api/segment/furnishings`; detections are hard-coded placeholders | `src/components/edit-room/EditRoomStudio.tsx:718-734` | repo code |
| 8 | Concept taxonomy contains `plant` and `curtains` but no `glass` | `src/lib/concept-chips.ts:31-49`; `src/components/lookbook/material-swatch-card.tsx:13-14` | repo code |
| 9 | Vision labels are free-text noun phrases, not a fixed category taxonomy | `src/lib/label-instances-service.ts:161`; `src/lib/ai-route-schemas.ts:275` | repo code |
| 10 | Inpaint ≈ $0.04/image; segment ≈ $0.005/call; caps 20 inpaint / 100 segment per user per day | `src/app/api/inpaint/route.ts:324`; `docs/birefnet-cutout-assessment.md:16-17`; `.env.example:83,95` | repo + sibling doc |
| 11 | DashScope inpaint is synchronous ≈30 s, `maxDuration = 60` | `src/app/api/inpaint/route.ts:30-34` | repo code |
| 12 | BiRefNet is MIT; the ONNX build is MIT | `docs/birefnet-cutout-assessment.md:13-14` (upstream `LICENSE` links) — **not re-verified here (no network)** | sibling doc |
| 13 | CorridorKey's licence is "Other" | issue #1458 text — **not re-verified here (no network)** | issue |
| 14 | A matting model cannot be run in this sandbox | `python3 -c "import torch"` → `ModuleNotFoundError`; same for `onnxruntime`; `node_modules/` empty | sandbox observation |
| 15 | Repo masks are per-`(image, concept)` cacheable, so a per-detection matte is paid once | `src/lib/segment-cache.ts:84`; `src/lib/furnishing-detection.ts:32,106` | repo code |

---

## 11. Files touched by this issue

- `docs/1458-soft-matte-evaluation.md` — this document (new).
- `scripts/soft-matte-alpha-probe.mts` — offline probe harness (new). No network, no API key, no weights; imports repo modules read-only; touches no production code path.

No production behaviour, dependency, config or env contract changed.
