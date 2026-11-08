# ER-Chord / PreciseEdit evaluation for the one-step editing path

**Issue:** [#1444](https://github.com/anchapin/staging-studio/issues/1444) — Evaluate ER-Chord (arXiv:2610.29248) and PreciseEdit (arXiv:2610.23535), both training-free one-step image editors, against Staging Studio's current mask-guided inpainting pipeline.
**Date:** 2026-10-23
**Status:** Research-only (no code changes in this issue).
**Labels:** `inpainting`, `research`
**Sibling doc:** [`docs/lenserase-removal-evaluation.md`](lenserase-removal-evaluation.md) (#1445) — same house style, same four axes, same evidence rules.

---

## 0. TL;DR

- **The issue's premise is half stale, and this changes the answer.** The issue says the pipeline is "fal.ai FLUX.1 Fill for mask-guided inpainting". In the worktree today the fal **inpaint** adapter was **retired in #1240**; the only wired inpaint provider is **Alibaba DashScope `qwen-image-2.1-pro`** (`src/lib/inference.ts:1-41`, `src/lib/alibaba-adapter.ts:108-112`), and the payload builder **drops the mask entirely** — the provider receives image + text and nothing else (`src/lib/prompts.ts:448-455`, `src/lib/alibaba-adapter.ts:204`). FLUX.1 Fill survives only as (a) a legacy payload builder still pinned by tests (`src/lib/prompts.ts:369-389`), (b) the documented continuity fallback (`docs/vendor-investigation/1240-bakeoff-oct-2026.md:206`), and (c) the *incumbent arm* of our own bake-off harness (`bake-off/RESULTS.md`).
- **Neither paper is compared against FLUX.1 Fill, and neither is compared against our production model.** "FLUX" appears **zero times** in the full text of both papers (grep over the arXiv HTML renders of arXiv:2610.29248v1 and arXiv:2610.23535v1). Their baselines are academic editors (ChordEdit, WhereEdit, SwiftEdit, FlowEdit, InfEdit…). `qwen-image-2.1-pro` appears in neither. So the issue's core question — "does it match FLUX quality at lower latency/cost?" — **cannot be answered from the papers**; the only honest answer comes from our own measured numbers (§5).
- **ER-Chord (arXiv:2610.29248) — TRIAL NEXT, as a research spike only, NOT as an alternative vendor or a production fallback.** It is the only one of the two that can be run today: public **MIT-licensed** code at `github.com/Peizeli1/ER-Chord` (HTTP 200, repo created 2026-10-21) with an `inference.py` + `run_pie_bench.py` harness. Paper-reported: **0.37 s/image**, peak VRAM **6988 MiB**, NFE 1–2, on a 512² SD-Turbo backbone, **+0.57 dB unedited-region PSNR** over its own base method (ChordEdit) on PIE-Bench. Blocking mismatches: it is **512×512 with a centre-crop for non-square inputs** (code, `pipeline_er_chord.py`: `_CenterSquareCropTransform`, `image_size: int = 512`) — our editor canvas is 2048×1536; it has **no mask channel** (image + source/target prompt only); and its backbone weights (`stabilityai/sd-turbo`) are under the **Stability AI Community License** (commercial use requires registration and is void above **US $1,000,000** annual revenue).
- **PreciseEdit (arXiv:2610.23535) — MONITOR (cannot evaluate today).** Paper says "Code will be made publicly available upon acceptance"; there is no repo, no weights, no API, no project page. Paper-reported: **0.42 s/image**, **6954 MiB** VRAM, on **one RTX 3090 24 GB**, 512² PIE-Bench. It is the more interesting method for us (it has a *mask* story — Table 5 shows GT-mask guidance lifting unedited-region PSNR to ~30 dB), but there is **nothing to run**.
- **Plain answer to the issue's ask: no, neither should replace FLUX Fill / the current provider, and neither is a fallback.** FLUX-family fill at 2048×1536 is a *mask-locked* edit (our own drift test: mean RGB delta **~0.006** outside the mask, `bake-off/drift-results.md`); a 512², prompt-driven, self-hosted one-step model cannot reproduce that contract at our output size, and its "preserve the unedited region" evidence is a **PSNR-on-PIE-Bench** number, not furniture realism or lighting consistency.
- **First concrete step (§8):** run the public ER-Chord repo, unmodified, over our own bake-off fixtures (`bake-off/befores/{vacant-insert,occupied-replace,repeat-stability}_before.jpg`, same masks) at the fixtures' native aspect (centre-cropped, 512² — the resolution gap is itself a measured result), score outside-mask drift with the existing `scripts/bake-off-drift-test.mts` methodology, and compare against the incumbent row in `bake-off/RESULTS.md`. **This is a research script, not a product change.**

---

## 1. Scope and method

**Issue:** #1444 — evaluate two training-free one-step editing methods (ER-Chord, PreciseEdit) against the staging pipeline on (1) inpainting quality (furniture realism, lighting consistency), (2) architecture preservation outside the mask, (3) latency per edit, (4) cost per edit / self-host compute.

**What this document is.** A desk-research evaluation in the same house style as `docs/lenserase-removal-evaluation.md` (#1445) and the older vendor bake-offs (`docs/vendor-investigation/235-…`, `236-…`, `1240-…`): current state with file citations, per-method analysis on the issue's four axes, a comparison table, a verdict per model, and a concrete first step. **No pipeline code changes are made in this issue.**

**Evidence rules applied.**

1. Every claim about *this repo* cites a file (and line) in the worktree. Every claim about a *paper* cites its arXiv id and the paper's own table/section, and is labelled **paper-reported**.
2. Paper numbers are quoted with their context (backbone, resolution, benchmark, hardware) or not at all. Where the paper does not publish something (e.g. a GPU model, a price), the cell says **not published** rather than estimating.
3. Paper text was read from the **arXiv HTML render** (`https://arxiv.org/html/2610.29248v1`, `https://arxiv.org/html/2610.23535v1`), fetched **2026-10-23**; the code claims are read from the **actual repository** (`github.com/Peizeli1/ER-Chord`), fetched the same day, with HTTP status recorded in §9.
4. Repo-measured numbers (latency, cost, drift) come from our own committed bake-off artefacts (`bake-off/RESULTS.md`, `bake-off/drift-results.md`), which outrank any paper's marketing claim.
5. Licence facts are quoted from the licence text itself (arXiv licence field, the repo's `LICENSE`, the Hugging Face model licence file), not from memory.

**Limits of this pass.**

- Neither model was run on our hardware or our images (ER-Chord *could* be — §8 specifies the run; PreciseEdit has no code).
- Both papers evaluate at **512×512** on PIE-Bench / TEdBench; our editor canvas is **2048×1536** (`src/lib/alibaba-adapter.ts:221`). Every quality number below is therefore a *lower-resolution proxy*, not a match for our production output.
- Neither paper publishes a furniture-realism or lighting-consistency metric. The issue's axis 1 is **not covered by either paper**; what they do publish is masked/unedited-region PSNR-MSE-LPIPS-SSIM and CLIP alignment (§4, §5). We state this plainly rather than translating PSNR into a realism claim.

---

## 2. Current state: what the inpaint pipeline actually does today

### 2.1 The call chain

```
client mask + directives
  → POST /api/inpaint                      src/app/api/inpaint/route.ts:35 (maxDuration 60)
  → submitInpaintToActiveProvider()        src/lib/inpaint-submit.ts:375-416
  → buildInpaintPrompt(aesthetic, dirs)    src/lib/prompts.ts:343-351
  → buildInpaintPayloadForActiveProvider() src/lib/prompts.ts:539-554
  → provider adapter                       src/lib/alibaba-adapter.ts (only wired provider)
```

- The mask is produced client-side (`src/components/edit-room/MaskLayer.tsx:24`) and, for the "restage furnishings" preset, from SAM 3.1 furniture detection on fal (`src/lib/furnishing-detection.ts:32`, `fal-ai/sam-3-1/image`), then cleaned by `src/lib/mask-postprocess.ts:48`, dilated by `src/lib/mask-dilation.ts:74` and feathered in the browser (`src/lib/mask-feather.ts`).
- The server receives the mask (`src/app/api/inpaint/route.ts:301`), puts it in the provider-neutral input (`src/lib/inpaint-submit.ts:381`, `:393`) — and then **the mask is dropped on the wire** by the Alibaba payload builder:

```ts
// src/lib/prompts.ts:448-455
export function buildAlibabaFillPayload(input: AlibabaFillPayloadInput): AlibabaFillPayload {
  return { image_url: input.imageUrl, prompt: input.prompt };
}
```

  and the DashScope body carries exactly one image plus one text turn (`src/lib/alibaba-adapter.ts:204`: `content: [{ image: imageUrl }, { text: prompt }]`), at `size: "2048*1536"` (`src/lib/alibaba-adapter.ts:221`).

### 2.2 Which model actually runs

| Thing | Value | Where |
|---|---|---|
| Logical inpaint model | `flux-fill` (the only inpaint logical model id) | `src/lib/inference.ts:47-48` |
| Wired provider | Alibaba Cloud DashScope | `src/lib/inference.ts:1-41`, `src/lib/inference.ts:72-100` (`resolveProvider`) |
| Concrete model id | `qwen-image-2.1-pro` (override: `ALIBABA_INPAINT_MODEL`) | `src/lib/alibaba-adapter.ts:108-112`, `.env.example:41` |
| fal / Replicate inpaint adapters | **retired** (modules deleted; the env values are rejected at configure time) | `src/lib/inference.ts:1-41`, `src/lib/inference.ts:59-65` |
| fal still in use for | SAM 3.1 segmentation only | `src/lib/furnishing-detection.ts:32` |
| Legacy FLUX fill payload | guidance default **7.5**, `num_inference_steps: 28`, `mask_url` on the wire — still in the tree and pinned by tests | `src/lib/prompts.ts:369-389` (`:377`, `:388`) |

So "fal.ai FLUX.1 Fill" is today the **documented fallback**, not the production path: "FLUX.1 Fill (fal) — keep as documented fallback for the Alibaba path… the previously-deleted adapter can be restored from git history at the cost of a one-day integration" (`docs/vendor-investigation/1240-bakeoff-oct-2026.md:206-210`).

### 2.3 Measured latency and cost of the incumbent(s) — our own numbers

These are the numbers any candidate has to beat; they are **repo-measured**, not paper-reported.

| Arm | Latency per edit | Cost | Outside-mask drift | Where |
|---|---|---|---|---|
| **FLUX.1 [pro] Fill (fal)** — the issue's stated incumbent | 16.7 s / 20.6 s / 22.7 s on the three bake-off cases (1440×928 output) | $0.05 / megapixel | **mean RGB delta ~0.006**, max 8 (3 runs, seed 42, 728k unedited px) | `bake-off/RESULTS.md` (run 2026-10-12), `bake-off/drift-results.md` |
| **Alibaba `qwen-image-2.1-pro`** — the **production** model | 38.0 s / 32.1 s / 33.7 s (2048×1536 output) | $0.04 / image | **mean delta 0.000, max 0** (byte-identical across runs at fixed seed) | `bake-off/RESULTS.md`, `bake-off/drift-results.md` |
| Alibaba submit latency (code comment) | "synchronous and takes ~30s" | — | — | `src/app/api/inpaint/route.ts:26-34` |
| Demo narration budget | "~35s measured", "≤90s live result" | — | — | `docs/DEMO_SCRIPT.md:23-24` |
| Per-image cost baseline | — | `~$0.04/image` | — | `src/lib/api-quota.ts:39` |
| Daily inpaint cap | — | 20 units/user/day (≈ $0.80/user/day at list price) | — | `src/lib/api-quota.ts:54`, `src/lib/api-quota.ts:39-40` |
| Legacy fal fill price used in the bake-off | — | $0.05/MP (incumbent row); $0.035/MP quoted for the fal product in the same doc | — | `bake-off/RESULTS.md`, `docs/vendor-investigation/235-gpt-image-vs-nano-banana-vs-fal.md:71` |

### 2.4 The architecture-preservation question is *not* currently mask-enforced

Two repo facts matter for axis 2:

1. **No mask reaches the model today** (§2.1). Outside-region preservation is therefore a property of the *model*, not of our plumbing. Our own measurement says the production model does not drift at all with a fixed seed (mean delta 0.000, `bake-off/drift-results.md`) — i.e. the "architecture drift" fear in the issue is not the dominant failure mode of the current path.
2. **Our mask UX is a scoped-edit contract, not a style contract.** The user paints a mask ("replace the sofa") and expects *only* that region to change (`src/lib/mask-coverage.ts:4`, `src/lib/mask-dilation.ts:6`). FLUX-family fill honours that by construction (white = regenerate, black = preserve, `docs/vendor-investigation/1240-bakeoff-oct-2026.md:66-68`); a **prompt-driven** one-step editor does not, however good its "unedited-region PSNR" is.

**This is the crux for both candidates:** both are *prompt-scoped* editors whose preservation is measured against a GT mask *after the fact*. Neither offers a mask channel as its primary interface, and neither is a furniture-realism model.

---

## 3. ER-Chord — arXiv:2610.29248

**Title:** *ER-Chord: Spatially Consistent One-Step Image Editing via Equal-Energy Reliability Redistribution* (Peize Li et al.; NUS / Kuaishou / DLUT / Tianjin / HIT / Tencent). Submitted 2026-10-21. Paper licence **CC BY 4.0**. Project page → `github.com/Peizeli1/ER-Chord`.

### 3.1 Mechanism (what it actually does)

- ChordEdit (its base method) stabilises a one-step edit by **temporally aggregating** source→target proxy fields from two neighbouring noise levels (`t=0.90`, `t-δ`, δ=0.15). ER-Chord's claim is that temporal stability ≠ spatial consistency: the two endpoint fields agree *differently in different places*, and uniform aggregation spends editing energy on unreliable background.
- ER-Chord therefore measures a **local reliability signal from endpoint agreement** and re-allocates the *same total control energy* across space (equal-energy constraint, reliability-weighted quadratic program), preserving the local edit **directions** and the total energy. The problem admits a **unique global solution** found by **1-D bisection (≤32 iterations, <0.01 s CPU)**, using the field evaluations that already exist → **no additional denoiser calls, no training, no inversion, no backprop** (abstract; §3.2-3.3; Appendix A, B.1).
- It is therefore a **post-hoc re-weighting layer on top of an existing one-step editor**, and it inherits that editor's interface: **image + source prompt + target prompt**, no mask.

### 3.2 The one-step claim

- NFE = 1 (transport only) or NFE = 2 (transport + post-hoc temporal cleanup); 1 sampling step (`configs/er_chord.yaml`: `n_steps: [1]`, `cleanup: [true]`).
- Backbones it was demonstrated on: **SD-Turbo**, SwiftBrush-v2, InstaFlow (Table 4).

### 3.3 Unedited-region preservation (paper-reported)

PIE-Bench (700 examples), SD-Turbo, seed 42, unedited-region metrics (Table 1 / §4.2):

| Method | PSNR↑ | MSE↓ | LPIPS↓ | CLIP-Whole↑ | CLIP-Edited↑ | Steps | NFE | Time (s)↓ | VRAM (M)↓ |
|---|---|---|---|---|---|---|---|---|---|
| ChordEdit (SD-Turbo) | 22.20 | 6.84 | 128.25 | 25.58 | 22.96 | 1 | 2 | 0.38 | 6988 |
| **ER-Chord (SD-Turbo)** | **22.77** | **6.35** | **120.23** | **25.74** | **23.16** | 1 | 2 | **0.37** | 6988 |
| ER-Chord (w/o cleanup) | 24.31 | 4.70 | 82.82 | 25.04 | 21.99 | 1 | 1 | 0.20 | 6988 |

- The headline gain is **+0.57 dB** unedited-region PSNR over its own base method (abstract, §4.2). Ablations: heuristic "reweight-and-normalize" 22.40 dB; spatially permuted multipliers 21.05 dB (§4.3) — i.e. the *placement* of energy is what produces the gain.
- TEdBench (100 real-image prompts, Table 3): LPIPS 0.21 → **0.20**, CLIP-I 0.91 → **0.92** vs ChordEdit; CLIP-T 0.28 → 0.29; Dir-Sim 0.25 = 0.25.
- **Honest scale of the claim:** +0.57 dB is a *modest* improvement over one baseline, measured on a 512² benchmark, with **no furniture-realism or lighting-consistency metric** and **no FLUX.1 Fill row**. Absolute numbers (22.77 dB, LPIPS 120×10⁻³) are *not* comparable to FLUX Fill or to `qwen-image-2.1-pro` — neither appears in the paper.

### 3.4 Availability, licence, compute

| Artifact | Status (2026-10-23) | Evidence |
|---|---|---|
| Official code | **Public and runnable**: `github.com/Peizeli1/ER-Chord` — HTTP 200; MIT licence; files `inference.py`, `er_chord.py`, `pipeline_er_chord.py`, `run_pie_bench.py`, `run_tedbench.py`, `summarize_diagnostics.py`, `configs/er_chord.yaml`; repo created 2026-10-21, 2 stars, 31 KB | GitHub API + raw file fetches, §9 |
| Weights | **No ER-Chord weights** — training-free. Needs `stabilityai/sd-turbo` (public, not gated) laid out as `unet/ scheduler/ text_encoder/ tokenizer/ vae/` | repo `README.md` §1 |
| Hosted API | **None** | no reference in the paper or repo |
| Paper licence | **CC BY 4.0** (commercial OK with attribution) | arXiv abs page licence field; HTML render footer |
| Code licence | **MIT** | repo `LICENSE` |
| Backbone licence | `stabilityai/sd-turbo`: **Stability AI Community License** — commercial use allowed **only** after registration at `stability.ai/community-license`, and **terminates above US $1,000,000 annual revenue** | `https://huggingface.co/stabilityai/sd-turbo/raw/main/LICENSE.md` §1, §3 |
| Runtime deps | `torch==2.5.0`, `diffusers==0.35.1`, `transformers==4.49.0`, `lpips`, `git+https://github.com/openai/CLIP.git` | repo `requirement.txt` |
| **Self-host compute** | **Paper-reported**: 0.37 s/image, peak VRAM **6988 MiB**, same for ChordEdit (no extra activations; bisection is <0.01 s CPU). **The paper never names the GPU** — it only states timings were measured "on the same GPU" with identical precision/batch/warm-up (App. B.2). So the 0.37 s figure is **not** transferable to a specific card without our own measurement. | §4.3, App. B.2 |
| **Repo cost** | **Not published** (self-hosted; no price). Our repo has **no self-hosted GPU fleet and no GPU rate card** — so a $/edit for ER-Chord cannot be computed here without inventing a rate. The only comparable figures are the hosted ones in §2.3 ($0.04/image Alibaba; $0.05/MP fal FLUX Fill). | absence of any GPU rate card in the repo; same conclusion as `docs/lenserase-removal-evaluation.md` §5 |

### 3.5 The fit problem (axis-by-axis, ER-Chord)

- **Resolution / geometry (repo fact, decisive for our canvas).** The public pipeline resizes to a **square** `image_size=512` and, for non-square inputs, **centre-crops the shorter dimension first** (`_CenterSquareCropTransform`, `ImageOps.fit`; `_use_center_crop` also crops the VAE tensor). Our editor output is **2048×1536** (`src/lib/alibaba-adapter.ts:221`) and our bake-off fixtures are **2000×1333** (`bake-off/befores/*.jpg`). Feeding those in loses the left/right thirds of the room and returns 512×512 — a 6× pixel-count reduction versus the production path.
- **Mask channel.** None in the shipped CLI: `inference.py` takes `--image --source-prompt --target-prompt`. `use_attention_mask` in `pipeline_er_chord.py` is the *text-encoder* attention mask, not an image mask. So our SAM/dilated/feathered masks (`src/lib/furnishing-detection.ts:32`, `src/lib/mask-dilation.ts:74`) **cannot** be used to scope the edit; they can only be used afterwards to *score* preservation.
- **Furniture realism / lighting consistency (axis 1).** Not evaluated by the paper in any form that maps to staging: no VLM-judge rubric, no interior-scene benchmark, no lighting metric. The paper's edits are object/attribute transformations on PIE-Bench photos at 512². **Unverified for us.**
- **Latency (axis 3).** Genuinely excellent *on the paper's own hardware*: 0.37 s/image vs our production 32–38 s and the FLUX incumbent 17–23 s (`bake-off/RESULTS.md`). Even a 10× pessimisation on a card we would actually buy keeps it far inside the 35 s demo budget (`docs/DEMO_SCRIPT.md:23`). **The catch is that the number is hardware-agnostic in the paper** and the whole scheme needs a GPU we do not currently have.
- **Cost (axis 4).** Self-host → amortised GPU cost; no published $/edit; SD-Turbo's Community License (registration + $1M revenue cap) is a *product* constraint, not a research one.

---

## 4. PreciseEdit — arXiv:2610.23535

**Title:** *PreciseEdit: Strong Yet Stable Semantic Transport for One-Step Image Editing* (submitted 2026-10-16; 9 pages, 7 figures, 5 tables). Paper licence **CC BY 4.0**. No project page, no repository link in the abstract or HTML render.

### 4.1 Mechanism (what it actually does)

- Reframes one-step editing as a tension between **semantic strength** and **transport stability**, and argues strong transport is not inherently unstable — it must be applied *along reliable directions* and *at reliable locations*.
- Two components:
  - **SCT (strong conditional transport)** at a **higher noise scale** (`t_h = 0.90`) — the "strong target-directed transport used for actual editing".
  - **PreciseMask** at a **lower noise scale** (`t_l = 0.35`) — a *position-wise continuous spatial gate* built from **lower-noise cross- and self-attention** (branch-specific seeds + self-attention graph-Laplacian refinement + adaptive soft gating), plus a **cross-scale directional agreement** term. "No external segmenter, learnable parameters, or additional U-Net evaluation for mask generation" (§3.3).
- Model-agnostic, **training-free and inversion-free**. One batched U-Net evaluation covers source- and target-conditioned branches at both noise scales, plus one target-only proximal refinement (§4.1).
- **Crucially for us: the mask is *derived*, not supplied.** PreciseEdit's own mask is internal. But the paper *does* report **GT-mask-conditioned** variants as an oracle (Table 5), which is the closest thing either paper has to our mask-first contract.

### 4.2 The one-step claim

1 step; default backbone **SD-Turbo**; FP32; one shared Gaussian noise sample (`n=1`); `t_h=0.90`, `t_l=0.35`, `t_r=0.30`, SCT attraction coefficient `k=2.0`, latent step size 1.0 (§4.1).

### 4.3 Unedited-region preservation (paper-reported)

PIE-Bench (700 samples, **512×512**), SD-Turbo, RTX 3090 24 GB (Table 1):

| Method | PSNR-Unedit↑ | MSE↓ | LPIPS↓ | CLIP-Whole↑ | CLIP-Edited↑ | Steps | Time (s)↓ | VRAM (M)↓ |
|---|---|---|---|---|---|---|---|---|
| FlowEdit (SD3) | 22.18 | 8.74 | 105.20 | 26.81 | 23.77 | 33 | 6.94 | 18536 |
| TurboEdit (SDXL-Turbo) | 22.50 | 9.30 | 105.57 | 24.68 | 21.79 | 4 | 0.96 | 18004 |
| InfEdit (SD1.4) | 29.59 | 2.26 | 37.10 | 23.04 | 20.34 | 4 | 0.85 | 7620 |
| InstantEdit (PeRFlow-SD1.5) | 28.60 | 2.80 | 44.94 | 25.09 | 21.97 | 4 | 1.45 | 10994 |
| SwiftEdit (SwiftBrush-v2) | 24.22 | 5.41 | 76.39 | 24.48 | 21.56 | 1 | 0.92 | 19628 |
| ChordEdit (SD-Turbo) | 22.64 | 8.00 | 118.50 | 24.82 | 22.16 | 1 | 0.50 | 7418 |
| WhereEdit | 23.96 | 8.05 | 108.91 | 25.21 | 22.66 | 1 | 0.59 | 7436 |
| **PreciseEdit (ours)** | **24.37** | 8.33 | 98.66 | 25.45 | **23.36** | 1 | **0.42** | **6954** |
| PreciseEdit (w/ GT mask) | **27.34** | 2.65 | 43.20 | 25.77 | 23.90 | 1 | 0.38 | 6936 |

- **Mask-strategy table (Table 5)** — the most decision-relevant table for us, because it shows what a *user-supplied* mask buys: ChordEdit transport goes 22.64 → **31.38 dB** with the GT mask; WhereEdit 23.96 → 30.21; PreciseEdit's own internal PreciseMask reaches 27.78–28.55 dB at a small CLIP-Edited cost. PreciseMask's own localisation quality is **53.18 % IoU / 42.35 % Boundary F1** vs WhereEdit 44.19 % and LIME 16.59 % (Table 2, Fig. 7).
- **Honest scale:** the *headline* comparison in the paper is against **academic one-step editors**, not against a production fill model. **No FLUX row, no `qwen-image-2.1-pro` row.** No furniture-realism or lighting metric. All at 512².

### 4.4 Availability, licence, compute

| Artifact | Status (2026-10-23) | Evidence |
|---|---|---|
| Official code | **Not available.** The paper states: "Code will be made publicly available upon acceptance" (§4.1). No repository or project link appears in the abstract page or the HTML render. | arXiv abs page + HTML render, §9 |
| Weights | n/a (training-free) | — |
| Hosted API | **None** | — |
| Paper licence | **CC BY 4.0** | arXiv abs page licence field; HTML render footer |
| **Self-host compute** | **Paper-reported**: **0.42 s/image**, peak VRAM **6954 MiB**, on **one NVIDIA GeForce RTX 3090 (24 GB)**, FP32 (§4.1, Table 1). This is the only one of the two candidates whose hardware is named, so its latency figure is the more portable of the two. | §4.1 |
| **Cost** | **Not published** (self-host). Same caveat as ER-Chord: no GPU rate card exists in this repo, so $/edit cannot be computed without inventing one. | — |

### 4.5 The fit problem

- **512×512 only, SD-Turbo backbone** — same resolution ceiling as ER-Chord, same gap to our 2048×1536 output.
- **No mask channel in the shipped design** — the mask is internal; the GT-mask rows are oracle ablations (Table 5). So a PreciseEdit integration would either (a) ignore our masks, or (b) require the authors' unreleased GT-mask code path.
- **Cannot be evaluated at all today** — no code. Everything above is paper-reported and unverified by us.

---

## 5. Comparison table

"Today" = the production pipeline as it exists in this repo (§2). Paper columns are the papers' own numbers with their own context; "not published" is used rather than an estimate. "FLUX.1 Fill" and "qwen-image-2.1-pro" appear in **neither** paper.

| Axis | **Today — Alibaba `qwen-image-2.1-pro`** (repo-measured) | **FLUX.1 [pro] Fill (fal)** — the issue's stated incumbent (repo-measured) | **ER-Chord** (arXiv:2610.29248) | **PreciseEdit** (arXiv:2610.23535) |
|---|---|---|---|---|
| **Form** | Hosted API, image + text, **no mask on the wire** (`src/lib/prompts.ts:448-455`, `src/lib/alibaba-adapter.ts:204`) | Hosted API, image + **binary mask** (white = regenerate), 28 steps, guidance 7.5 (`src/lib/prompts.ts:369-389`) | **Training-free, inversion-free** re-weighting layer on a one-step editor (ChordEdit) on a **distilled** backbone; 1 step, NFE 1–2 | **Training-free, inversion-free**, model-agnostic: strong conditional transport (high noise) + internal attention-derived mask gate (low noise) + cross-scale directional agreement; 1 step |
| **1. Inpainting quality (furniture realism, lighting consistency)** | Not measured in-repo for realism; the only pre-flight signal is an advisory prompt-text gate (`src/lib/inpaint-quality-gate.ts:40`). Outputs at 2048×1536 (`src/lib/alibaba-adapter.ts:221`) | "Architecture-preserved (proven)" on vacant + occupied staging; mild repeat-edit drift (`docs/vendor-investigation/1240-bakeoff-oct-2026.md:178`) | **Not evaluated by the paper** for realism/lighting. Paper-reported masked/unedited metrics only (PIE-Bench PSNR 22.77 dB, CLIP-Edited 23.16) | **Not evaluated by the paper** for realism/lighting. Paper-reported PIE-Bench PSNR-Unedit 24.37 dB, CLIP-Edited 23.36 (27.34 / 23.90 with GT mask) |
| **2. Architecture preservation outside the mask** | **No mask on the wire**, yet measured drift outside the mask region is **0.000 mean / 0 max** at fixed seed (`bake-off/drift-results.md`) | **~0.006 mean RGB delta** outside the mask across 3 runs (max 8) (`bake-off/drift-results.md`) — the strongest *mask-locked* behaviour in our measurements | Paper-reported **+0.57 dB** unedited-region PSNR over its own base method (22.20 → 22.77, PIE-Bench, Table 1); **no mask input** — preservation is a by-product, not a constraint; **no FLUX/qwen row** | Paper-reported **+1.73 dB** over ChordEdit (22.64 → 24.37) and **+9.8 dB** from mask gating (Table 5: 14.56 → 24.37; GT-mask rows 30–31 dB); mask is **derived**, GT-mask rows are oracle |
| **3. Latency per edit** | **32.1–38.0 s** measured (2048×1536) (`bake-off/RESULTS.md`); code comment "~30s" (`src/app/api/inpaint/route.ts:26-34`) | **16.7–22.7 s** measured (1440×928) (`bake-off/RESULTS.md`) | **0.37 s/image** (0.20 s without cleanup), peak VRAM 6988 MiB — **paper-reported, GPU model not named** (§4.3, App. B.2) | **0.42 s/image**, peak VRAM 6954 MiB, **one RTX 3090 24 GB, FP32** — paper-reported (§4.1, Table 1) |
| **4. Cost per edit / compute** | **$0.04/image** (`src/lib/api-quota.ts:39`); cap 20/user/day (`:54`) | **$0.05/MP** per the bake-off slot price (`bake-off/RESULTS.md`); the bake-off doc quotes **$0.035/MP** and **~$0.11 at the editor's 3.1 MP** (`docs/vendor-investigation/1240-bakeoff-oct-2026.md:71`, `:178`) — *our own two docs disagree on the per-MP rate*, so treat the per-edit figure as "$0.11–$0.16" | **Self-host; cost not published.** Needs a GPU (~7 GB VRAM per the paper) we do not have; backbone `sd-turbo` under Stability AI Community License (registration + **US $1 M revenue cap**) | **Self-host; cost not published.** Same GPU gap; ~7 GB VRAM on a 3090 |
| **Integration effort** | — | fal adapter deleted in #1240; restore-from-git ≈ 1 day (`docs/vendor-investigation/1240-bakeoff-oct-2026.md:206-210`) | New self-hosted inference path: weights + Python service + a new `InferenceClient` adapter arm (`src/lib/inference.ts:157-190` pattern) + a **512²** output path that does not match our 2048×1536 canvas | Cannot estimate — **no code exists** |
| **Risks** | Mask not enforced by the provider; prompt-only edits (`src/lib/prompts.ts:448-455`) | Queue latency; per-megapixel pricing | 512² centre-crop of a 2000×1333 room; no mask channel; licence cap; no GPU fleet; "preserve" is PSNR, not realism | Nothing to run; same 512² / no-mask-channel limits; GT-mask rows are oracle-only |
| **Published comparison vs our production model?** | — | — | **No** (no FLUX, no qwen row) | **No** (no FLUX, no qwen row) |

---

## 6. Verdict per model

| Model | Verdict | Why | What would change the verdict |
|---|---|---|---|
| **ER-Chord** (arXiv:2610.29248) | **TRIAL NEXT — research spike only. Not an alternative vendor, not a production fallback.** | It is the only candidate we can actually run today (public MIT repo, `github.com/Peizeli1/ER-Chord`), it is training-free and licence-clean (CC BY 4.0 code+paper), and its latency is the best number in this evaluation by two orders of magnitude (0.37 s vs our 32–38 s). But it fails the three tests that matter for *this* pipeline: **no mask channel** (our UX is mask-scoped), **512² centre-crop** (our canvas is 2048×1536), and **no evidence at all on furniture realism or lighting consistency** — its preservation evidence is a 512² PSNR delta against its own base method, with no FLUX and no `qwen-image-2.1-pro` row to compare against. | The spike (§8) shows (a) the outside-mask drift on *our* fixtures is comparable to the incumbent (~0.006) **after** the 512² crop, and (b) a visible furniture/lighting quality gap that is not closable by prompt work. Either failing ⇒ drop. A *product* verdict additionally needs a GPU line item and a licence path for `sd-turbo` under the Stability AI Community License (registration + US $1 M revenue cap). |
| **PreciseEdit** (arXiv:2610.23535) | **MONITOR (revisit when code ships)** | Technically the better fit on our axes: it is the only candidate with a *mask* story (GT-mask guidance → ~30 dB unedited PSNR, Table 5), it names its hardware (RTX 3090 24 GB, 0.42 s, 6954 MiB), and it reports the best CLIP-Edited of any one-step baseline. But **there is nothing to run**: "Code will be made publicly available upon acceptance", no repo, no weights, no API, no project page. An evaluation of an unrunnable method is a literature summary, not an evaluation. | Code released (MIT or Apache-2.0 ideally) **and** a mask-conditioned configuration exposed, **and** a published number against a production fill model (FLUX.1 Fill or `qwen-image-2.1-pro`). |

**Summary of the verdicts:** one *research spike* (ER-Chord), one *monitor* (PreciseEdit), and **no vendor switch and no fallback change** — neither method is available as a product, and neither publishes a comparison against the models we actually run.

**Direct answer to the issue's closing question ("if either matches FLUX quality at lower latency/cost, recommend it as alternative vendor or fallback; otherwise say so plainly"):** **Plainly: no.** ER-Chord is faster (0.37 s vs 17–23 s) and cheaper per GPU-second than any hosted API we could buy, but it does **not** match FLUX-quality output for our use case at our output size (512² centre-cropped vs 2048×1536 mask-locked fill), it offers no mask scoping, and it publishes no quality evidence for furniture realism or lighting consistency. PreciseEdit cannot be run at all. Neither is recommended as an alternative vendor or as a fallback; the existing fallback rail stays as documented (`docs/vendor-investigation/1240-bakeoff-oct-2026.md:206-210`), and any self-hosted tier would be an **additional** option, never a replacement.

---

## 7. Risks, contradictions and open questions

**Contradictions found (reported, not smoothed over).**

1. **Issue premise vs repo.** The issue says the pipeline is "fal.ai FLUX.1 Fill for mask-guided inpainting". In the worktree the fal inpaint adapter is deleted (`src/lib/inference.ts:1-41`) and production is `qwen-image-2.1-pro` (`src/lib/alibaba-adapter.ts:108-112`). The *mask* part of the premise is worse than stated: the mask is not sent to the provider at all (`src/lib/prompts.ts:448-455`).
2. **"Mask-guided" is not what protects our architecture today.** Because no mask reaches the model, outside-region stability today comes from the model itself (Qwen: mean drift 0.000, `bake-off/drift-results.md`) — *not* from mask semantics. Any candidate must therefore be judged on drift measured with our own harness, not on "it takes a mask".
3. **Neither paper contains the comparator the issue asks about.** "FLUX" appears 0 times in the full HTML text of both papers; `qwen-image-2.1-pro` appears in neither. Every cross-model statement in §5 therefore rests on *our* bake-off numbers, and the papers' own rankings are between academic baselines only.
4. **Latency comparability.** ER-Chord's 0.37 s is on an **unnamed** GPU; PreciseEdit's 0.42 s is on a 3090. Our incumbents are 17–38 s on a *hosted* API including queue + network. The comparison is directionally decisive but not like-for-like, and no self-hosted GPU rate card exists in this repo, so no $/edit can be stated for either.
5. **Resolution mismatch is structural, not a tuning detail.** Both methods are SD-Turbo-class, 512² systems with square-crop preprocessing (ER-Chord's code proves it: `_CenterSquareCropTransform`, `image_size: 512`). Our editor renders 2048×1536 (`src/lib/alibaba-adapter.ts:221`). Any "same latency, same preservation" claim would be a claim about 512² images, not about the staging canvas.
6. **Our own docs disagree about FLUX Fill's drift.** The bake-off comparison table calls FLUX.1 Fill "⚠️ Mild drift in unedited regions across runs" (`docs/vendor-investigation/1240-bakeoff-oct-2026.md:178`), while the later drift test measures it as **mean RGB delta ~0.006, max 8** — "essentially pixel-perfect in the unedited region" (`bake-off/drift-results.md`), and the same file notes that "earlier claims that FLUX was uniquely stable were artifacts of an inverted-mask bug". The `:178` row is stale; the measured number is the one to use, and it is the *baseline any candidate must beat*.

**Open questions / what we could not verify.**

- Whether either method's one-step edit can respect a **user-painted region** at all — ER-Chord cannot today (no mask input); PreciseEdit's GT-mask rows suggest yes but are oracle ablations (§4.3).
- Whether a 512²→2048×1536 upscaling path (tile/tiled-diffusion, or a higher-res distilled backbone) preserves the *outside-region* property. Not addressed by either paper.
- Furniture realism / lighting consistency for both: **no metric exists in either paper**, so this axis of the issue is currently unanswerable from the literature.
- Whether `sd-turbo`-class outputs are commercially licensable for us under the Stability AI Community License (registration + US $1 M revenue cap, `https://huggingface.co/stabilityai/sd-turbo/raw/main/LICENSE.md` §3).
- The actual GPU-hour cost of running ER-Chord at our output sizes; the repo has no GPU fleet, no GPU rate card, and no CI GPU runner (see `AGENTS.md:77` for the tooling inventory).

---

## 8. First concrete step (ER-Chord spike, research-only)

**Goal:** produce the one number the literature cannot give us — *does a one-step, self-hosted, prompt-driven editor hold the unedited region of a real staging fixture at least as well as the FLUX/Qwen incumbents, once the 512² crop is accounted for?*

**What to run:** the public repo, unmodified, plus our existing bake-off fixtures.

1. **Clone and fetch weights.**
   `git clone https://github.com/Peizeli1/ER-Chord` (MIT) and download `stabilityai/sd-turbo` into a model root with `unet/ scheduler/ text_encoder/ tokenizer/ vae/` (per the repo README §1).
2. **Fixtures — already in the repo, no new assets needed:**
   - `bake-off/befores/vacant-insert__before.jpg` + `bake-off/befores/vacant-insert__mask.png`
   - `bake-off/befores/occupied-replace__before.jpg` + `.../occupied-replace__mask.png`
   - `bake-off/befores/repeat-stability__before.jpg` + `.../repeat-stability__mask.png`
   (2000×1333 each; the pipeline centre-crops to a 512² square, so the resolution gap is itself one of the measured results. The prompt for each case is in `bake-off/vacant-insert.json`, `bake-off/occupied-replace.json`, `bake-off/repeat-stability.json` — e.g. *"Stage this empty living room with a mid-century walnut sofa, a cream linen armchair, a round walnut coffee table, a woven jute rug, and warm brass floor lamp. Keep walls and flooring unchanged."*)
   Optionally add the demo fixture from `docs/DEMO_SCRIPT.md:19` and the mask fixtures referenced by `docs/spikes/223-furnishings-mask.md` / `docs/spikes/190-holistic-mask.md`.
3. **Run:** `python inference.py --model-root <sd-turbo> --image <before.jpg> --source-prompt "<scene>" --target-prompt "<same prompt>" --output results/<case>.png` for each case; also run `--no-cleanup` to separate transport from cleanup (the paper's Table 2 ablation).
4. **Score with the harness we already have** — reuse the methodology of `scripts/bake-off-drift-test.mts` (mean/max RGB delta in the **mask-complement** region, 3 runs, seed 42, `bake-off/drift-results.md`) and add PSNR/SSIM/LPIPS outside the mask against the *same* fixtures. Compare against the incumbent rows in `bake-off/RESULTS.md` (FLUX Fill ~0.006 mean delta, ~17–23 s; Qwen 0.000 mean delta, ~32–38 s).
5. **Report three numbers per case, and only these:** (a) outside-mask drift at 512² **and** after a naive 512→2000 upscale (to separate "the model preserves" from "the crop threw away the room"); (b) wall-clock per edit on the machine used, so we finally have a *named-GPU* latency for ER-Chord; (c) a human/VLM rubric score for furniture realism + lighting consistency — the metric neither paper provides, taken from the same rubric family the removal-evaluation doc proposed (`docs/lenserase-removal-evaluation.md` §9).
6. **Then decide:** if (a) drift ≥ the FLUX incumbent at 512² **and** (c) realism is visibly below the incumbent at 2000 px, **drop** ER-Chord and record the numbers. If (a) and (c) both hold up, the follow-up is a *product* question (GPU line item, `sd-turbo` licence registration, a new adapter arm behind `InferenceClient`) and a **new issue**, not this one.

**Explicitly out of scope for this issue:** no production code change, no provider change, no new dependency. The spike lives under `scripts/` or `bake-off/` (research-only), as the sibling removal evaluation does (§9 of that doc).

**PreciseEdit:** no step to run. Re-open this evaluation when its code lands (watch `github.com` for the authors' release, or the arXiv v2 "Comments" field, which currently says only "9 pages, 7 figures, and 5 tables").

---

## 9. Sources

**Repo (this worktree, cited inline by file:line)**

- `src/lib/inference.ts:1-41, 47-48, 59-65, 72-100, 157-190` — provider abstraction, logical models, retired fal/Replicate adapters.
- `src/lib/alibaba-adapter.ts:108-112` (model id `qwen-image-2.1-pro`), `:204` (image+text content, no mask), `:221` (`size: "2048*1536"`).
- `src/lib/prompts.ts:343-351` (`buildInpaintPrompt`), `:369-389` (legacy fal fill payload; guidance 7.5, 28 steps), `:448-455` (Alibaba payload drops the mask), `:539-554` (provider-neutral payload).
- `src/lib/furnishing-detection.ts:32` (`fal-ai/sam-3-1/image`), `src/lib/mask-dilation.ts:74`, `src/lib/mask-postprocess.ts:48`, `src/lib/mask-coverage.ts:4`, `src/lib/mask-feather.ts`.
- `src/app/api/inpaint/route.ts:26-34` (~30 s synchronous submit), `:35` (`maxDuration = 60`), `:301` (mask received).
- `src/lib/api-quota.ts:39-40` (~$0.04/image baseline), `:54` (`DEFAULT_DAILY_INPAINT_LIMIT = 20`).
- `src/lib/inpaint-quality-gate.ts:40` (advisory, prompt-text only), `src/lib/inpaint-submit.ts:375-416`.
- `docs/DEMO_SCRIPT.md:19` (Hartwell fixture), `:23-24` (~35 s measured, ≤90 s live result).
- `docs/vendor-investigation/1240-bakeoff-oct-2026.md:66-68` (FLUX mask semantics), `:69-70` (queue latency), `:71` (price $0.035/MP, ~$0.11 at 3.1 MP), `:178` (comparison table row: FLUX Fill ~$0.11, ~10–15 s, mild repeat drift), `:206-212` (FLUX.1 Fill as documented fallback).
- `docs/vendor-investigation/235-gpt-image-vs-nano-banana-vs-fal.md:71` ($0.05/MP).
- `docs/lenserase-removal-evaluation.md` — sibling evaluation (#1445); house style, evidence rules, and the "no GPU rate card in this repo" finding.
- `bake-off/RESULTS.md` (run 2026-10-12: measured latency/cost per slot), `bake-off/drift-results.md` (outside-mask drift per slot), `bake-off/befores/*` (before/mask fixtures), `bake-off/*.json` (per-case prompts).
- `scripts/bake-off-image-apis.mts`, `scripts/bake-off-drift-test.mts`, `scripts/bake-off-mask-invert.mts`, `scripts/bake-off-slots.json` — the existing research harness.
- `AGENTS.md:77` — tooling inventory (no GPU runner, no self-hosted inference service).

**External (fetched 2026-10-23)**

| Source | URL | Status |
|---|---|---|
| ER-Chord abstract | `https://arxiv.org/abs/2610.29248` | HTTP 200 — title, submitted 2026-10-21, cs.CV, licence **CC BY 4.0**, project page → `github.com/Peizeli1/ER-Chord` |
| ER-Chord full text (HTML render) | `https://arxiv.org/html/2610.29248v1` | HTTP 200 — §3 mechanism, §4.1 protocol, Table 1, Table 3 (TEdBench), Table 4 (cross-backbone), §4.3 ablations/efficiency, App. B.2 (timing protocol), App. A.2/B.1 (bisection) |
| ER-Chord code | `https://github.com/Peizeli1/ER-Chord` | HTTP 200 — MIT `LICENSE`, `README.md`, `inference.py`, `er_chord.py`, `pipeline_er_chord.py`, `run_pie_bench.py`, `run_tedbench.py`, `summarize_diagnostics.py`, `configs/er_chord.yaml`, `requirement.txt`; created 2026-10-21, pushed 2026-10-21, 2 stars, 31 KB |
| PreciseEdit abstract | `https://arxiv.org/abs/2610.23535` | HTTP 200 — title, submitted 2026-10-16, cs.CV, licence **CC BY 4.0**, **no project-page link** |
| PreciseEdit full text (HTML render) | `https://arxiv.org/html/2610.23535v1` | HTTP 200 — §2.3, §3.3 (PreciseMask), §4.1 setup (RTX 3090 24 GB, FP32, SD-Turbo), Table 1, Table 2, Table 4, Table 5, Fig. 7 |
| `stabilityai/sd-turbo` licence | `https://huggingface.co/stabilityai/sd-turbo/raw/main/LICENSE.md` | HTTP 200 — Stability AI Community License, §3 commercial terms (registration; US $1 M annual-revenue cap) |

**Searches run that produced negative results (stated so they are not re-run):** `grep -i flux` over the text render of both papers → **0 hits**; `grep -i qwen` → **0 hits** in both. No hosted API, no weights release, and no pricing is published for either method by its authors.
