# LensErase / SERO / ReState evaluation for the de-clutter step

**Issue:** [#1445](https://github.com/anchapin/staging-studio/issues/1445) — Evaluate LensErase / SERO / ReState for the de-clutter step
**Date:** 2026-10-16
**Status:** Research-only (no code changes in this issue).
**Labels:** `inpainting`, `research`

---

## 0. TL;DR

- **Today there is no de-clutter model.** De-clutter is the *same* provider call as staging: one Alibaba DashScope `qwen-image-2.1-pro` request carrying an image and a text directive; the furniture mask the client computes is **not sent to the model at all** (`src/lib/prompts.ts:448-455`, `src/lib/alibaba-adapter.ts:204`). "Remove the old sofa" is a *prompt sentence*, not a masked edit. The retired `fal-ai/flux-fill` path did send a mask (`src/lib/prompts.ts:369-389`), but that adapter was deleted in #1240.
- **LensErase (arXiv:2610.18072) — REJECT for now (monitor).** Best fit on paper for our axes (mask-based, prompt-free, and its TraceFusion mechanism is explicitly aimed at *outside-the-edit-region fidelity*, our weakest axis), but there is **nothing to run**: the repo README says "Code coming soon", there are no weights, no hosted API, and the base `Lens` checkpoints are documented as "released for research purposes only and is not intended for product or service deployment". Paper license CC BY-NC-SA 4.0. **No latency or cost numbers are published.**
- **SERO (arXiv:2610.24173) — REJECT for now (monitor).** Architecturally the most interesting (single forward pass, semantic prior, 0.321 s/sample on one H200 vs 2.342 s for 50-step SDXL-Inpainting), but the project page says "Code (coming soon)" with an empty link, there are no weights and no API, and the paper license is CC BY-NC-ND 4.0 (non-commercial). Its benchmark tables contain **no FLUX.1-Fill row**, so there is no published apples-to-apples number against our production model.
- **ReState (arXiv:2610.21287) — ADOPT-PARTIALLY (spike it).** It is *training-free*, so unlike the other two we can implement it ourselves without any vendor, licence or weights dependency — and its paper licence (CC BY 4.0) permits commercial use with attribution. Its own table puts FLUX.1-Fill at 15.9 s / masked PSNR 11.04 / SSIM 0.376 / LPIPS 0.405 versus ReState at 0.373 s / 18.75 / 0.498 / 0.194 on the same GPU — i.e. the paper measures the exact gap we care about. But the repo/project-page URLs in the paper both return 404 today, and the technique needs a self-hosted GPU.
- **Splitting the pipeline is *suggested* by the evidence but not yet justified.** Every published number that favours a removal specialist is measured against **FLUX.1-Fill**, which we no longer run; our production model (`qwen-image-2.1-pro`) appears in **no** published table in these three papers. The right next move is therefore a **measurement spike, not a pipeline change** (this issue ships no code).
- **First concrete step:** build a removal-only evaluation harness (masked-region quality, outside-mask pixel fidelity, median latency) over our own de-clutter fixtures, and run it against (a) today's provider with a removal-only directive, and (b) a from-scratch ReState implementation on a self-hosted `SDXL-Turbo`/`SDXL-Lightning` worker, behind the existing `InferenceClient` interface (`src/lib/inference.ts:157-190`) as a new logical model. See §9.

## 1. Scope and method

**Issue:** #1445 — evaluate three dedicated object-removal approaches (LensErase, SERO, ReState) for the de-clutter step, which today uses the same inpainting pipeline as staging.

**What this document is.** A desk-research evaluation, in the same house style as the earlier model-comparison docs in this repo (`docs/vendor-investigation/235-gpt-image-vs-nano-banana-vs-fal.md`, `docs/vendor-investigation/236-ideogram-vs-flux-fill.md`, `docs/vendor-investigation/1240-bakeoff-oct-2026.md`): current state with file citations, per-model scoring on the issue's four axes, a comparison table, a verdict per model, and a concrete first step. **No pipeline code changes are made in this issue.**

**Method / evidence rules applied.**

1. Every claim about *this repo* is cited to a file (and line) that exists in the worktree; every claim about a *paper* is cited to its arXiv id, and where a number comes from the paper's tables the table is named.
2. Only numbers the sources actually state are used. Latency, VRAM and quality numbers from papers are quoted **with their hardware and benchmark context**, because the numbers are meaningless without it. Anything not published is written as **"not published / unverified"** rather than estimated.
3. No pricing, latency or vendor offering is invented. Where a vendor's price is quoted it is quoted from a document in this repo that already cites the vendor's own pricing page (and the citation chain is shown), never from memory.
4. External sources were fetched on **2026-10-17**; every link in §11 was fetched that day and its HTTP status is recorded. Where a link in a paper is dead, that is stated explicitly rather than guessed at.

**Limits of this pass.** The three models were not run. §9 proposes the harness that would produce the missing evidence. The comparison between the candidates is therefore "papers vs papers", and the comparison against *our* production model is largely **absent from the literature** — that absence is itself a finding (§8, §10).

## 2. Current state: what the de-clutter step actually does today

### 2.1 The de-clutter step is the staging call, with a different directive

There is no separate de-clutter code path. The "de-clutter" behaviour is expressed as prompt text appended to the same inpaint request that staging uses:

- **"Restage furnishings" preset** — `src/lib/holistic-preset.ts:36` defines the label, `src/lib/holistic-preset.ts:84-104` (`resolveHolisticPreset`) resolves mask kind `furnishings-detection`, the `architecture-first` directive variant and the holistic negative prompt.
- **Directive wording** — `src/lib/holistic-prompt.ts:103-140` (`buildHolisticDirectives`) produces the "restage / clear away clutter" wording; `src/lib/holistic-prompt.ts:84-95` (`HOLISTIC_NEGATIVE_PROMPT`) re-introduces architecture terms (walls, windows, trim, doors, flooring) so the fill does not hallucinate architecture *inside* the mask.
- **Global Declutter Mode (#559)** — `src/lib/holistic-prompt.ts:59-73` (`buildDeclutterDirective`, intensities 1–5) is appended to the same run by `src/lib/multi-select-batch.ts:665` and `src/lib/multi-select-batch.ts:688`.

So a de-clutter request and a staging request are the *same request* with different strings. There is no removal model, no removal-specific prompt template, and no removal-specific quality gate.

### 2.2 The one call chain

```
client mask + directives
  → POST /api/inpaint                      src/app/api/inpaint/route.ts:35 (maxDuration 60), :301 (maskUrl), :330 (submit)
  → submitInpaintToActiveProvider()        src/lib/inpaint-submit.ts:375-416
  → buildInpaintPrompt(aesthetic, dirs)    src/lib/prompts.ts:343-351
  → buildInpaintPayloadForActiveProvider() src/lib/prompts.ts:539-554
  → provider adapter                       src/lib/alibaba-adapter.ts (only wired provider)
```

- The client posts to `/api/inpaint` from `src/components/canvas/use-inpaint-runs.ts:250`; the mask itself is produced client-side by `src/components/edit-room/MaskLayer.tsx:24` and, for the preset, from SAM 3.1 furniture detection (`src/lib/furnishing-detection.ts:32` `fal-ai/sam-3-1/image`, prompt `"furniture"` at `src/lib/furnishing-detection.ts:42`), then cleaned up by `src/lib/mask-postprocess.ts:48` (`fillHoles`), `src/lib/mask-dilation.ts:74` (`dilateMaskGrid`) and `src/lib/mask-feather.ts` (browser-side feathering, see the note in `src/lib/alibaba-adapter.ts:166-172`).
- `src/app/api/v1/inpaint/route.ts` is a **stub** that charges no quota and returns a "submit via the non-v1 endpoint" message (`src/app/api/v1/inpaint/route.ts:92-99`).

### 2.3 Which model actually runs

| Thing | Value | Where |
|---|---|---|
| Logical inpaint model | `flux-fill` (the only inpaint logical model) | `src/lib/inference.ts:46-50` |
| Wired provider | Alibaba Cloud DashScope | `src/lib/inference.ts:1-41` (module docstring), `src/lib/inference.ts:72-100` (`resolveProvider`) |
| Concrete model id | `qwen-image-2.1-pro` (overridable via `ALIBABA_INPAINT_MODEL`) | `src/lib/alibaba-adapter.ts:108-112`, `.env.example:41` |
| Provider selection | `INFERENCE_PROVIDER=alibaba` | `.env.example:47` |
| fal / Replicate adapters | **retired** (modules deleted; those env values now throw at configure time) | `src/lib/inference.ts:1-41`, `src/lib/inference.ts:59-65` and `src/lib/inference.ts:287-296` |

**The issue's premise ("uses the same FLUX Fill pipeline as staging") is only half true today.** FLUX Fill was the production inpaint model until #1240; the pipeline today runs Alibaba DashScope `qwen-image-2.1-pro`, and the fal/Replicate adapters no longer exist (`src/lib/inference.ts:1-41`). The *legacy* FLUX Fill payload builder is still in the tree and still pinned by tests: guidance default 7.5, `num_inference_steps: 28`, `mask_url` on the wire (`src/lib/prompts.ts:369-389`).

### 2.4 The mask never reaches the model (the key current-state finding)

The client computes a mask and sends it (`src/app/api/inpaint/route.ts:301`), the server puts it into the provider-neutral input (`src/lib/inpaint-submit.ts:381`, `src/lib/inpaint-submit.ts:393`), and then the **Alibaba payload builder drops it**:

```ts
// src/lib/prompts.ts:448-455
export function buildAlibabaFillPayload(input: AlibabaFillPayloadInput): AlibabaFillPayload {
  return { image_url: input.imageUrl, prompt: input.prompt };
}
```

and the DashScope request body carries exactly one image and one text turn (`src/lib/alibaba-adapter.ts:204`: `content: [{ image: imageUrl }, { text: prompt }]`); there is no `mask` field anywhere in `src/lib/alibaba-adapter.ts`.

Consequences that matter for this issue:

1. **"Remove furniture" today is prompt-only.** There is no pixel-level constraint telling the model *which* pixels to remove or *which* to keep. The only enforcement is prompt wording (`src/lib/holistic-prompt.ts:103-140`) plus a negative prompt (`src/lib/holistic-prompt.ts:84-95`).
2. **Outside-mask preservation is not measurable in production**, because there is no mask on the wire: we cannot compute a "changed pixels outside the intended region" metric from the provider response, and the provider is free to restyle the whole frame (the architecture-drift field report quoted in `src/lib/holistic-preset.ts:6-12` and `src/lib/mask-postprocess.ts:1-10` is exactly this failure mode).
3. **Every candidate in this issue is mask-based.** Adopting any of them therefore requires the mask to reach the provider — which today it does not. That is a pipeline prerequisite, not a detail.

### 2.5 Today's latency and cost (repo-stated only)

| Quantity | Value | Source |
|---|---|---|
| Provider submit latency | "synchronous and takes ~30s" | `src/app/api/inpaint/route.ts:26-34` (issue #1262 note) and `src/app/api/inpaint/route.ts:231-233` |
| Demo narration budget | "~35s measured", "≤90s live result" | `docs/DEMO_SCRIPT.md:23`, `docs/DEMO_SCRIPT.md:24` |
| Image cost | "~$0.04/image" for `qwen-image-2.1-pro` | `src/lib/api-quota.ts:39` |
| Daily inpaint cap | 20 units/user/day | `src/lib/api-quota.ts:54` (`DEFAULT_DAILY_INPAINT_LIMIT`) |
| Legacy fal `flux-fill` price | "$0.05 / megapixel" | `docs/vendor-investigation/235-gpt-image-vs-nano-banana-vs-fal.md:71` (that doc cites the fal.ai product page) |
| Legacy fal fill steps / guidance | 28 steps, guidance 7.5 | `src/lib/prompts.ts:377`, `src/lib/prompts.ts:388` |

No measurement of our *own* removal quality exists in the repo: the only pre-flight quality signal is the advisory OpenAI gate (`src/lib/inpaint-quality-gate.ts:1-25`, `src/lib/inpaint-quality-gate.ts:40`, `src/lib/inpaint-quality-gate.ts:98`), which inspects the **prompt text**, not the pixels, and is explicitly failure-tolerant.

### 2.6 What this means for the three candidates

The de-clutter step today is a **single prompt-only generation**. A dedicated removal model would change three things at once: (a) the mask would finally be enforced by the model, (b) the removal step could be separated from the staging step, and (c) latency/cost would be re-based on the new model. The evaluation below is organised around exactly those effects.

## 3. LensErase — arXiv:2610.18072

**What it is.** A general-purpose, **mask-based "erase anything" foundation model** (arXiv:2610.18072, submitted 13 Oct 2026; Chen, Wu, Yang, Zhao, Dong, Zhang, Chen, Wei, Shi, Li, Chen, Lu, Lu, Guo — SJTU / Nankai / USTC / Sydney / PKU / Microsoft). It takes an image plus a selection mask and removes the selected content *and its associated effects* (shadows, reflections), then completes the region. Three technical pieces, all from the abstract and paper:

- **LensErase-100M** — "101.07 million paired source–mask–target examples" (abstract; README table "101.07M paired examples").
- **Mask-Aware RoPE** — a 3D rotary positional encoding that injects mask information into the source-image tokens "without introducing a separate mask token sequence" (abstract; paper §3, "we extend conventional 2D spatial RoPE to a 3D formulation by introducing an additional modality dimension").
- **SFT + RL, then TraceFusion at inference** — "contract-guided, region-aware rewards"; TraceFusion "estimates the effective edit region from the selection mask and source–output residuals, and selectively restores the source image outside this region to improve fidelity" (paper §2).

**Axis 1 — wall/floor completion behind removed furniture.** The paper reports reference-based metrics on six public benchmarks plus its own LensErase-Bench. Selected rows (paper Tables 7 and 41-45; OBER-Test / RORD-Val-343 / RemovalBench):

| Benchmark | Metric | Best baseline | LensErase |
|---|---|---|---|
| OBER-Test | PSNR ↑ / FID ↓ / LPIPS ↓ / SSIM ↑ | ObjectClear 33.05 / 19.16 / 0.0132 / 0.9353 | **34.96 / 16.97 / 0.0073 / 0.9543** |
| RORD-Val-343 | PSNR ↑ / FID ↓ | ObjectClear 26.21 / 25.42 | **28.23 / 20.53** |
| RemovalBench | PSNR ↑ / FID ↓ | OSOR 25.80 / 43.89 | **28.16 / 33.67** |

The benchmark is a **masked-removal** benchmark, not a "restage a room" benchmark, and the baselines are removal specialists (ObjectClear, OSOR, OmniPaint, GeoRemover, SmartEraser) — **FLUX.1-Fill and `qwen-image-2.1-pro` are not in these tables**, so there is no published number for "LensErase vs our production model". The paper's qualitative claim relevant to us is the removal of *associated effects* (shadows/reflections), which is exactly the artefact class a furniture-removal step must handle.

**Axis 2 — outside-mask preservation.** This is LensErase's headline axis and the one that maps most directly onto our weakest axis (§2.4). Its VLM-judge "Preservation" score (0-100, GPT-5.6 Sol judge, weighted 20 % of the Overall score) is **96.35** versus **75.55** for the best baseline OSOR and **80.20** for OmniPaint (paper Table 8). The ablation isolates the mechanism: adding TraceFusion moves Preservation **93.35 → 96.35**, Overall **94.41 → 95.22**, HiFi Removal **81.60 % → 82.80 %**, PSNR **28.70 → 30.82**, LPIPS **0.0816 → 0.0684** (paper Table 9). The VLM rubric LensErase uses — Removal / Inpainting / Preservation / Cleanliness — is also a good template for our own eval harness (§9).

**Axis 3 — latency and cost.** **Not published.** The paper reports no inference time, no VRAM figure, no step count and no throughput for LensErase (checked the full arXiv HTML text on 2026-10-17; there is no GPU/latency paragraph). No cost figure is published either. The base T2I model it adapts, `Lens`, has 4-step / 20-step / 50-step checkpoints listed in the `Lens` README, but **LensErase's own sampling cost is not stated**, so any latency estimate for LensErase would be invented. Marked **unverified**.

**Axis 4 — vendor availability and licence.** As of 2026-10-17:

| Artifact | Status | Evidence |
|---|---|---|
| Hosted API | **none found** | no API or endpoint referenced on the project page or in the paper |
| Weights (HF / other) | **none found** | `https://huggingface.co/microsoft/Lens` requires authentication (gated); no LensErase weights repository linked from the README or project page |
| Code | **"Code coming soon"** | `github.com/LensFamily/LensErase` README badge *"Code Coming Soon"* and *"**Code coming soon.** If you like LensErase, please consider starring this repository."*; repo has **no releases**; repo licence field is MIT (code, once released) |
| Base model licences | `Lens` README: "The model is released for **research purposes only and is not intended for product or service deployment**"; code under MIT | `github.com/LensFamily/Lens` README |
| Paper licence | **CC BY-NC-SA 4.0** (non-commercial) | arXiv abs page licence field, arXiv:2610.18072 |

**Verdict for LensErase — REJECT (now), monitor.** The technique is the best match for our axes (mask-driven, prompt-free, explicitly built to preserve everything outside the edit region), but there is nothing to run, nothing to buy, and the base checkpoint's own terms exclude product deployment. Revisit only when (a) weights are published under terms that permit commercial use, and (b) a latency/VRAM figure is published.

## 4. SERO — arXiv:2610.24173

**What it is.** A **semantic-prediction framework for single-step object removal** (arXiv:2610.24173, submitted 16 Oct 2026; Siraj, Javanmardi, Jaiswal, Stricker, Pagani — RPTU Kaiserslautern-Landau + DFKI; SIGGRAPH European Conference on Visual Media Production 2026). The model "predicts a hidden-region semantic prior in embedding space, which guides a latent bridge-matching generator toward plausible scene completion by providing both where to edit and what structure is likely to exist behind the removed object" (abstract). The project page's pipeline description adds an operational detail that matters for us: "given a text prompt and input image, a **segmentation model generates the removal mask**, after which the semantic-prior-conditioned SERO model predicts the clean output in a single forward pass" (project page, Pipeline Overview). The prior is produced by a frozen context encoder + predictor over visible background patches, mapped by a trainable decoder adapter into a dense latent prior that is concatenated with the bridge latent and the mask before the denoising U-Net.

**Axis 1 — wall/floor completion behind removed furniture.** SERO is evaluated on **RORD** and **OBER** — the same two paired benchmarks ReState uses. Headline numbers (paper Table 9):

| Benchmark | Metric | Best baseline | SERO |
|---|---|---|---|
| RORD-Val | FID ↓ / localFID ↓ / fMSE ↓ / PSNR_FG ↑ | GeoRemover 27.77 / 42.28 / 792.00 / 21.18 | **26.92 / 36.18 / 729.24 / 21.13** |
| OBER-Test | FID ↓ / localFID ↓ / fMSE ↓ / PSNR_FG ↑ | LBM 29.13 / 54.20 / 477.60 / 23.75 | 24.39 / 49.67 / 460.58 / **23.93** |

Note the SERO authors' own framing: "SERO achieves the best FID of 26.92 with a single denoising step, whereas competing methods require 20–100 steps" (paper §Efficiency). The comparison set is again removal specialists; **FLUX.1-Fill is not a baseline in SERO's tables**, so SERO-vs-our-provider is **not published**. Also note the metrics are *foreground/removed-region* metrics (`PSNR_FG`, `fMSE`, `localFID`); a "wall and floor behind the sofa looks right" judgement is only partially captured by them.

**Axis 2 — outside-mask preservation.** The paper's objective statement says the target is an edit whose "unmasked content remains faithful to the [source]" (§3.1), and the pipeline copies context features rather than regenerating them. **However, SERO publishes no quantitative outside-mask / background-fidelity metric** — Table 9 reports FID, localFID, fMSE, PSNR_FG, LPIPS and CLIP, all foreground/whole-image distribution measures. So the axis is **partially unverified**: the claim is qualitative in the paper, not quantified.

**Axis 3 — latency and cost.** This is SERO's strongest published axis (paper Table 16, all on a single NVIDIA H200):

| Method | Steps | Median (s) | Slowdown | Trainable (B) |
|---|---|---|---|---|
| **SERO (ours)** | 1 | **0.321** | 1.0× | 2.43 |
| LBM (ICCV'25) | 4 | 0.530 | 1.7× | 2.43 |
| ObjectClear (CVPR'26) | 20 | 1.442 | 4.5× | 3.79 |
| SDXL-Inpainting | 50 | 2.342 | 7.3× | 3.47 |
| PowerPaint v2 | 45 | 6.549 | 20.4× | 2.08 |
| GeoRemover (NeurIPS'25) | 50+50 | 26.685 | 83.1× | 10.68 |

"Under this setup, SERO runs in 0.321 s per sample, making it 4.5× faster than ObjectClear and 83.1× faster than GeoRemover" (paper §Efficiency). **Cost is not published** (self-hosted GPU; no pricing, no vendor rate). Note that **SDXL-Inpainting at 2.342 s / 50 steps is the closest published analogue of a hosted fill model**, and even that is measured on an H200, not comparable to our ~30 s end-to-end Alibaba call without an apples-to-apples measurement.

**Axis 4 — vendor availability and licence.** As of 2026-10-17:

| Artifact | Status | Evidence |
|---|---|---|
| Hosted API | **none found** | no API referenced on the project page or in the paper |
| Weights | **none found** | no model repository linked from the project page |
| Code | **"Code (coming soon)"** — the anchor's `href` is literally `#` | `https://dfki-av.github.io/SERO/` (link list: "Paper" → arXiv PDF, "Code (coming soon)" → `#`) |
| Paper licence | **CC BY-NC-ND 4.0** (non-commercial, no derivatives) | arXiv abs page licence field, arXiv:2610.24173 |
| Website template licence | CC BY-SA 4.0 — applies to the *website template only*, not to the method | `https://dfki-av.github.io/SERO/` footer |

**Verdict for SERO — REJECT (now), monitor.** Its single-step design is the right shape for a low-latency de-clutter step, and it is *architecturally compatible* with our pipeline (it consumes a mask, and we already produce masks from SAM 3.1 — `src/lib/furnishing-detection.ts:32`). But there are no artifacts, no API, and the paper's licence is non-commercial, so even a re-implementation would have to be checked against it (unlike ReState). Revisit if the code and weights ship with commercial terms.

## 5. ReState — arXiv:2610.21287

**What it is.** A **training-free, inference-time correction for few-step distilled diffusion models** (arXiv:2610.21287, submitted 15 Oct 2026; Lee, Jo, Kim, Lee, Kim). It attacks the problem that "training-free object removal commonly redirects self-attention away from the target region, but on few-step distilled diffusion models this often leaves object-shaped residuals" (abstract). Its diagnosis is a temporal mismatch: a structured prediction forms inside the mask at the *first* forward, the short trajectory offers few chances to revise it, and attention rerouting acts mainly in later steps. The fix: "corrects the masked clean prediction toward background evidence retrieved from the input using a noise-level-aware weight that vanishes at the final forward", while "retains object-excluding attention as a complementary constraint and adds **no denoiser evaluations**" (abstract).

Practical significance for us: **there are no weights to obtain and no vendor to buy.** It is a modification to the sampling procedure of a distilled backbone (SDXL-Turbo, SD-Turbo, SDXL-Lightning, Hyper-SDXL), so it can be implemented by us.

**Axis 1 — wall/floor completion behind removed furniture.** ReState's main table reports masked-region PSNR / SSIM / LPIPS against the paired object-free background on OBER-Test (163 GT-paired images) and RORD (343 GT-paired images), with **latency and VRAM measured on a single A100 80GB for every row** (paper Table 36, and the table's caption text):

| Method | OBER PSNR ↑ | OBER SSIM ↑ | OBER LPIPS ↓ | RORD PSNR ↑ | Latency (s) | VRAM |
|---|---|---|---|---|---|---|
| **FLUX.1-Fill** | 11.04 | 0.376 | 0.405 | 12.33 | **15.9** | 33.8 GB |
| SDXL-Inpainting | 11.65 | 0.365 | 0.391 | 10.57 | 3.75 | 9.0 GB |
| SDXL-Turbo (4 steps) | 9.86 | 0.133 | 0.435 | 7.55 | 0.247 | 7.1 GB |
| **ReState (ours)** | **18.75** | **0.498** | **0.194** | **17.21** | **0.373** | 7.1 GB |

So on the *same* GPU and the *same* paired benchmark, the removal-specialist treatment beats FLUX.1-Fill by **+7.71 dB masked PSNR** and is **~43× faster** (derived: 15.9 s ÷ 0.373 s — the two inputs are the paper's own numbers; the paper itself states the 6.7× figure against a *different* reference, the 50-step SDXL+DesignEdit run, whose latency it gives as 2.50 s in paper Table 13). The paper also states "ReState achieves the best masked PSNR, SSIM, and LPIPS among training-free methods, improving PSNR by 3.17 dB on average over the strongest baseline" and that on OBER-Test "it also outperforms the 50-step attention-forcing reference on all three metrics at 6.7× lower latency" (abstract).

**Caveat that must travel with this number:** these are **masked-region** metrics against a ground-truth object-free background. Our de-clutter step has no such ground truth (we do not have the empty room), and our task is not "reproduce the hidden background" but "remove the furniture *and* stage the room" — a completion-quality judgement the metric does not capture.

**Axis 2 — outside-mask preservation.** ReState's correction is applied **only inside the mask** ("corrects the masked clean prediction"; the update is masked), and the paper keeps object-excluding attention as an additional constraint. But the published metric set is masked-region only; **no outside-mask (background fidelity) metric is published** for ReState or for the FLUX.1-Fill baseline row in that table. So the axis is **unverified by published numbers**. Two related caveats the paper itself raises and which we should carry: the method's "clearest method limitation is the quality of the background evidence" (an oracle-background upper bound is discussed), and the removal claims are scoped "to two paired benchmarks and two main backbones" with transfer to SDXL-Lightning and Hyper-SDXL verified in Appendix E.2.

**Axis 3 — latency and cost.** Published, with hardware:

- **4 denoiser evaluations**, median per-image end-to-end **0.373 s on one A100 80GB** versus 0.247 s for the no-intervention SDXL-Turbo baseline — "adding 51 % latency over the no-intervention baseline on SDXL-Turbo (0.373 versus 0.247 s)" (paper §Efficiency / Appendix E).
- Backbone resolutions: "SDXL-Turbo and SD-Turbo operate at 512² and SDXL-Lightning and Hyper-SDXL at 1024²" (Appendix B) — i.e. the 1024² backbones are the ones comparable to our 2048×1536 editor canvas.
- **Cost: not published.** Self-hosted GPU; no price per image is stated anywhere in the paper. Our own GPU-second → dollar conversion is also **unknown** (we have no self-hosted GPU fleet and no rate card in this repo) — so any cost claim here would be invented. The only comparable figure in our repo is the hosted alternative: `~$0.04/image` (`src/lib/api-quota.ts:39`) and a "~30s" synchronous submit (`src/app/api/inpaint/route.ts:26-34`).

**Axis 4 — vendor availability and licence.** As of 2026-10-17:

| Artifact | Status | Evidence |
|---|---|---|
| Hosted API | **none** | none referenced |
| Weights | **none needed for the method** (it is training-free); the *backbones* are public | `stabilityai/sdxl-turbo` (public, not gated), `stabilityai/sdxl-lightning` |
| Official code | **unavailable** — the URL printed in the paper, `github.com/tdrlee/ReState`, returns **HTTP 404**; the project page `tdrlee.github.io/ReState` also returns **HTTP 404** | fetched 2026-10-17 |
| Paper licence | **CC BY 4.0** (commercial use permitted with attribution) | arXiv abs page licence field, arXiv:2610.21287 |
| Backbone licences | `stabilityai/sdxl-turbo`: **Stability AI Community License** — commercial use allowed with registration at `stability.ai/community-license` and a **US $1,000,000 annual-revenue cap** | `https://huggingface.co/stabilityai/sdxl-turbo/blob/main/LICENSE.md` (LICENSE.md §3) |

**Verdict for ReState — ADOPT-PARTIALLY.** It is the only candidate we can act on without a vendor, a licence negotiation or a weights release: implement the training-free intervention ourselves on a public distilled backbone, under CC BY 4.0, and run it behind our existing provider abstraction. What we do **not** adopt is a "vendor offering" — there is none, and the paper's own repo link is dead, so the spike must be our own implementation and must be validated against the paper's published numbers (0.373 s on an A100 80GB; OBER masked PSNR 18.75 / SSIM 0.498 / LPIPS 0.194) as the acceptance target for the re-implementation.

## 6. Comparison table

"Today" = the de-clutter step as it exists in this repo (§2). Paper columns are the papers' own numbers with their own context; where a paper gives no number the cell says so.

| Axis | **Today (repo)** | **LensErase** (arXiv:2610.18072) | **SERO** (arXiv:2610.24173) | **ReState** (arXiv:2610.21287) |
|---|---|---|---|---|
| **Model / form** | Alibaba DashScope `qwen-image-2.1-pro`, single call, **image + text only** (`src/lib/alibaba-adapter.ts:204`, `src/lib/prompts.ts:448-455`) | Mask-based erase-anything foundation model; Mask-Aware RoPE; SFT+RL; TraceFusion at inference | Semantic prior + latent bridge-matching generator; **1 step**; needs a mask (from a segmentation model) | **Training-free** inference-time intervention on a **distilled** backbone (SDXL-Turbo / SD-Turbo / SDXL-Lightning / Hyper-SDXL); no weights of its own |
| **1. Wall/floor completion behind removed furniture** | Not measured in-repo; the only gate is advisory and inspects prompt text, not pixels (`src/lib/inpaint-quality-gate.ts:40`) | Best-in-class on removal benchmarks: OBER-Test PSNR 34.96 vs 33.05 (ObjectClear), FID 16.97 vs 19.16 (Table 7); RORD-Val-343 PSNR 28.23 vs 26.21 (Table 42) | Best FID on RORD-Val 26.92 (vs GeoRemover 27.77), OBER-Test FID 24.39; single denoising step vs competitors' 20–100 (Table 9, §Efficiency) | Masked metrics: OBER PSNR 18.75 / SSIM 0.498 / LPIPS 0.194 vs **FLUX.1-Fill 11.04 / 0.376 / 0.405** on the same A100 80GB (Table 36); +3.17 dB PSNR over strongest baseline (abstract) |
| **2. Outside-mask preservation** | **No mask on the wire** → nothing enforces it; prompt wording only (`src/lib/prompts.ts:448-455`, `src/lib/holistic-prompt.ts:84-95`) | **Strongest published claim of the three**: TraceFusion restores source pixels outside the effective edit region; Preservation 96.35 vs 75.55 best baseline; +TraceFusion lifts PSNR 28.70→30.82, LPIPS 0.0816→0.0684 (Tables 8, 9) | Claimed qualitatively (unmasked content stays faithful, §3.1); **no published outside-mask metric** | Correction applied inside the mask only + object-excluding attention; **no published outside-mask metric** |
| **3. Latency / cost vs FLUX Fill** | ~30 s per call, hosted (`src/app/api/inpaint/route.ts:26-34`); ~$0.04/image (`src/lib/api-quota.ts:39`); 20 calls/day/user cap (`src/lib/api-quota.ts:54`); legacy fal fill was 28 steps / guidance 7.5 (`src/lib/prompts.ts:388`, `:377`) at $0.05/MP (`docs/vendor-investigation/235-...:71`) | **Not published** — no latency, VRAM, step count or cost figure in the paper | **0.321 s/sample on one H200**, 1 step; 7.3× faster than 50-step SDXL-Inpainting (2.342 s) (Table 16). **Cost not published** (self-host) | **0.373 s median/image on one A100 80GB**, 4 denoiser evaluations, +51 % over the 0.247 s no-intervention baseline; FLUX.1-Fill = 15.9 s / 33.8 GB in the same table; **6.7× lower latency than the 50-step SDXL+DesignEdit reference** (2.50 s). **Cost not published** (self-host; our GPU rate card also unknown) |
| **4. Vendor availability / licence** | Hosted API (Alibaba DashScope), commercial | **Paper + "code coming soon" repo only** (`github.com/LensFamily/LensErase`: "Code coming soon", no releases, no weights, no API). Repo licence MIT (code). Base `Lens` checkpoints: "released for research purposes only and is not intended for product or service deployment". Paper licence **CC BY-NC-SA 4.0** | **Paper + "Code (coming soon)"** link (`href="#"`) on `dfki-av.github.io/SERO`; no weights, no API. Paper licence **CC BY-NC-ND 4.0** (non-commercial) | **No vendor, no official code** (`github.com/tdrlee/ReState` → 404, `tdrlee.github.io/ReState` → 404 on 2026-10-17). But **implementable by us**: training-free, CC BY **4.0**; backbones public (`stabilityai/sdxl-turbo`, Stability AI Community License — commercial allowed with registration, US $1 M revenue cap) |
| **Fits our mask-first architecture?** | n/a — the mask is currently discarded by the provider payload | **Yes** (mask in, no prompt needed) | **Yes** (mask in; uses a segmentation model at inference, we already produce SAM masks) | **Yes** (mask in; distilled backbone) |
| **Published comparison vs our production model (`qwen-image-2.1-pro`)?** | — | **No** | **No** | **No** (its FLUX.1-Fill row is *not* our production model) |

## 7. Verdict per model

| Model | Verdict | Why | What would change the verdict |
|---|---|---|---|
| **LensErase** (arXiv:2610.18072) | **REJECT** (monitor / revisit) | Best conceptual fit for the two axes we are weakest on (mask-enforced removal, outside-region fidelity) and the strongest reported removal quality of the three — but there is **nothing to run**: code "coming soon", no weights, no API; the base checkpoint's terms exclude product deployment; paper licence is non-commercial; and **no latency or cost numbers are published**, so we could not even size it. | Weights + code released with commercial terms, **and** a published latency/VRAM figure we can compare against our ~30 s / $0.04 baseline. |
| **SERO** (arXiv:2610.24173) | **REJECT** (monitor / revisit) | Attractive single-step design and the only published latency we can use for sizing (0.321 s on H200), but code "coming soon" (empty link), no weights, no API, paper licence non-commercial (CC BY-NC-ND), and its benchmark tables contain no FLUX.1-Fill row — so the "is it better than a fill model?" question is unanswered by its own paper. | Code + weights with commercial terms, and a FLUX.1-Fill (or comparable) row in its benchmarks. |
| **ReState** (arXiv:2610.21287) | **ADOPT-PARTIALLY** (spike) | The only candidate we can act on without a vendor, a licence negotiation or a weights release: training-free, CC BY 4.0, backbones already public. It is also the only one whose paper measures the comparator we care about (FLUX.1-Fill: 15.9 s vs 0.373 s; masked PSNR 11.04 vs 18.75 on one A100 80GB). What we adopt is a **spike of our own implementation**, not a product. | The spike must (a) reproduce the paper's numbers on our fixtures, and (b) beat our current provider on the same fixtures, otherwise the technique does not survive contact with our data. Note the official repo/project page are dead, so we re-implement from the paper. |

**Summary of the verdicts:** one *spike* (ReState), two *monitor* items (LensErase, SERO). No vendor switch is recommended — none of the three is available as a product.

## 8. Is splitting the pipeline justified by the evidence?

**Short answer: no — not yet. The evidence is suggestive but points at the wrong comparator, and it does not cover our production model.**

**What the evidence does support.**

1. *A removal-specialist treatment beats a general fill model on the removal task, in the same paper, on the same GPU, on paired ground truth.* ReState's table gives FLUX.1-Fill **11.04** masked PSNR / 0.376 SSIM / 0.405 LPIPS at **15.9 s**, against ReState's **18.75 / 0.498 / 0.194** at **0.373 s** (arXiv:2610.21287, Table 36). That is a real, measured gap in the direction we want — and it is the *only* place in these three papers where a fill model and a removal method are compared head-to-head.
2. *Removal-specialist models are the state of the art on removal benchmarks.* LensErase leads OBER/RORD/RemovalBench (Tables 7, 41–45) and SERO leads RORD/OBER FID (Table 9) — both against removal-specialist baselines, not against fill models.
3. *Latency headroom exists.* A sub-second, 4-evaluation removal pass (0.373 s, A100 80GB) would sit far inside our 35 s narration budget (`docs/DEMO_SCRIPT.md:23`) and our "~30 s" current call (`src/app/api/inpaint/route.ts:26-34`) — if the removal stage is what we make faster, not the staging stage.

**What the evidence does not support.**

1. **The comparator is wrong.** Our production model is `qwen-image-2.1-pro` (`src/lib/alibaba-adapter.ts:111`, `.env.example:41`), not FLUX.1-Fill, which was retired in #1240 (`src/lib/inference.ts:1-41`). **None of the three papers contains a `qwen-image-2.1-pro` row.** Every "specialist beats fill" number we have is against a model we no longer run. The inference "our fill is like FLUX.1-Fill, therefore a specialist will beat it by ~7.7 dB" is an **unverified extrapolation** and must not be used to justify a pipeline change.
2. **Two of the three candidates cannot be run at all today** (§7), and the one that can be run (ReState) has **no published outside-mask metric** and **no cost figure** — so the two axes we most need (outside-mask preservation, cost) are exactly the ones the literature leaves open for the only actionable candidate.
3. **A split is not free.** Today de-clutter + staging is **one** billable call (~$0.04/image, `src/lib/api-quota.ts:39`) and one ~30 s round trip. A removal-then-stage split adds a second call unless the removal stage *replaces* the current call in the de-clutter path. If we keep both, we roughly double cost and latency for the de-clutter path — a real cost for an unproven quality gain.
4. **Our own baseline is unmeasured.** The repo has no removal-quality measurement at all: no masked-region metric, no outside-mask metric, no VLM judge on pixels. The only gate is advisory and prompt-based (`src/lib/inpaint-quality-gate.ts:1-25`). "A specialist is better than today" is currently **not a claim this repo can support in either direction.**

**Conclusion.** The literature justifies **spending one spike on measuring**, not on restructuring. Splitting the pipeline becomes justified only if, on *our* fixtures and *our* masks, a removal stage (a) measurably improves wall/floor completion and outside-mask fidelity over the current single-call path, and (b) does so at acceptable latency and cost. Until then the de-clutter step stays a directive on the staging call — with one change we should make regardless (see §9, Step 1): **start sending the mask**, because every candidate in this issue and the current mask-hygiene machinery (`src/lib/mask-postprocess.ts`, `src/lib/mask-dilation.ts`, `src/lib/mask-feather.ts`) assume a mask-aware model.

## 9. First concrete step

**Recommended first move: a measurement spike, not a pipeline change.** Three steps, in order. Steps 1 and 2 are the decision-critical ones; step 3 only happens if they pass.

### Step 1 (no pipeline change): build the removal-only evaluation harness

Today we cannot say whether de-clutter is good, because nothing measures it. Build a **research-only harness** (a script under `bake-off/` or `scripts/`, not wired into the product) that, for a fixed set of de-clutter fixtures — the rooms we already have in the repo (the Hartwell living room used in `docs/DEMO_SCRIPT.md:19-27`, plus the fixtures the spike docs already use — `docs/spikes/223-furnishings-mask.md`, `docs/spikes/190-holistic-mask.md`) — runs three arms on the **same mask**:

| Arm | What it is |
|---|---|
| **A** | Today, verbatim: `POST /api/inpaint` with the current de-clutter directive (`src/lib/holistic-prompt.ts:59-73`) |
| **B** | Today, but **removal-only**: same provider, same mask, directive reduced to "remove the furniture and complete the wall/floor behind it, change nothing else" — this isolates "does our current model do removal well when asked to?" |
| **C** | A removal specialist (step 2) |

Measure, per fixture:

1. **Outside-mask preservation** — pixel-level difference between input and output **outside** the mask (L1/PSNR), plus the share of outside pixels changed beyond a threshold. This is the metric we cannot compute today *and* the one no candidate publishes.
2. **Wall/floor completion behind removed furniture** — a VLM judge on the masked region only, using the rubric LensErase publishes (Removal / Inpainting / Preservation / Cleanliness, 0–4 each, §3 of arXiv:2610.18072). We already have a VLM call pattern to copy: the advisory OpenAI gate at `src/lib/inpaint-quality-gate.ts:98` (`buildInpaintQualityGatePrompt` at `:40`) — but it must be pointed at the *image*, not the prompt, and it must stay failure-tolerant so a judge outage never blocks a run.
3. **Latency and cost** — median wall-clock per image per arm on our own hardware, and dollars per image where an arm is a hosted API (arm A/B: the $0.04/image figure at `src/lib/api-quota.ts:39`); for a self-hosted arm, report **GPU-seconds**, and mark dollars as *unknown* until we have a rate card (do not guess).
4. **Human spot check** — the same 3 questions we ask in review: does the wall behind the sofa read as wall? is the floor continuous? is anything outside the furniture changed?

**Gate for step 2:** if arm B (removal-only on the *current* provider) is already as good as the published specialist numbers, a removal specialist buys us nothing on quality and only latency/cost — re-plan. If arm B is visibly worse (likely, because the provider never receives the mask — §2.4), the mask-aware path is worth building.

### Step 2 (the spike): ReState, implemented by us, behind the existing abstraction

**Why ReState first:** it is the only candidate with (a) no artifact dependency, (b) a permissive licence (CC BY 4.0), and (c) published numbers we can use as an acceptance target for our re-implementation (0.373 s on an A100 80GB; OBER-Test masked PSNR 18.75 / SSIM 0.498 / LPIPS 0.194; +51 % over the 0.247 s no-intervention baseline).

**Interface (no route changes).** `src/lib/inference.ts:157-190` defines the `InferenceClient` surface (`subscribe` / `submit` / `status` / `result`) and `src/lib/inference.ts:46-50` the `LOGICAL_MODEL` map, which currently holds exactly one inpaint model (`flux-fill`). A removal specialist should be added as a **new logical model** (e.g. `removal-specialist`) with a new adapter next to `src/lib/alibaba-adapter.ts`, implementing the same four methods and returning the same `{ imageUrl, width, height }` shape (`src/lib/alibaba-adapter.ts:265-283`). The route then selects it by logical model, not by rewriting the request path — the same shape the provider abstraction was built for (see the module docstring at `src/lib/inference.ts:1-41`).

**Backbone choice:** `SDXL-Turbo` (512², 4 steps) first for the re-implementation sanity check against the paper's 0.247 s / 0.373 s numbers, then `SDXL-Lightning` (1024²) for the resolution that matches our 2048×1536 editor canvas (`src/lib/alibaba-adapter.ts:221`). Note the Stability AI Community License conditions for `stabilityai/sdxl-turbo` (commercial use allowed with registration; US $1 M revenue cap) — legal must sign off before any hosted use.

**Where it runs:** a self-hosted GPU worker is required. We have **no** self-hosted GPU fleet and no GPU rate card in this repo, so the cost side of this spike is an explicit unknown (do not invent a price). The spike's first deliverable should therefore be the *latency* measurement on whatever hardware we can rent, plus the quality numbers — cost follows from a real invoice.

**Acceptance criteria for the spike (proposed targets, our numbers, not published facts):**
- Reproduce the paper's ordering on our fixtures: arm C beats arm B on the masked-region VLM rubric **and** on outside-mask pixel fidelity.
- Median latency per image ≤ 1/3 of the current ~30 s call (`src/app/api/inpaint/route.ts:26-34`) on the same hardware we measure arm A/B on.
- If any of these fail, the technique does not enter the pipeline; record the numbers in a follow-up doc and stop.

### Step 3 (conditional): only if step 2 passes

Only then decide whether the pipeline splits into **removal (specialist) → staging (current provider)**, and price it: two hosted/self-hosted calls per de-clutter run versus one today. Splitting is a **product** decision (cost, latency budget `docs/DEMO_SCRIPT.md:23-24`, quota cap `src/lib/api-quota.ts:54`) and should be taken with numbers, not with a paper table.

### Explicitly not in this issue

No pipeline code changes: no new adapter, no logical model, no route change, no new dependency. This issue delivers the evaluation only.

## 10. Unknowns and what could not be verified

| # | Unknown | Status |
|---|---|---|
| 1 | LensErase inference latency, VRAM, step count, cost | **Not published** (checked full arXiv:2610.18072 HTML on 2026-10-17) |
| 2 | LensErase weights release date / commercial terms | **Unknown** — README says "Code coming soon"; base `Lens` checkpoints are "research purposes only, not intended for product or service deployment" |
| 3 | Whether any hosted API offers LensErase / SERO / ReState | **None found** for any of the three (project pages, papers, and the repos linked from them) |
| 4 | SERO code/weights release; its `href="#"` "Code (coming soon)" link | **Unavailable at time of writing** |
| 5 | ReState official code | **Unavailable** — `github.com/tdrlee/ReState` → HTTP 404, `tdrlee.github.io/ReState` → HTTP 404 (2026-10-17) |
| 6 | Outside-mask (background-fidelity) metrics for SERO and for ReState | **Not published** by either paper |
| 7 | Price per image for SERO / ReState (self-hosted) | **Not published** — and our own GPU rate card does not exist in this repo |
| 8 | Our GPU-hour cost | **Unknown** (no self-hosted GPU fleet in this repo) |
| 9 | How any of the three compares with `qwen-image-2.1-pro` (our production model) | **No published data** — the model appears in none of the three papers' tables |
| 10 | Our own current removal quality (wall/floor completion, outside-mask fidelity) | **Not measured anywhere in this repo** — only the advisory prompt-level gate (`src/lib/inpaint-quality-gate.ts:1-25`) |
| 11 | Whether SERO's inference-time segmentation model is part of its (unreleased) code or an external dependency | **Unknown** (paper/project page describe the step; no code to inspect) |
| 12 | Whether ReState's reported masked metrics survive outside their paired-GT benchmarks (our rooms have no object-free ground truth) | **Unknown** — the paper scopes its claims to OBER-Test and RORD (arXiv:2610.21287 §Limitations) |
| 13 | Whether the de-clutter step should keep using the *staging* provider at all after a removal stage exists | Deliberately **out of scope** here; deferred to step 3 of §9 |

## 11. Sources

All external links were fetched on **2026-10-17**; HTTP statuses below are from that fetch.

**Papers (arXiv)**

- LensErase: <https://arxiv.org/abs/2610.18072> (HTML: <https://arxiv.org/html/2610.18072v1>), submitted 13 Oct 2026, licence CC BY-NC-SA 4.0. Cited: abstract; §2 (TraceFusion), §3 (Mask-Aware RoPE); Tables 7, 8, 9, 41–45.
- SERO: <https://arxiv.org/abs/2610.24173> (HTML: <https://arxiv.org/html/2610.24173v1>), submitted 16 Oct 2026, licence CC BY-NC-ND 4.0. Cited: abstract; §3.1; §Efficiency; Tables 9, 16.
- ReState: <https://arxiv.org/abs/2610.21287> (HTML: <https://arxiv.org/html/2610.21287v1>), submitted 15 Oct 2026, licence CC BY 4.0. Cited: abstract; §Efficiency; Appendix B (backbone resolutions), Appendix E (latency/transfer); Tables 13, 36.

**Project pages / code (availability checks)**

- LensErase project page: <https://lensfamily.github.io/LensErase/> — HTTP 200; links to <https://github.com/LensFamily/LensErase> (HTTP 200; README "Code coming soon", no releases) and <https://github.com/LensFamily/Lens> (HTTP 200; MIT code; checkpoints `microsoft/Lens`, `microsoft/Lens-Turbo`, `microsoft/Lens-Base`; "released for research purposes only and is not intended for product or service deployment"; `https://huggingface.co/microsoft/Lens` returns HTTP 401 without auth → gated).
- SERO project page: <https://dfki-av.github.io/SERO/> — HTTP 200; "Paper" → arXiv PDF; "Code (coming soon)" → `href="#"`; no weights, no API.
- ReState project page: <https://tdrlee.github.io/ReState/> — **HTTP 404**. Code: <https://github.com/tdrlee/ReState> — **HTTP 404**. Both URLs are the ones printed in arXiv:2610.21287.
- Backbone licence: <https://huggingface.co/stabilityai/sdxl-turbo/blob/main/LICENSE.md> — Stability AI Community License Agreement (Last Updated July 5, 2024); §3 Commercial Use License (registration at `https://stability.ai/community-license`; US $1,000,000 revenue cap).

**Repo files cited in this document** (all exist in this worktree)

- `src/lib/inference.ts`, `src/lib/alibaba-adapter.ts`, `src/lib/prompts.ts`, `src/lib/inpaint-submit.ts`, `src/lib/api-quota.ts`, `src/lib/inpaint-quality-gate.ts`
- `src/app/api/inpaint/route.ts`, `src/app/api/v1/inpaint/route.ts`
- `src/components/canvas/use-inpaint-runs.ts`, `src/components/edit-room/MaskLayer.tsx`, `src/components/edit-room/EditRoomStudio.tsx`
- `src/lib/holistic-preset.ts`, `src/lib/holistic-prompt.ts`, `src/lib/holistic-mask.ts`, `src/lib/multi-select-batch.ts`, `src/lib/furnishing-detection.ts`
- `src/lib/mask-postprocess.ts`, `src/lib/mask-dilation.ts`, `src/lib/mask-feather.ts`, `src/lib/mask-coverage.ts`
- `docs/DEMO_SCRIPT.md`, `docs/vendor-investigation/235-gpt-image-vs-nano-banana-vs-fal.md`, `docs/vendor-investigation/236-ideogram-vs-flux-fill.md`, `docs/spikes/190-holistic-mask.md`, `docs/spikes/223-furnishings-mask.md`
- `.env.example`

**Related in-repo evaluations (precedent for this document's structure)**

- `docs/vendor-investigation/235-gpt-image-vs-nano-banana-vs-fal.md` — inpaint provider bakeoff; the source of the legacy fal `flux-fill` $0.05/MP figure used in §2.5.
- `docs/vendor-investigation/236-ideogram-vs-flux-fill.md` — the re-framing of "FLUX Fill vs X" after the Alibaba migration; this document follows the same correction (FLUX Fill is no longer the production comparator).
- `docs/vendor-investigation/1240-bakeoff-oct-2026.md` — October 2026 bake-off round.
