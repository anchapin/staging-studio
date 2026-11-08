# LOCI (arXiv:2610.31950) evaluation for staging-studio's per-region edit-strength control

**Issue:** [#1479](https://github.com/anchapin/staging-studio/issues/1479) — evaluate per-region, continuous-strength control for multi-subject image editing (regional LoRA) against staging-studio's mask-guided inpainting path, and record an adopt / adapt / skip call.
**Date:** 2026-10-28
**Status:** Analysis only — **no code, config, test or workflow changes land from this issue.** The only artefact is this document.
**House style:** follows `docs/1478-editjev-routing-evaluation.md` (#1478), `docs/1480-inversion-free-single-evaluation-evaluation.md` (#1480), `docs/one-step-editing-evaluation.md` (#1444).

---

## 0. TL;DR — verdict: **ADAPT** (adapt the *interaction model*, explicitly **not** LOCI's implementation)

- **What the paper is.** LOCI (Meta AI; arXiv:2610.31950v1, submitted 22 Oct 2026) adds **per-region, continuous, independently chosen edit strength** to an instruction-following editor, by replacing a LoRA's **scalar** coefficient `β` with a **per-token vector** `λ` aligned to a spatial token partition (paper §3.2, Eqs. 4–6), and by routing attention with **Instance-Disentangled Attention** (IDAttn) so a subject's edit cannot leak into a neighbour (§3.3). The adapter is trained once, on a *single* region, to **suppress** its instruction's effect (`α = 1` is the neutral anchor); continuous strengths and multi-region simultaneous control then follow by **rescaling the regional residual at inference** (§3.4–§3.5).
- **Paper-reported headline.** On a 128-scene / 427-pair synthetic multi-subject benchmark (§4.1), LOCI gets the best extrapolation and disentanglement on every metric under protocols A/B (e.g. direction corr. **−0.7081** CLIP / **−0.6953** SigLIP, mean range **0.0894** / **0.0721**, Table 1) and, under protocol C, near-IDAttn coverage (**regional success 0.9099** vs. IDAttn-only **0.9153**, which the paper marks *"not slider-capable"*) with **semantic cross-talk 0.2211** vs. SliderEdit's **0.6456** (Table 2).
- **Why we cannot ADOPT the method.** Three independent blockers, any one fatal:
  1. **No artefact.** The paper publishes **no code, no weights, no checkpoint and no training recipe**; the HTML render contains **no** project page, GitHub link or HF link (verified: the only `github.com` URLs in the full text are `black-forest-labs/flux` and arXiv's own tooling). A HF model search for `regional-lora` / `loci regional lora` returns **0** models. There is nothing to import, vendor or re-point.
  2. **Wrong substrate.** LOCI is a **training-time** method on **FLUX.1-Kontext-dev**: a rank-16 LoRA trained **10,000 steps on 8×H200 GPUs** over 22,482 HQ-Edit-derived examples (paper §4.2 "Implementation details", App. F). Our production editor is a **hosted, mask-less, instruction-mode API call** to Alibaba DashScope `qwen-image-2.1-pro` (`src/lib/inference.ts:294`, `:325`; `src/lib/alibaba-adapter.ts:111`, `.env.example:41`). We have **no GPU**, no adapter-training code and no LoRA-serving path; the paper's mechanism (per-token `λ` inside the transformer's LoRA write) is **not expressible** over a hosted prompt+image endpoint.
  3. **Licence.** The paper is published under **CC BY-NC-SA 4.0** (non-commercial, share-alike) — a constraint we would have to clear before shipping any derived artefact in a commercial product. No commercial licence, and no code, is offered by the authors.
- **Premise corrections to the issue (see §3.5).** Two of the issue's premises are **not what the repo shows**: (a) our editor is **not** mask-guided at the wire — the current provider **ignores the mask** (`src/lib/prompts.ts:416-417`; `bake-off/RESULTS.md:39`), so "staging is mask-guided inpainting" is a **UI-level** truth only; (b) the live studio **cannot currently launch a multi-region run at all** — the only consumer of the batch hook passes `batchSelections: []` (`src/components/edit-room/EditRoomRunCluster.tsx:171`), so the multi-region machinery exists as **library code with no live entry point**.
- **What we *do* adapt.** The *user-facing idea* — "each region gets its own continuous strength dial" — is **implementable today with zero model change** on the per-object batch path: every region is already its own inpaint request with its own mask and prompt, and the request body already carries a per-request `strength` (`src/lib/ai-route-schemas.ts:102`; `src/app/api/inpaint/route.ts:311`). The only thing missing is that the batch runner sends the **same** `guidance.strength` for every step (`src/components/canvas/use-inpaint-runs.ts:404`). So: **ADAPT — thread a per-region strength into the batch plan and the batch panel, keeping the global FineTune slider as the default**, subject to the three gates in §6.3.
- **Call:** **ADAPT**, with the concrete next step in §6.3. No LOCI code, weights or dependency enters the repo from this issue; the adapted artefact is our own UI/schema work, and it is **explicitly not** an implementation of LOCI's regional-LoRA mechanism.

---

## 1. Scope, method and evidence rules

Issue #1479 asks for a **desk evaluation** of arXiv:2610.31950 (LOCI) against staging-studio's editing path, on (a) what per-region strength control means in practice, (b) how well it fits our current mask/strength model, (c) whether code/weights are public, (d) an explicit adopt/adapt/skip call — as a **document only**.

**Evidence rules applied (same as the sibling docs):**

1. Every claim about **this repo** cites a file (and line) in this worktree; every claim about **the paper** cites its arXiv id plus the paper's own section/table and is labelled **paper-reported**.
2. Paper numbers are quoted **with their context** (backbone, benchmark, hardware, table). Where the paper publishes nothing (code, weights, price), the cell says **not published** rather than estimating.
3. Repo-measured numbers (latency, price, drift) come from our own committed artefacts (`bake-off/RESULTS.md`, `bake-off/drift-results.md`) and outrank any issue framing.
4. **Nothing was benchmarked.** No paid endpoint was called, no model was executed, no GPU was touched, no weights were downloaded for this document.

**Paper sources actually reached (2026-10-28).**

| Source | URL | Result |
|---|---|---|
| arXiv HTML render (full text) | `https://arxiv.org/html/2610.31950v1` | **HTTP 200 — full text read**: Abstract, §1–§5, Tables 1–2, Appendices A–G (incl. App. F "Implementation Details"). |
| arXiv abstract page | `https://arxiv.org/abs/2610.31950` | **HTTP 200** — title, authors (Sai Vidyaranya Nuthalapati, Shlok Kumar Mishra; **Meta AI**), `v1 [cs.CV]`, submitted **22 Oct 2026**, licence **CC BY-NC-SA 4.0**. |
| Hugging Face model API | `https://huggingface.co/api/models?search=regional-lora` and `?search=loci%20regional%20lora` | **HTTP 200 — 0 models returned** for both queries (no LOCI weights on the Hub under those names). |

**Limits of this pass (stated, not guessed):**

- We did **not** run LOCI, did not train anything, and could not measure anything about it on our hardware — the repo has no GPU and no adapter-serving path.
- The paper's benchmark is **synthetic**: scenes are generated with **Flux.2** and annotated offline with Grounding-DINO + SAM2 (paper §4.1). It contains **furniture** among its subject categories, but we could not verify any result on **real interior photos**, which is our domain.
- The paper's edit-strength semantics are **not** ours: its `α` is a *residual scale* on a trained adapter (`α = 1` = fully suppressed / neutral, `α = 0` = full edit, negative `α` = extrapolation, sweep `{1.0, 0.8, …, −1.0}`, §3.5 / §4.2), whereas our `strength` is **"how closely the AI follows the text prompt"** on a 0–1 scale (`src/lib/ai-route-schemas.ts:64-72`). Cross-walking the two is an assumption, and we flag it as such (§5, Q3).
- We did not read the papers LOCI builds on (SliderEdit / Zarei et al. 2025; IDAttn / Zaccagnino et al. 2026) beyond LOCI's own description of them; we make no claim about *their* artefact availability.

---

## 2. What the method actually is (paper-reported)

### 2.1 Problem framing (paper §1)

The paper splits editors into two families and argues they are disjoint: **continuous editors** expose a strength slider but reach the subject only through language ("the leftmost dog" — coarse when several same-category instances co-occur), while **region-bound editors** (mask/attention based) apply the edit at a **single fixed strength** with no interpolation. LOCI's claim is that no prior method jointly offers *explicit spatial localisation* + *continuous per-region strength* + *independent simultaneous control of multiple subjects* in one editing process.

### 2.2 Regional LoRA (paper §3.2)

- Baseline LoRA write: `y = Wx + β·ΔWx` (Eq. 3) — the update is **linear in `β`**, so `β = 0` recovers the frozen projection and `β = 1` applies it fully.
- LOCI replaces the scalar with a **per-token vector** `λ ∈ ℝ^{|Z|}` (Eq. 5): each token gets `λ_j = α_n` if it belongs to subject `n`'s instruction block `T_n`, `λ_j = α_{n*(j)}` if the token falls in **any** projected region gate, and `0` for background tokens `L_u, C_u` (which therefore receive **no** adapter residual).
- The gate is a **max-pool from pixel space onto the token grid**: `G_n(j) = max_{p ∈ c(j)} M_n(p)` (Eq. 4) — "one whenever any pixel of subject `n` falls in that block". Each region is given as a **bounding box or a segmentation mask**.
- Overlap rule: when projected gates overlap, a token takes the **largest** coefficient among the active controls (i.e. the least-edited of them).
- Write becomes per-token: `y_j = Wx_j + λ_j·ΔWx_j` (Eq. 6). So `α_n` simultaneously modulates subject `n`'s instruction block, its projected region in the target stream, and the same region in the context stream.

### 2.3 Instance-Disentangled Attention (paper §3.3)

Attention is routed with a bias `Ω ∈ {0, −∞}^{|Z|×|Z|}` inside the softmax (Eq. 7): in the **disentanglement** regime, subject `n`'s three blocks (`T_n`, `L_n`, `C_n`) attend only among themselves and no outside query may read `T_n`; in the **harmonization** regime only the subject rows are widened so lighting/shadow/background evidence can still be read. The paper applies harmonization in outer blocks **0–9** and **47–56** and disentanglement in the middle **10–46**, identically at train and inference time.

### 2.4 Training: single-region suppression (paper §3.4)

One adapter, **one subject at a time**, trained to turn the real instruction's prediction into the **neutral instruction's** prediction ("keep the image the same"), so that at `α = 1` it removes exactly the change the instruction causes. **No edited image is required** — supervision is the frozen editor itself (velocity-level, Eq. 8). The objective is a **masked** MSE over the region's target-stream tokens only (Eq. 9). Crucially, the reference pass uses the **same attention routing** as the adapted pass ("routing-matched suppression") so the adapter is not asked to compensate for a routing difference.

### 2.5 Multi-region inference (paper §3.5)

At inference `N > 1` controls are instantiated on the token partition; all coefficients are assembled into one `λ` (Eq. 5) which modulates the shared adapter at every denoising step. **Controls may have different signs** (suppression vs. extrapolation for different subjects in one trajectory). Because no outside query may read `T_n` under either routing regime, adding subjects does not expose one subject to another subject's text — and the same adapter applies **without retraining** for a different subject count.

### 2.6 Evaluation (paper §4)

- **Benchmark:** 128 multi-subject scenes, **2–7 subjects** each, **427** annotated subject–edit pairs, spanning people, animals, vehicles, furniture and mixed compositions. Scenes are **synthetic** (generated with Flux.2), so the benchmark is disjoint from the HQ-Edit training data and no method is evaluated on images produced by the model it edits. Annotations (boxes + SAM2 masks) are produced **offline**; at inference the annotation is supplied by the user (§4.1).
- **Baselines:** SliderEdit (released Selective Token LoRA checkpoint), SliderEdit++IDAttn, IDAttn only (routing, no learned strength), Regional LoRA without IDAttn, LOCI (paper §4.2).
- **Protocols:** A/B measure strength monotonicity / preservation / disentanglement; C measures joint editing (regional success, worst-region ΔCLIP, cross-talk); D measures two-dimensional control (intended response vs. cross-talk when moving one control).
- **Headline numbers (paper Tables 1–2):**

| Metric (protocol) | SliderEdit | IDAttn only | Regional LoRA w/o IDAttn | **LOCI** |
|---|---|---|---|---|
| Direction corr. CLIP (A) | −0.4907 | — | −0.5829 | **−0.7081** |
| Mean range CLIP (A) | 0.0575 | — | 0.0761 | **0.0894** |
| Regional success (C) | 0.8231 | 0.9153 | 0.7577 | **0.9099** |
| Worst-region ΔCLIP (C) | 0.0045 | 0.0282 | −0.0015 | 0.0251 |
| Intended response (D) | 0.0307 | *not slider-capable* | 0.0393 | **0.0458** |
| Semantic cross-talk ↓ (D) | 0.6456 | — | 0.7146 | **0.2211** |
| LPIPS cross-talk ↓ (D) | 0.6597 | — | 0.9599 | **0.1860** |

- **The paper's own component read:** "routing supplies the spatial isolation; routing-aware training supplies the control" — routing alone gives coverage but **no** continuous control, and the regional adapter alone gives the **worst** cross-talk in the table (worse than unmodified SliderEdit) because the control moves its target without confining the effect (§4.2 "Two-dimensional control").
- **Implementation details (paper §4.2, App. F):** base editor **FLUX.1-Kontext-dev** (frozen), **1024×1024**, **28** denoising steps, guidance **3.5**, seed **0**; rank-**16** LoRA; **10,000** training steps on **8×H200** GPUs; **22,482** training examples derived from HQ-Edit (98,675 decoded, 23,591 after type/pose filtering, then a **3 %**-min-mask-area cut); VAE/T5/CLIP/scheduler frozen; fp32 adapter over a bf16 backbone; gate = max over each **16×16-pixel** token cell (64×64 grid at 1024²) ⇒ each gate dilates by at most one token; per-region `α` applied stream-aware.

---

## 3. Repo-fit analysis

### 3.1 What our editing path actually is today

| Layer | Fact | Citation |
|---|---|---|
| Provider | Only **Alibaba Cloud DashScope** is wired. `INFERENCE_PROVIDER=fal` / `=replicate` were **retired in #1240** and now throw. | `src/lib/inference.ts:294`, `:325`; `src/lib/inference.ts:12-16` |
| Model | `qwen-image-2.1-pro` by default (env-overridable). | `src/lib/alibaba-adapter.ts:111`; `.env.example:41` |
| Wire shape | DashScope multimodal-conversation POST: `input.messages[{image, text}]` + `parameters{ n:1, watermark:false, prompt_extend:true, strength, seed?, size:"2048*1536" }`. | `src/lib/alibaba-adapter.ts:200-222` |
| **Mask** | **The mask never reaches the wire.** The Alibaba payload builder emits only `image_url` + `prompt`; the field is documented as *"Alibaba is instruction-mode; mask_url is ignored by the model"*. | `src/lib/prompts.ts:416-417`, `:448-455`; `bake-off/RESULTS.md:39` ("instruction-mode only (no mask on the wire)") |
| Strength | One **global** `strength` (0–1) per request → `parameters.strength` (default 0.5). | `src/lib/ai-route-schemas.ts:98-103`; `src/app/api/inpaint/route.ts:311`; `src/lib/alibaba-adapter.ts:196`, `:219` |
| Route schema | `inpaintRequestSchema` is **`.strict()`** — unknown keys 400. | `src/lib/ai-route-schemas.ts:88-105` |
| UI | One global slider, "How much can change" (0–100), mapped `clamp(x/100, 0, 1)`. | `src/components/edit-room/FineTune.tsx:65`, `:120-127`; `src/app/(dashboard)/projects/[id]/project-detail-view.tsx:813` |

### 3.2 What our mask model is today

- One run = **one** `maskUrl` + one `promptDirectives` + one `strength` (`src/app/api/inpaint/route.ts:301-311`; `src/components/canvas/use-inpaint-runs.ts:326-341`). The mask is a client-side artefact (feathered pre-upload by the "Blend edges" slider, `src/lib/mask-feather.ts`, referenced at `src/components/edit-room/FineTune.tsx:35-40`) that the current provider discards.
- **Multi-region mask machinery exists in library code:** `BatchSelection` (one region = one `maskDataUrl`, one `conceptLabel`, optional member indices), `BatchPromptMode = "thematic" | "per-object"`, cap `MAX_BATCH_OBJECTS = 5`, region merging by mask proximity, and `buildBatchPlan` (`src/lib/multi-select-batch.ts:66`, `:70-105`, `:107`, `:594-600`, `:645`).
- **Per-region masks are producible:** instance/silhouette masks come from the SAM 3.1 furnishing-detection path and mask preparation helpers (`src/lib/furnishing-detection.ts:31-32`, `src/lib/segment-mask-prepare.ts`).
- **But the multi-region path has no live entry point.** The only consumer of the batch hook is `EditRoomRunCluster`, and it hardcodes `batchSelections: []` / `setBatchSelections: () => {}` (`src/components/edit-room/EditRoomRunCluster.tsx:171-173`); `run-button.tsx:14-18` documents that the batch path is gated behind the single Run button. So **today a user cannot launch a multi-region run from the current studio surface**.

### 3.3 Where per-region strength would land, and what it would actually do

The per-object batch runner is the natural host: it walks the plan's regions **sequentially**, and each step is a **separate** `/api/inpaint` request with **its own** `maskUrl` and `promptDirectives`:

```
src/components/canvas/use-inpaint-runs.ts:377-443  → for each step:
    beginInpaintRun({ maskUrl: step.maskDataUrl,
                      promptDirectives: step.promptDirectives,
                      sourceUrl,                      // previous step's result
                      globalDirectives,
                      strength: guidance.strength,   // ← ONE global value for every step
                      seed: guidance.seed })
```

So the *transport* for per-region strength already exists (`strength` is a **per-request** field, `src/lib/ai-route-schemas.ts:102`); the only thing missing is per-step sourcing, plus a place for the user to set it. Under the current provider this would still be **one prompt-adherence number per whole-canvas regeneration** — because (a) the mask is dropped by the provider, so the "region" is only a *prompt* boundary, and (b) our `strength` means "how closely AI follows the text prompt" (`src/lib/ai-route-schemas.ts:64-72`), not LOCI's *edit magnitude*. **Per-region strength is therefore a UX/parameterisation change today, not a capability change.**

### 3.4 Which multi-subject cases would benefit (paper reasoning mapped to our pipeline)

- **Where LOCI's mechanism would genuinely pay off** (as a *future* provider property): several furniture pieces / zones in one mask set where a single global strength is blunt, overlapping or touching masks where an edit leaks into a neighbour, and "hold this piece, change that piece" requests. In our bake-off terms this is exactly the **cross-region leakage** that the mask-honouring slots exist to control — our own drift work shows instruction-mode slots regenerate far more than the masked area (mean RGB delta **28–34** for seedream-5-flash, **~52** for seedream-5-pro in the mask-complement region, vs. **~0** for the mask-fill slots; `bake-off/drift-results.md:29-32`, `:34-37`).
- **Where our pipeline already handles the same user need differently:** the multi-select batch's **per-object mode** solves "several subjects, several edits" by *sequential runs* (each region gets its own prompt and its own generation), at the cost of **N paid generations** (each ≈ **$0.04/image**, `src/lib/api-quota.ts:37-39`; quota **20 inpaint calls/user/day**, `src/lib/api-quota.ts:54`) and N× latency (our measured instruction slot is **32.1–38.0 s/edit**, `bake-off/RESULTS.md:15`). LOCI's selling point is *one forward pass* with independent per-region strength — i.e. it would replace N runs with 1, which is the cost/latency argument that makes it interesting **once a mask-honouring, region-aware editor exists in our provider set**.

### 3.5 Contradictions with the issue's premise (reported, not guessed)

1. **"Our staging is mask-guided inpainting."** — **Not true at the wire.** The live provider is instruction-mode and **ignores `mask_url`** (`src/lib/prompts.ts:416-417`, `:448-455`; `bake-off/RESULTS.md:39`). Masks are a **client-side** concept today: they gate the UI, feed the quality gate's coverage ratio, and (in the bake-off) they are the thing mask-fill providers honour — but the production editor regenerates the **whole canvas** per run. This is the single biggest mismatch with LOCI, whose entire mechanism is **mask/box-gated writes**.
2. **"Multi-subject rooms (several furniture pieces / zones in one mask set)."** — The **library** supports this (`src/lib/multi-select-batch.ts`), but the **studio UI does not**: the batch hook's only consumer passes an empty selection set (`src/components/edit-room/EditRoomRunCluster.tsx:171`). There is no live "several zones in one mask set" flow to strengthen per-region.
3. **"A single global edit strength is bluntest."** — **Correct, and confirmed.** One `strength` per request (`src/lib/ai-route-schemas.ts:102`), one global slider (`src/components/edit-room/FineTune.tsx:65`), forwarded unchanged to **every** batch step (`src/components/canvas/use-inpaint-runs.ts:404`).
4. **`src/lib/fal.ts` (named in the brief) does not exist.** It was deleted with the fal adapter in #1240; the code that mentions it now does so historically (`src/lib/alibaba-adapter.ts:170-172` — "Mirrors the historical pattern in `src/lib/fal.ts` that this PR deleted"). The current inpainting path is `src/lib/inference.ts` → `src/lib/alibaba-adapter.ts`.

---

## 4. Code / weights availability status

| Artefact | Status | Evidence |
|---|---|---|
| Paper full text | **Available** (arXiv HTML v1) | `https://arxiv.org/html/2610.31950v1` → HTTP 200 |
| Reference implementation | **Not published** — no code link, no repo, no "code available" statement anywhere in the HTML render | Only `github.com` URLs in the full text are `black-forest-labs/flux` and arXiv's own `html_feedback` / `LaTeXML` links |
| LoRA weights / checkpoint | **Not published** — no HF link, no model card, no download URL | HF model API search `regional-lora` → 0 models; `loci regional lora` → 0 models |
| Training data | **Not released**; the recipe is described (HQ-Edit-derived manifest, 22,482 examples) but the manifest/weights are not linked | paper App. F |
| Training / serving cost | 10,000 steps on **8×H200** — a footprint our repo has **no** infrastructure for (no GPU, no adapter-serving path) | paper §4.2, App. F |
| Commercial use | Paper licence **CC BY-NC-SA 4.0** (non-commercial) — no commercial licence offered, and no code offered to relicense | arXiv abstract page licence field |
| Hosted API | **None found** (no vendor endpoint, no "try it" link in the paper) | full-text scan |
| Dependencies' artefacts | LOCI builds on SliderEdit's released Selective Token LoRA checkpoint and on IDAttn (paper §4.2 baselines); we did **not** verify their availability and make no claim about it | paper §4.2 |

**Net:** LOCI is a **method description**, not a shippable component. Nothing can be adopted from it today, and nothing can be *benchmarked* against it on this VM.

---

## 5. Risks and open questions

**Risks (if we pursue the adapted version):**

- **R1 — Meaningless knob risk.** With the current instruction-mode provider, a per-region `strength` changes **prompt adherence for a whole-canvas regeneration**, not the magnitude of an edit *inside* a region. Shipping a per-region slider without a mask-honouring provider would be a UI that promises control it cannot deliver. **Mitigation:** gate the UI on a mask-honouring slot (see §6.3 gate 2).
- **R2 — Cost multiplication.** The per-object batch path is **N sequential paid generations**; per-region dials tempt users to re-run regions individually. At ≈**$0.04/image** and a **20/day** inpaint cap (`src/lib/api-quota.ts:37-39`, `:54`), a 5-region batch is 5 units of quota and ≈5× latency (≈32–38 s each, `bake-off/RESULTS.md:15`).
- **R3 — Cross-region leakage is *not* solved by our approximation.** LOCI's leakage reduction comes from IDAttn routing + routing-matched training (paper §3.3–§3.4, Table 2), i.e. **inside the model**. Our sequential-batch approximation can only bound leakage by *ordering* and by *prompt wording*; the leakage the paper measures (semantic cross-talk 0.6456 → 0.2211) is not something a `strength` field delivers.
- **R4 — Semantic mismatch of the knob.** Our `strength` = prompt adherence (0–1, higher = follow the prompt more); LOCI's `α` = residual scale (1 = neutral/suppressed, 0 = full edit, negative = extrapolation). A per-region slider that inherits our semantics will behave **oppositely** to the paper's figures if users read the paper's numbers. Any UI must label its own semantics, not inherit LOCI's.
- **R5 — Licence/entitlement.** Adopting LOCI's artefact (if it ever ships) under CC BY-NC-SA 4.0 in a commercial product is a legal question, not a technical one.
- **R6 — Bench transfer.** LOCI's numbers are on **Flux.2-generated synthetic scenes** (§4.1); our domain is **real interior photography**. There is **no** published evidence that the effect sizes transfer to our images, and none we could generate here.

**Open questions (unresolved by this pass):**

- **Q1.** Does the DashScope `parameters.strength` knob behave **monotonically** and **locally** under a mask-honouring model? **Unverified** — we did not call any paid endpoint.
- **Q2.** Is `parameters.strength` even honoured by the `qwen-image-2.1-pro` image model, or is it inert for this model id? **Unverified** — the repo treats it as live (`src/lib/alibaba-adapter.ts:196-219`), but no committed bake-off isolates its effect.
- **Q3.** What is the right cross-walk between "prompt adherence" (ours) and "edit magnitude" (LOCI's `α`)? **Unresolved**; §3.5/R4 treats the two as different quantities.
- **Q4.** Would a per-region strength UI even be *reachable* for users if the multi-region batch path stays dormant (`src/components/edit-room/EditRoomRunCluster.tsx:171`)? **Open** — this is a product-sequencing question for the studio surface.
- **Q5.** Is a **hosted** region-aware editor with per-region control likely to appear from any vendor (which would make LOCI's mechanism irrelevant to us)? **Unverified** — outside the evidence we gathered.

---

## 6. Final verdict

### 6.1 Verdict

**ADAPT** — adapt the *interaction model* of LOCI (a per-region, continuous strength dial per region of a multi-region selection), implemented **entirely in our own request/UI layer**. **Do not** adopt LOCI's implementation: there is no code, no weights and no hosted API (§4), its mechanism requires a trained adapter on FLUX.1-Kontext-dev that a hosted DashScope endpoint cannot express (§2.2, §3.1), and its licence is non-commercial (§4).

**What "adapt" means concretely here, and what it explicitly excludes:**

| | Decision |
|---|---|
| Add LOCI as a dependency / vendor its weights | **No** — nothing to vendor; licence is NC (§4). |
| Add a LoRA-training or adapter-serving path to the repo | **No** — 8×H200-scale training, no GPU here (§2.6, §4). |
| Wire a per-region strength into the per-object batch path + batch panel | **Yes** — the transport already exists (`strength` is per-request, `src/lib/ai-route-schemas.ts:102`; each batch step is its own request, `src/components/canvas/use-inpaint-runs.ts:377-443`). |
| Keep the global FineTune slider as the default for every region | **Yes** — backward-compatible; `src/components/edit-room/FineTune.tsx:65`. |
| Change the wire schema / provider / adapter | **No** — per-region strength is carried by the **existing** `strength` field; no new route field, no new provider code. |

### 6.2 Why not ADOPT and why not SKIP

- **Not ADOPT:** no artefact exists to adopt (§4), and the mechanism is not reachable through a hosted instruction-mode API (§3.1, R1). Adopting LOCI would mean standing up FLUX.1-Kontext serving + adapter training — a different product, not this issue.
- **Not SKIP:** the *user need* in the issue is real and confirmed in the repo — one global strength for every region (`src/components/canvas/use-inpaint-runs.ts:404`), one global slider (`src/components/edit-room/FineTune.tsx:65`), and a multi-region batch engine that already issues one request per region (`src/lib/multi-select-batch.ts:594-600`). A per-region dial is a **small, model-free** change on that path, and it is the honest subset of what LOCI demonstrates.

### 6.3 Concrete next step (single next action, in order)

**File a follow-up issue: "Per-region strength for multi-region (batch) inpainting"** — scoped as follows, with **no** change to the wire schema and **no** provider work:

1. **Schema/plan (no provider change).** Extend the batch plan so each region carries an optional `strength` (0–1), defaulting to the global FineTune value; thread it into the existing per-step `beginInpaintRun({ strength })` call site (`src/components/canvas/use-inpaint-runs.ts:404`). Pure-local change in `src/lib/multi-select-batch.ts` + the panel; the route already accepts a per-request `strength` (`src/lib/ai-route-schemas.ts:102`) and the route body already forwards it (`src/app/api/inpaint/route.ts:311`).
2. **Gate 1 — reachability (must land first).** Decide and file the surface question raised by Q4: the multi-region path currently has **no live entry point** in the studio (`src/components/edit-room/EditRoomRunCluster.tsx:171`). Either the follow-up issue re-enables the batch panel in the studio, or the per-region strength work stays behind the existing (dormant) surface. **No UI work before this is settled.**
3. **Gate 2 — does the knob do anything? (operator-run, small paid spend).** Before exposing any per-region dial, run a **small operator-executed** comparison on a **mask-honouring** slot (`z-image-turbo-inpaint`, **$0.01/MP**, `bake-off/RESULTS.md:17`) and on the current instruction slot, sweeping `strength` over {0.0, 0.5, 1.0} for the same region + prompt, measuring: (a) whether the edit magnitude moves monotonically, and (b) the **mask-complement** drift using the existing drift method (`bake-off/drift-results.md`, `scripts/bake-off-drift-test.mts`). If a mask-honouring slot does **not** show monotone, region-local behaviour, **stop** — per-region strength would be a misleading knob (R1) and the correct call flips to SKIP-for-now.
4. **Gate 3 — UI semantics.** Label the per-region dial in **our** terms ("how closely the AI follows *this* region's directive"), never in LOCI's `α` terms (R4); keep the global slider as the default so existing single-region behaviour is byte-identical.

**Monitor conditions for a future ADOPT (revisit only if all hold):** (i) the authors publish code **and** weights under a commercial licence; (ii) a hosted or self-hostable FLUX.1-Kontext + regional-LoRA path becomes operable within our provider policy (`src/lib/inference.ts` currently retires fal/replicate); (iii) we have a GPU/LoRA-serving budget; (iv) a benchmark on **real interior photos** (not Flux.2-synthetic scenes) shows the cross-talk reduction on our imagery.

### 6.4 What this issue does *not* do

- **No pipeline change lands from this issue** — this document is the whole deliverable. No source, config, test or existing doc was modified (`git status --porcelain` shows exactly one new untracked file: this doc).
- **No GPU job, no weight download, no paid image API call** was attempted while producing it. The only network traffic was **reads** of the arXiv abstract/HTML pages and two Hugging Face model-API **search** queries (no downloads).
- **No LOCI code, weights, config or licence obligation enters the repo** from this issue.
