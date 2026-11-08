# ECT (arXiv:2610.30827) evaluation for staging-studio's fill-style edits

**Issue:** [#1480](https://github.com/anchapin/staging-studio/issues/1480) — Evaluate "One Evaluation Is Enough: Inversion-Free Image Editing with Trajectory Correction" (arXiv:2610.30827) for staging-studio and record an adopt-or-skip call.
**Date:** 2026-10-28
**Status:** Analysis only — **no code, config or workflow changes land from this issue.**
**House style:** follows `docs/one-step-editing-evaluation.md` (#1444), `docs/lenserase-removal-evaluation.md` (#1445), `docs/1446-abacus-dcr-sam-qk-edit-evaluation.md`.

---

## 0. TL;DR — verdict: **SKIP** (with a narrow monitor condition)

- **What the paper is.** Endpoint-Calibrated Transport (**ECT**), a *training-free*, *closed-form*, **inversion-free** text-guided image editor that evaluates the source and target text conditions at **one shared noisy state** (one temporal support), packs them into **one denoiser batch** (two condition-time branches), and applies **one latent update** — no inversion, no trajectory integration, no second temporal observation, no iterative optimisation (paper Abstract; §3.2–§3.4, Eqs. 4–23). Its two stages are (a) a schedule-based *angular transport* that integrates the frozen local tangent over the analytically known remaining VP angle (Eq. 12, Proposition 1: ‖a*ₜ − âₜ‖₂ ≤ Lθₜ²/2), and (b) a *proximal endpoint correction* that shrinks the transport along the same axis using the clean-endpoint displacement from the *same* query (Eqs. 14–19).
- **Paper-reported headline numbers.** On PIE-Bench with SD-Turbo, ECT improves background-preservation PSNR 22.63 → **23.74 dB** and judged scores vs the matched two-temporal-support baseline ChordEdit, with per-image editing time 0.265 s → **0.212 s (−20.0 %)** and peak reserved VRAM 7 498 → **7 480 MiB** (paper Table 1). On SNR-Bench the same comparison gives 0.305 s → **0.257 s (−15.7 %)** (paper Table 2). All efficiency numbers were measured on an **NVIDIA H20 GPU** (paper Appendix E). The paper publishes **no price/cost figures** and **no code release**.
- **Why it does not apply to our fill-style edits (three independent blockers, any one of which is fatal):**
  1. **No spatial constraint.** ECT is a *global* text-guided editor: the update acts on the whole latent and the paper explicitly states the derivation "does not yet cover … **spatially adaptive constraints**" (paper §5, Limitations). Our edits are **mask-locked region replacements** whose contract is that the unedited region is pixel-stable — our own measured baselines are mean out-of-mask RGB delta **~0.006** (fal FLUX.1 Fill incumbent) and **0.000** (current provider) (`bake-off/drift-results.md`). ECT's own preservation numbers are 19–24 dB PSNR *outside the benchmark's edit mask*, i.e. it is explicitly a *re-render*, not a *fill*.
  2. **No usable backbone.** ECT "can be directly applied to pretrained epsilon-prediction **VP one-step** generators" (paper Abstract) and is demonstrated only on **SD-Turbo** and **SwiftBrush-v2** (paper §4.1). It requires **white-box access to the denoiser** — one ε-evaluation at a chosen noise level, a chosen t, and the VP schedule. Our provider is a **hosted multimodal-conversation API** (`qwen-image-2.1-pro` via Alibaba DashScope, `src/lib/alibaba-adapter.ts:106-121, 221`); the provider exposes no ε-prediction, no noise-level control, and no latent access.
  3. **There is no inversion to remove.** The premise "inversion-free ⇒ cheaper" saves us **nothing**: our path never did inversion. A fill edit is one submit + status polling (`src/lib/inpaint-submit.ts:375-416`, `src/app/api/inpaint/route.ts:35`). There is no inversion pass, no ODE integration and no multi-noise-level field averaging in our pipeline to delete.
- **Cost/latency mapping: not mappable.** The paper's saving is expressed **relative to ChordEdit**, an algorithm we do not run, and in **GPU-resident milliseconds on an H20**, whereas our cost is a **per-image API price** (measured in our own bake-off: `$0.04/image` and 32.1–38.0 s per edit for the current provider; `$0.05/MP` and 16.7–22.7 s for the fal FLUX.1 Fill incumbent, `bake-off/RESULTS.md`). Self-hosting SD-Turbo to use ECT would **replace** a per-image API price with a GPU-hour amortisation we cannot compute without hardware, and would additionally break the 2048×1536 output contract. **No saving is claimed here.**
- **Call: SKIP.** Not "adapt" — the method's core deliverable (a global, one-step, inversion-free latent transport) is not a superset of, and cannot be retrofitted into, a mask-locked fill. Revisit only if (i) a mask-constrained ECT extension appears (the authors' own stated future work), **and** (ii) we own a self-hosted one-step VP backbone behind the `InferenceClient` interface, **and** (iii) a GPU is budgeted.
- **What was NOT done (per this issue's hard stops):** no paid API call, no GPU workload, no benchmark run, no product/demo change. Every quality or cost number below is either **quoted from the paper** (with location), **measured by this repo** (with file), or **explicitly labelled an assumption**.

---

## 1. Scope, method and evidence rules

**Issue #1480 asks** for a desk evaluation of arXiv:2610.30827 against staging-studio's current fill-style editing path, on (a) applicability, (b) per-edit cost/latency, (c) quality risk, (d) an explicit adopt/adapt/skip call.

**Evidence rules applied (same as the sibling docs):**

1. Every claim about **this repo** cites a file (and line) in this worktree; every claim about **the paper** cites its arXiv id and the paper's own section/table/appendix and is labelled **paper-reported**.
2. Paper numbers are quoted **with their context** (backbone, benchmark, hardware, table). Where the paper publishes nothing (price, code, input resolution), the cell says **not published** rather than estimating.
3. The paper text was read from the **arXiv HTML render** (`https://arxiv.org/html/2610.30827v1`, fetched **2026-10-28**), plus the abstract page (`https://arxiv.org/abs/2610.30827`, fetched the same day, submitted **22 Oct 2026**, authors Lifan Jiang et al., Zhejiang University / Ant Group / Chongqing University of Posts and Telecommunications). **The full text was reachable** — no second-hand summaries were used, and no claim in this document comes from a source other than that HTML render and this repo.
4. Repo-measured numbers (latency, price, drift) come from our own committed artefacts (`bake-off/RESULTS.md`, `bake-off/drift-results.md`) and outrank any paper's marketing claim.
5. **Nothing was benchmarked.** No paid endpoint was called and no model was executed for this document.

**Limits of this pass.**

- We did **not** run ECT: there is no public implementation (see §2.5) and no GPU on this VM.
- The paper's editing **input resolution is not stated** in the HTML render we read; the benchmarks used are PIE-Bench and SNR-Bench (§4.1). Any resolution-sensitive statement in this document is therefore marked as an assumption, not a paper fact.
- The paper's metric suite (masked PSNR/MSE/LPIPS/SSIM outside a benchmark edit mask, CLIP alignment, an ImgEdit-Judge VLM scorer, and a blinded user study) is **not** our metric suite. Our operative metric for fill edits is **out-of-mask pixel drift** (`scripts/bake-off-drift-test.mts`, thresholds in `bake-off/drift-results.md`), which the paper does not report.

---

## 2. What the method actually is (paper-reported)

### 2.1 Problem statement and core claim

Paper Abstract: *"Real-image editing commonly relies on inversion and iterative sampling, while efficient one-step editors often stabilize a large update by estimating and averaging editing fields at multiple noise levels. We ask a stricter question: is a single temporal field evaluation sufficient for reliable inversion-free editing?"*

The answer is ECT: *"a closed-form, training-free editor requiring only one noise level, two text conditions packed into one denoiser batch, and one latent update. ECT requires no image inversion, trajectory integration, second temporal observation, or iterative optimization, and can be directly applied to pretrained epsilon-prediction VP one-step generators."* (Abstract.)

The paper characterises editors by four counters — *temporal supports*, *condition-time branches*, *batched denoiser calls*, *latent updates* (paper §1). ECT is `(1, 1, 2, 1)`; the matched baseline ChordEdit is `(1, 2, 4, 1)` (paper Appendix E).

### 2.2 The two stages

**Stage 1 — single-evaluation angular transport (§3.2).** A single noisy state is formed from the source image, `z_t = α_t·x_src + σ_t·ε`, `ε ∼ N(0,I)`, `α_t² + σ_t² = 1` (Eq. 4). The source and target conditions are evaluated at that *same* `z_t` and *same* `t` (Eq. 5), giving the conditional residual `R_t(z_t) = ε_φ(z_t,t,c_tar) − ε_φ(z_t,t,c_src)` (Eq. 2). One ε-prediction also yields a clean-endpoint estimate `x̂⁰_c = (z_t − σ_t·ε̂_c)/α_t` and an angular tangent `v̂ᶜ_θ = α_t·ε̂_c − σ_t·x̂⁰_c` (Eq. 9); their difference `g_t = v̂ᶜ_θ − v̂ˢ_θ` (Eq. 10) is the local angular-velocity change from swapping source for target. Because the VP angular horizon `θ_t = atan2(σ_t, α_t)` is known analytically, the ideal action `a*ₜ = ∫_{θt}^{0} g(θ)dθ` can be *approximated* by freezing the tangent: `âₜ = −θ_t·g_t` (Eq. 12). **Proposition 1** bounds the quadrature error: if `g` is L-Lipschitz, `‖a*ₜ − âₜ‖₂ ≤ Lθₜ²/2`; a prediction error `‖g_t − g(θ_t)‖₂ ≤ η` adds `θ_t·η` (Eq. 13). The paper is explicit that this is *"a first-order approximation, not a guarantee"* (§1).

**Stage 2 — proximal endpoint correction (§3.3).** The same query's clean-endpoint displacement `d_t = x̂⁰_e − x̂⁰_s` (Eq. 14) is used as an exposure direction. The action is the projection of the nominal transport onto a half-space `⟨d_t, u⟩ ≤ b_t` (Eq. 15), whose closed-form solution is `u*ₜ = âₜ − ζ·d_t` with `ζ = (⟨d_t,âₜ⟩ − b_t)/‖d_t‖²` (Eqs. 18–19). Appendix B gives the KKT derivation; Appendix C gives a *conditional* risk interpretation, *"rather than a guarantee for arbitrary model errors"*.

**Closed-form editor (§3.4).** Eq. 23: `(x_src, c_src, c_tar) → one t → (ε̂_s, ε̂_e) → closed form → x_edit`, *"with no numerical solver between model prediction and latent update"*. The paper notes the update keeps the source reconstruction residual `x_src − x̂⁰_s` (§3.4), i.e. the output is a **re-render of the whole image from a noised source latent**, not a local paste.

**Defaults (paper §4.1):** `t = 0.75`, `ζ = 0.7`, `λ = 1` (λ = user-facing edit-strength coefficient; §3.4, Appendix J.3). §4.5 / Fig. 7 report `t = 0.75` as the best LPIPS–CLIP trade-off among {0.45, 0.6, 0.75, 0.9} and `ζ = 0.7` over {0.5, 0.7, 0.9}; `λ = 2` buys +0.50 CLIP for −2.690 dB PSNR and +37.636 scaled LPIPS (Table 10, via §4.5).

### 2.3 What it is not (paper's own scope limits)

- **No spatial control.** §5 Limitations: *"The current derivation assumes epsilon-prediction VP one-step backbones and a shared noisy state, and therefore does not yet cover non-VP schedules, velocity-prediction models, or **spatially adaptive constraints**."*
- **No training, no inversion, no solver** — but also **no local edit region**: the edit axis is a single global latent direction (`ECT changes the magnitude along one edit axis… neither operation supplies a new direction`, §3.4).

### 2.4 Reported results (paper-reported, with context)

Backbones (§4.1): **SD-Turbo (SD-T)** and **SwiftBrush-v2 (SB-v2)**. Benchmarks: **PIE-Bench** (Table 1) and **SNR-Bench** (Table 2). Metrics: PSNR/MSE/LPIPS/SSIM computed **after masking the edit region** (i.e. preservation of the *unedited* content), CLIP on the full image, plus an ImgEdit-Judge VLM score (Content/Identity Preservation CP, Visual Quality VQ, Physical/Perceptual Coherence PC) — §4.1, Appendix D/F.

Matched one-step rows (selected; the paper's own highlighted comparisons):

| Benchmark | Backbone | Method | PSNR ↑ (dB) | Time (s/img) | VRAM (MiB) | CPU (core-%) | Mem (MiB) | CP / VQ / PC |
|---|---|---|---|---|---|---|---|---|
| PIE-Bench (Table 1) | SB-v2 | ChordEdit | 22.04 | 0.265 | 7 498 | 357 | 1 298.7 | 3.91 / 4.37 / 4.05 |
| PIE-Bench (Table 1) | SB-v2 | **ECT** | **22.86** | **0.213 (−19.6 %)** | 7 480 | 190 (−46.7 %) | 1 075.9 (−17.2 %) | 4.03 / 4.45 / 4.13 |
| PIE-Bench (Table 1) | SD-T | ChordEdit | 22.63 | 0.265 | 7 498 | 357 | 1 297.1 | 3.95 / 4.37 / 4.00 |
| PIE-Bench (Table 1) | SD-T | **ECT** | **23.74** | **0.212 (−20.0 %)** | 7 480 | 190 (−46.7 %) | 1 076.0 (−17.0 %) | 4.09 / 4.65 / 4.31 |
| SNR-Bench (Table 2) | SB-v2 | ChordEdit | 18.64 | 0.305 | 7 498 | 348 | 1 312.5 | 4.21 / 4.41 / 4.21 |
| SNR-Bench (Table 2) | SB-v2 | **ECT** | **19.61** | **0.254 (−16.7 %)** | 7 480 | 181 (−48.0 %) | 1 037.1 (−21.0 %) | 4.30 / 4.44 / 4.30 |
| SNR-Bench (Table 2) | SD-T | ChordEdit | 17.86 | 0.305 | 7 498 | 332 | 1 316.1 | 4.14 / 4.46 / 4.15 |
| SNR-Bench (Table 2) | SD-T | **ECT** | **19.02** | **0.257 (−15.7 %)** | 7 480 | 192 (−42.1 %) | 1 035.0 (−21.4 %) | 4.30 / 4.48 / 4.30 |

Paper's own summary of the efficiency claim (§4.3): ECT *"reduces synchronized latency by 15.7–20.0 %, time-weighted CPU-process utilization by 42.1–48.0 %, and time-weighted process RSS by 17.0–21.4 %. Peak reserved VRAM changes by only 0.24 % (7,480 versus 7,498 MiB)."* The paper also states the saving is **not** a 2× latency win: *"VAE encoding/decoding and other shared work remain after reducing the branches. Two instead of four conditional branches therefore need not halve the total latency."* (Appendix E also notes resource values are only meaningful under matched hardware, precision, resolution, batch construction and software stack, and *"should not be interpreted as hardware-independent model properties."*)

**Hardware (Appendix E):** *"All reported efficiency measurements use an NVIDIA H20 GPU."* The measurement window is the editing pipeline call with a CUDA synchronisation, and **excludes** source loading, tensor-to-image conversion, output writing, logging and metric evaluation.

**User study (§4.4):** blinded PIE-Bench study vs TurboEdit / SwiftEdit / ChordEdit; ECT first-place shares **38.6 %** (text alignment), **33.8 %** (structure preservation), **34.0 %** (aesthetics), exceeding runners-up by 8.2 / 4.6 / 5.3 points. The paper itself notes *"These descriptive differences alone do not establish statistical significance."*

**Ablations (§4.5, Table 3).** Removing the transport stage costs PSNR (SB-v2 22.7 → 22.9; SD-T 22.4 → 23.7). An *extra* NFE (two-step) changes SD-T PSNR 26.0 → 23.7 while improving judged VQ/PC — i.e. the single-evaluation setting is a *trade*, not a free win.

### 2.5 Reproducibility status

- **No code release.** The paper contains no project page, repository or code link; the only GitHub URLs in the HTML render are the arXiv HTML tooling. The Reproducibility Statement promises only *"The supplementary material will include configuration files, benchmark preprocessing, per-sample outputs, and commands for both backbones."* → **there is no public implementation to spike.**
- **No price.** The paper publishes no price, cost-per-image or GPU-hour figure (grep for price/cost-per-image/USD over the render returns nothing).
- **Backbone licences/weights** would additionally be needed for any self-hosted trial (SD-Turbo, SwiftBrush-v2); not evaluated here because no run is possible.

---

## 3. What our pipeline does today (repo facts)

### 3.1 Correction to the issue premise — `src/lib/fal.ts` and FLUX.1 Fill are **not** the current path

The brief (and possibly the issue text) refers to "our current fill-style edits via `src/lib/fal.ts`, FLUX.1 Fill". **In this worktree that is stale.** Reporting it rather than guessing:

- `src/lib/fal.ts` **was deleted** in commit `1a7ed1d` *"Migrate inpaint from fal.ai to Alibaba Cloud DashScope (issue #1240) (#1242)"* (2026-10-12). The module no longer exists on disk (only `src/lib/fal-spend-guard.ts` remains, guarding SAM spend).
- The only wired inpaint provider is **Alibaba Cloud DashScope**, model `qwen-image-2.1-pro` by default (`src/lib/inference.ts:1-11, 60`; `src/lib/alibaba-adapter.ts:106-121`). Setting `INFERENCE_PROVIDER=fal|replicate` is rejected at configure time with an explicit error (`src/lib/inference.ts:289-330`).
- FLUX.1 Fill survives only as: (a) a **legacy payload builder** still pinned by tests (`buildFalFillPayload`, `src/lib/prompts.ts:369-389`, model id `fal-ai/flux-lora-fill` at `src/lib/prompts.ts:60`), (b) the documented **continuity fallback** (`docs/vendor-investigation/1240-bakeoff-oct-2026.md:206-211`), and (c) the **incumbent arm of our own bake-off** (`bake-off/RESULTS.md`).
- The mask is **not on the wire** for the current provider: `AlibabaFillPayload` carries only `image_url` + `prompt` (`src/lib/prompts.ts:401-455`), and the request body sets `size: "2048*1536"` (`src/lib/alibaba-adapter.ts:221`).

**Consequence for this evaluation:** whatever the verdict, the "current fill-style edit" is *a hosted, instruction-mode, 2048×1536 image API call*, not a self-hosted mask-fill pipeline. Two of the three blockers in §4 hold a fortiori.

### 3.2 The call chain (what one edit actually costs us)

```
client mask + directives  (src/components/edit-room/MaskLayer.tsx:24,125; src/components/canvas/use-inpaint-runs.ts:322)
  → POST /api/inpaint                    src/app/api/inpaint/route.ts:35   (maxDuration 60)
  → submitInpaintToActiveProvider()      src/lib/inpaint-submit.ts:375-416
  → buildInpaintPrompt(aesthetic, dirs)  src/lib/prompts.ts:343-351
  → buildInpaintPayloadForActiveProvider()
  → provider adapter                     src/lib/alibaba-adapter.ts (only wired provider)
  → status polling / result              src/lib/inpaint-status.ts, src/lib/inpaint-output.ts
```

**There is no inversion pass.** No DDIM inversion, no trajectory integration, no multi-noise-level averaging, no iterative optimisation anywhere in this chain — the edit is one provider submit plus polling. The only client-side "pre-pass" is mask *feathering* in the browser (`src/lib/mask-feather.ts`) and mask dilation/erosion/cleaning (`src/lib/mask-dilation.ts`, `src/lib/mask-erosion.ts`, `src/lib/mask-postprocess.ts`) — all mask *geometry* work, none of it an inversion.

So the paper's headline saving ("no inversion, no second temporal observation") is, for us, **saving a cost we do not pay**. The paper's actual measured delta is against **ChordEdit**, a two-temporal-support algorithm we also do not run.

### 3.3 Our measured cost/latency and preservation baselines (repo-measured)

From `bake-off/RESULTS.md` (run 2026-10-12, `bake-off/befores/` fixtures, three cases):

| Slot | Vendor / mode | vacant-insert | occupied-replace | repeat-stability | Output size | Price |
|---|---|---|---|---|---|---|
| `flux-pro-fill` (incumbent) | fal / **mask-fill** | 16.7 s | 20.6 s | 22.7 s | 1440×928 | $0.05 / megapixel |
| `qwen-image-2-1` (**current provider**) | alibaba / instruction | 38.0 s | 32.1 s | 33.7 s | 2048×1536 | $0.04 / image |
| `z-image-turbo-inpaint` | fal / mask-fill | 8.4 s | 8.4 s | 8.4 s | 2000×1328 | $0.01 / megapixel |

From `bake-off/drift-results.md` (mean RGB delta **outside** the edit mask, our operative architecture-preservation metric):

| Slot | Mean out-of-mask delta | Max | Latency | Cost |
|---|---|---|---|---|
| `flux-pro-fill` (mask-fill incumbent) | **~0.006** | 8 | ~20 s | $0.05/MP |
| `z-image-turbo-inpaint` (mask-fill) | ~0.04–0.11 | 4 | ~8 s | $0.01/MP |
| `qwen-image-2-1` (current provider) | **0.000** | 0 | ~66 s (drift-test run) | $0.0367/MP |

Repo thresholds: the repo's own "no drift" expectation is **mean delta < 2 across RGB** (`scripts/bake-off-drift-test.mts:16`), and the region-level conservation rule lives in `src/lib/edit-conservation.ts`.

---

## 4. Applicability verdict for our fill-style edits

**Verdict: the method does not apply to our fill-style edits as they exist today.** Three independent, individually fatal mismatches:

### 4.1 Blocker A — ECT has no mask / no spatial constraint; our contract is mask-locked

- **Their method (§2.2, §3.4):** one global latent update derived from a global source→target ε-residual. Nothing in the construction consumes a mask, a bounding box, or a per-region constraint. The paper's own limitations paragraph lists **"spatially adaptive constraints"** as not-yet-covered (§5). In the paper's evaluation, masks appear only in the **metrics** (Appendix D: *"Let M ∈ {0,1}^{H×W} be the edit mask (M=1 in the intended edit region)… MSE, PSNR, SSIM, and LPIPS measure background preservation"*), i.e. as a way to *score* a global edit, never as a model input.
- **Our method (`src/lib/`):** the edit region is defined by a user/SAM-drawn mask, cleaned/dilated/feathered client-side (`src/lib/mask-postprocess.ts:48`, `src/lib/mask-dilation.ts:74`, `src/lib/mask-feather.ts`), and shipped as `maskUrl` in the `/api/inpaint` body (`src/app/api/inpaint/route.ts:301`). For the fal FLUX.1 Fill path the mask is a *hard* provider input (`buildFalFillPayload` → `mask_url`, `src/lib/prompts.ts:369-389`), which is precisely why the fal mask-fill slots measure ~0.006 out-of-mask delta while instruction-mode slots drift 28–52 (`bake-off/drift-results.md`).
- **The gap:** ECT's output is a *re-render* of the whole canvas from `z_t = α_t·x_src + σ_t·ε`. Applied to a 2048×1536 room photo, it would regenerate walls, windows, floors and trim — the exact "architecture preservation" failure the repo spends `src/lib/edit-conservation.ts` and the drift harness guarding against. ECT's *own* numbers say the same thing from the other side: **19.02–23.74 dB** background PSNR (Tables 1–2) is a *lossy* preservation regime, not a pixel-locked one.

### 4.2 Blocker B — ECT needs a self-hosted one-step VP ε-backbone; we have a hosted API

- ECT is defined on **pretrained epsilon-prediction VP one-step generators** (Abstract, §5), demonstrated on **SD-Turbo** and **SwiftBrush-v2** (§4.1), and requires **direct denoiser access**: an ε-evaluation at a chosen `t`, plus the VP schedule constants `α_t, σ_t`, `θ_t = atan2(σ_t, α_t)`, and a latent-space VAE round-trip (§3.2, §3.4).
- Our provider exposes **none** of that: `qwen-image-2.1-pro` is reached through DashScope's *multimodal-conversation* endpoint with `image_url` + `prompt` and `parameters.size = "2048*1536"` (`src/lib/alibaba-adapter.ts:169-233`). No ε-prediction, no noise-level control, no latent, no schedule. The `InferenceClient` abstraction (`src/lib/inference.ts:29-40`) is a *request/response* interface for remote endpoints, not a denoiser handle.
- Adopting ECT would therefore mean **standing up our own SD-Turbo/SwiftBrush-v2 inference service** — a GPU procurement + ops project, not an adapter.

### 4.3 Blocker C — there is no inversion in our path, so "inversion-free" saves us nothing

See §3.2. Our edit is a single hosted submit. The paper's efficiency claim is a *within-ECT-family* delta versus ChordEdit (`(1,2,4,1)` → `(1,1,2,1)`, Appendix E), i.e. against a method we do not run and would never run. Adopting ECT would **replace** a `$0.04/image` API price with GPU amortisation, not subtract an inversion cost from anything.

### 4.4 What *would* have to change for ECT to become relevant (hypothetical, not proposed here)

1. A **mask-constrained** ECT (blend the update inside the mask, keep the source latent outside) — the paper does not do this and lists it as future work (§5). A naive post-hoc composite would still leave the *edited region's* identity, lighting and geometry unconstrained by the mask, which is the part users actually see.
2. A **self-hosted one-step VP backbone** behind `InferenceClient`, at our **2048×1536** output contract. The paper publishes **no 2048×1536 numbers** and does not state its editing resolution (§1 limits), so the paper's efficiency numbers do not transfer.
3. Acceptance of a **re-render** preservation regime (≈20–24 dB outside-mask PSNR) in a product whose selling point is that the rest of the room is untouched.

None of these are in scope for staging-studio today, and (2) alone is a capital decision, not a paper-evaluation decision.

---

## 5. Per-edit cost / latency impact — mapping to our pipeline

**Headline: a per-edit saving or cost delta cannot be derived from this paper, and none is claimed.**

| Quantity | Paper (paper-reported) | Our pipeline (repo-measured) | Mapping |
|---|---|---|---|
| Editing latency | **0.212–0.257 s/img** (Tables 1–2), **NVIDIA H20** (Appendix E), window = editing call only | **32.1–38.0 s/edit** (current provider, 2048×1536) and **16.7–22.7 s/edit** (fal FLUX.1 Fill incumbent) — `bake-off/RESULTS.md` | **Not comparable.** Paper = GPU-resident compute on a specific accelerator; ours = remote-API wall clock including queueing, network, provider-side VAE at 2048×1536, and our own polling. The paper's number excludes source loading, tensor→image conversion and output writing (Appendix E). |
| Relative saving | **−15.7 % to −20.0 %** latency vs matched ChordEdit (§4.3) | n/a | **No baseline to save against.** We run neither ChordEdit nor any multi-noise-level field averaging; there is no inversion pass to delete (§3.2). The paper's baseline is an algorithm we do not use. |
| CPU / RAM | **−42.1 % to −48.0 %** CPU, **−17.0 % to −21.4 %** RSS vs ChordEdit | Our provider path spends no local model CPU/RAM | **No local saving.** We are not self-hosting a denoiser; our per-edit cost is an API price, not local compute. |
| VRAM | 7 498 → **7 480 MiB** (**−0.24 %**) vs ChordEdit | n/a (no local GPU) | **No effect.** The paper's own VRAM delta is negligible; nothing to reclaim in a hosted path. |
| Cost per edit | **Not published** (no price or GPU-hour figure in the paper) | **$0.04/image** (current provider), **$0.05/MP** (fal FLUX.1 Fill incumbent), **$0.01/MP** (z-image-turbo-inpaint, mask-fill) | **Cannot be computed.** Adopting ECT would mean replacing a per-image price with an unknown GPU-hour amortisation for a 2048×1536 SD-Turbo/SwiftBrush-v2 service, which requires hardware we do not have. Any dollar figure here would be invented. |
| Output contract | Editing resolution **not stated** in the render we read; benchmarks are PIE-Bench / SNR-Bench | **2048×1536** (`src/lib/alibaba-adapter.ts:221`) | **Unmapped.** No paper figure exists at our output size to extrapolate from. |

**Assumptions explicitly labelled** (these are ours, not the paper's):

- *A1.* If we ever self-host, the paper's 0.212–0.257 s editing time is assumed to be the **denoiser+algebra** portion only at the paper's (unstated) resolution; the VAE encode/decode at 2048×1536 and our HTTP/polling overhead would be added on top and are **not** covered by the paper's number.
- *A2.* Any per-edit cost of a self-hosted ECT service would be `GPU-hour rate × seconds-per-edit`, i.e. an amortisation we cannot fill in without (i) a GPU, (ii) a resolution, (iii) a measured throughput at our resolution, and (iv) a utilisation assumption. **No number is produced.**
- *A3.* We assume the paper's preservation numbers (19–24 dB outside-mask PSNR) would **not** improve at 2048×1536 without a mask constraint, because the mechanism it corrects (a global transport axis) is resolution-independent in kind. **This is an assumption**, flagged as such.

**What a real benchmark would have required (and was NOT run):** a GPU with an SD-Turbo/SwiftBrush-v2 deployment; a mask-constrained implementation (the paper has none) written by us; our own fixtures (`bake-off/befores/`) at 2048×1536; the existing drift harness (`scripts/bake-off-drift-test.mts`) plus judged metrics; and a paid comparison arm on the incumbent (`flux-pro-fill`, `qwen-image-2-1`) — roughly **one bake-off round of paid fal/Alibaba calls** plus a GPU box. Per this issue's hard stops, **none of that was performed**; this is recorded as a finding, not a result.

---

## 6. Quality risk notes (what would regress in our inpainting step)

1. **Architecture preservation — the core risk.** Our fill contract is that everything outside the mask is untouched (measured ~0.006 mean RGB delta for the fal mask-fill incumbent, 0.000 for the current provider — `bake-off/drift-results.md`; repo threshold mean delta < 2, `scripts/bake-off-drift-test.mts:16`). ECT is a global latent re-render whose own outside-mask preservation is 19–24 dB PSNR (Tables 1–2) — orders of magnitude away from "untouched". Walls, window frames, skirting and floor would be regenerated from a noised latent. This is the failure mode `src/lib/edit-conservation.ts` and the region-level conservation checks were built to prevent.
2. **Region identity / lighting continuity.** Even with a post-hoc mask composite, the *inside* of the mask would come from a global generation rather than a masked inpaint, so furniture scale, perspective, contact shadows and wall-plane consistency are unconstrained by any mask-aware loss — the same class of problem our mask dilation/erosion/feathering pipeline (`src/lib/mask-dilation.ts`, `src/lib/mask-erosion.ts`, `src/lib/mask-feather.ts`) was built to manage.
3. **Resolution and backbone mismatch.** Our output contract is 2048×1536; the paper's backbones and (unstated) benchmark resolution are far smaller, and ECT's hyper-parameters (`t = 0.75`, `ζ = 0.7`, `λ = 1`) are tuned for the paper's setting (§4.1, §4.5). Re-tuning at our resolution is an open research question the paper does not address.
4. **Quality-vs-latency trade is not free even inside the paper.** §4.5's extra-NFE ablation shows SD-T PSNR dropping 26.0 → 23.7 when a second evaluation is used, i.e. the single-evaluation constraint buys latency at the cost of preservation/quality in at least one direction. Adopting a *global* version of that trade to a 2048×1536 room photo is a different bet than the paper's 512-ish benchmark images.
5. **User-visible consistency.** Our edits are furniture *replacements* inside a photographed room; users judge them against the surrounding room. A re-rendered room risks a "different room" impression, which is the failure our advisory quality gate (`src/lib/inpaint-quality-gate.ts`) already tries to pre-empt (it flags `architecture_risk` when directives touch walls/flooring/windows outside the mask).
6. **Evaluation-metric mismatch.** The paper's numbers are masked-PSNR/CLIP/VLM-judge scores on global-edit benchmarks; our operative quality metric is out-of-mask pixel drift on our own fixtures. The paper reports **no** drift-style metric, so even if ECT were runnable we would have to re-derive its preservation with `scripts/bake-off-drift-test.mts`. No such run was made.

---

## 7. Recommendation

**SKIP** (i.e. do not adopt, do not adapt, do not spike).

Rationale, in the order of weight:

1. **Category mismatch.** ECT is a global, one-step, inversion-free *re-render* editor for pretrained one-step VP generators; our task is a *mask-locked region replacement* on a hosted API. The paper itself flags spatial constraints as uncovered (§5).
2. **No integration surface.** We have no self-hosted denoiser, no ε-prediction access, no noise-level control; the provider is a request/response image API (`src/lib/inference.ts`, `src/lib/alibaba-adapter.ts`).
3. **No financial upside.** The saving the paper quantifies is relative to ChordEdit; our path has no inversion and no multi-noise-level averaging, so there is nothing to remove, and the paper publishes no price to compare against our `$0.04/image`.
4. **No runnable artefact.** No public code, no checkpoint, no API — nothing to spike even if the above changed.
5. **Quality risk is asymmetric.** The downside (regenerating the room; violating the unedited-region contract our product depends on) is severe, and the upside (sub-second GPU latency we cannot even host) is unreachable.

**Monitor conditions (revisit only if ALL hold — then re-open as a new issue, not this one):**

- The authors publish a **mask-constrained** extension (their own §5 future work: *"extend the formulation to … spatially adaptive constraints"*), ideally with code.
- We operate a **self-hosted one-step VP backbone** behind `InferenceClient` at our 2048×1536 contract (a capital decision, likely tied to a separate vendor-evaluation issue).
- A GPU is budgeted and an **out-of-mask drift** measurement can be run on `bake-off/befores/` with `scripts/bake-off-drift-test.mts` before any quality claim is made.

**If (and only if) those conditions are met, the benchmark would need (all currently absent):**

| Need | Why | Cost class |
|---|---|---|
| GPU box + SD-Turbo / SwiftBrush-v2 weights & licences | the method is only defined on a white-box ε-prediction VP one-step backbone | GPU capex + weights licence check |
| Our own mask-constrained implementation of Eq. 23 | the paper ships none, and its update is global | engineering time |
| Fixture run at 2048×1536 on `bake-off/befores/` | the paper's resolution is unstated; ours is fixed | compute, no vendor spend |
| Paid incumbent arm (`flux-pro-fill` mask-fill, `qwen-image-2-1`) | a like-for-like quality/cost row in `bake-off/RESULTS.md` | **paid API calls** — one bake-off round, ~$0.04–$0.05 per image per slot |
| Drift harness run (`scripts/bake-off-drift-test.mts`) | our operative architecture-preservation metric; the paper reports none | none (pure TS + sharp) |
| Human/demo-room review | paper uses a blinded user study (§4.4); our users judge room realism | demo rooms + reviewers |

None of the above was executed for this issue, per its hard stops.

---

## 8. What this issue did **not** do

- ❌ No paid API call (no fal.ai, no Alibaba, no OpenAI, no hosted image model).
- ❌ No GPU workload; this VM has no GPU.
- ❌ No benchmark, A/B, or quality comparison was run — every quality number is quoted from the paper or measured by the repo, never produced by us.
- ❌ No source, config, workflow, demo-flow or product change. This document is the entire deliverable.

---

## 9. Sources

**Paper** (read in full from the arXiv HTML render, fetched 2026-10-28):

- arXiv:2610.30827v1 — *One Evaluation Is Enough: Inversion-Free Image Editing with Trajectory Correction*, Lifan Jiang, Taiyang Chen, Senlin Cheng, Bolei Xu, Xiaobo Li, Can Ye, Dehai Zhao, Deng Cai, Boxi Wu (Zhejiang University / Ant Group / Chongqing Univ. of Posts & Telecommunications), submitted 22 Oct 2026. <https://arxiv.org/abs/2610.30827> · HTML render <https://arxiv.org/html/2610.30827v1>.
- Cited inside this doc: Abstract; §1; §3.2 (Eqs. 4–13, Prop. 1); §3.3 (Eqs. 14–19); §3.4 (Eq. 23); §4.1 (setup, defaults `t=0.75`, `ζ=0.7`, `λ=1`); §4.2 + Table 1 (PIE-Bench) and Table 2 (SNR-Bench); §4.3 (efficiency deltas); §4.4 (user study); §4.5 + Table 3 (ablations); §5 (Conclusion + Limitations); Appendix D (metric definitions, mask semantics); Appendix E (resource accounting, H20 hardware, branch counters); Appendix F (judge protocol); Appendix G (user-study protocol); Appendix J (seeds, extra NFE, λ sweep).

**Repo** (this worktree, base `origin/develop` @ `32d48c75ad76026a382b09666c40eeaeb99b6c96`):

- `src/lib/inference.ts:1-11, 29-40, 60, 289-330` — provider abstraction; fal/replicate retired in #1240; `INFERENCE_PROVIDER=fal|replicate` rejected.
- `src/lib/alibaba-adapter.ts:106-121, 169-233` — only wired provider; `qwen-image-2.1-pro`; request body `size: "2048*1536"`.
- `src/lib/prompts.ts:60, 343-351, 369-389, 401-455` — legacy fal FLUX.1 Fill payload builder (test-pinned) vs the current `image_url`+`prompt` payload.
- `src/lib/inpaint-submit.ts:375-416`, `src/app/api/inpaint/route.ts:35, 301` — submit-and-poll call chain; **no inversion anywhere**.
- `src/lib/mask-postprocess.ts:48`, `src/lib/mask-dilation.ts:74`, `src/lib/mask-erosion.ts`, `src/lib/mask-feather.ts` — mask geometry pre-passes.
- `src/lib/edit-conservation.ts`, `src/lib/inpaint-quality-gate.ts` — our architecture-preservation / risk machinery.
- `scripts/bake-off-drift-test.mts:16, 242-291` — out-of-mask drift methodology and threshold.
- `bake-off/RESULTS.md`, `bake-off/drift-results.md`, `bake-off/befores/` — measured latency, price and drift numbers.
- `docs/one-step-editing-evaluation.md` (#1444), `docs/lenserase-removal-evaluation.md` (#1445), `docs/1446-abacus-dcr-sam-qk-edit-evaluation.md` — house style and prior conclusions on one-step/self-hosted editors.
