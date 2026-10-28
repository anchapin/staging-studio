# Geometry-consistent defurnishing LoRA (arXiv:2610.34597) — evaluation for staging-studio

**Issue:** [#1477](https://github.com/anchapin/staging-studio/issues/1477) — evaluate a "geometry-consistent defurnishing LoRA" (finetuned prompt-based image editor for room defurnishing) against staging-studio's inpainting path and record an adopt / adapt / skip call.
**Date:** 2026-10-28
**Status:** Analysis only — **no code, config, provider, or workflow change lands from this issue.**
**House style:** follows `docs/1478-editjev-routing-evaluation.md` (#1478), `docs/1480-inversion-free-single-evaluation-evaluation.md` (#1480), `docs/1446-abacus-dcr-sam-qk-edit-evaluation.md` (#1446), `docs/lenserase-removal-evaluation.md` (#1445).

---

## 0. TL;DR — verdict: **SKIP** (do not adopt, do not adapt; monitor conditions in §7)

- **What the paper is.** *Finetuning Prompt-Based Image Editor for Geometry-Consistent Room Defurnishing* (Kulshreshtha, Pugh, Nussdorfer, Jiddi — **Geomagical Labs, Inc.**; arXiv:2610.34597, submitted 25 Oct 2026; **2 pages, 3 figures**; poster at IEEE ISMAR 2026, non-archival). It fine-tunes a **LoRA (rank 64, alpha 32) on the 4-step distilled FLUX.2[klein]** using **2,500 in-house furnished→empty room pairs**, and reports that FLUX.2 + LoRA beats both plain FLUX.2 and a layout-conditioned SD1.5+ControlNet baseline on **LPIPS (texture fidelity)** and **Layout Error (pixels, geometry consistency)** — paper §2.3, §2.4, Table 1.
- **Paper-reported numbers (Table 1):** `SD + LoRA + ControlNet` LPIPS **0.249** / Layout Error **1.84 px**; `FLUX.2` **0.170** / **2.03 px**; `FLUX.2 + LoRA (ours)` **0.166** / **1.41 px**. Test sets: **300** furnished-empty pairs (LPIPS) and **100** furnished images annotated with layout boundaries (Layout Error) — paper §2.4. Layout Error = mean distance from each annotated ground-truth layout boundary pixel to the nearest predicted floor-region boundary in the inpainted image, with a threshold τ capping the penalty (paper Eq. 1).
- **The direction is inverted relative to our product.** The paper's task is **defurnishing** (remove furniture to get an empty room, for XR diminished reality / virtual staging). staging-studio does the opposite: it stages **empty rooms by adding furniture**. A repository-wide grep for `defurnish` returns **zero hits** (`grep -rni "defurnish" . --exclude-dir=node_modules --exclude-dir=.git` → no matches); there is no unfurnish / de-stage feature, no defurnish route, no defurnish metric.
- **Premise correction (the issue's premise is stale twice over).** The issue says the current inpainting path is "fal.ai FLUX.1 Fill via `src/lib/fal.ts`". (a) **There is no `src/lib/fal.ts`** — `AGENTS.md:74` states it explicitly ("There is no `src/lib/fal.ts`; the spend guard lives in `fal-spend-guard.ts`"), and `src/lib/fal-spend-guard.ts:15-17` records that fal and Replicate were retired in **#1240** and their modules deleted. (b) The only wired inpaint provider is **Alibaba Cloud DashScope `qwen-image-2.1-pro`** (`src/lib/inference.ts:72-90` default, `src/lib/alibaba-adapter.ts:106-121`, `.env.example:41` `ALIBABA_INPAINT_MODEL=qwen-image-2.1-pro`, `.env.example:47` `INFERENCE_PROVIDER=alibaba`); `INFERENCE_PROVIDER=fal|replicate` now throws at configure time (`src/lib/inference.ts:290-299`, `src/lib/inference.ts:320-331`). FLUX.1 Fill survives only as a **legacy payload builder** (`src/lib/prompts.ts:369` `buildFalFillPayload`) and a **stale logical model name** (`src/lib/inference.ts:48` `LOGICAL_MODEL.FLUX_FILL = "flux-fill"`).
- **The paper says nothing about FLUX.1 Fill.** Its baselines are FLUX.2[klein], FLUX.2[klein]+LoRA and SD1.5-inpainting + LoRA + depth/normal ControlNets (paper §2.1-§2.3, Table 1). So the paper provides **no evidence** about the incumbent the issue names, even historically.
- **No artefact to adopt.** The paper publishes **no code, no LoRA weights, no dataset and no licence statement** — see §4 for exactly what I checked. The 2,500 training pairs are "collected and prepared … **in-house**" (paper §2); the only external link in the paper is the `ostris/ai-toolkit` training repo (paper ref. [7]). Adopting therefore means **reproducing the paper from scratch**: A5000-class training (paper §2.3: 3,000 steps, lr 1e-4, batch 4, 768 px, EMA 0.999, differential guidance on, **12 hours on a single NVIDIA A5000**) plus GPU serving — none of which exists in this repo or on this VM.
- **Where the *idea* would land if we ever wanted it.** Geometry/architecture preservation is a real risk in our pipeline *because the active provider is instruction-mode*: the mask never reaches the wire (`src/lib/prompts.ts:443-455` — the Alibaba payload is `image_url` + `prompt` only; `src/lib/alibaba-adapter.ts:204-221` sends `content: [{ image }, { text }]`), so the whole canvas is regenerated. Our own bake-off measured mask-complement drift of **28-34** mean RGB delta (seedream-5-flash) and **~52** (seedream-5-pro) for instruction-mode slots versus **~0.006-0.11** for mask-fill slots (`bake-off/drift-results.md:17-18`, `:29-32`). But our architectural protection is *structural*, not learned: the SAM 3.1 furnishings mask deliberately leaves walls/flooring/windows/trim/doors/ceiling **outside** the mask so they are "preserved by construction, not by prompt wording" (`src/lib/furnishing-detection.ts:1-6`), and we detect post-hoc drift with `src/lib/edit-conservation.ts` and `src/lib/inpaint-quality-gate.ts`.
- **Call: SKIP.** The paper trains the *opposite* task on a *different* base model with *no published artefact*, evaluated on a defurnishing-specific metric; it does not evaluate our provider, our metric, or our direction. Revisit only if the §7 monitor conditions hold.

---

## 1. Paper summary (facts as read from the paper)

Source of record: arXiv:2610.34597v1 PDF (fetched read-only over HTTPS as part of this evaluation; **no model weights were downloaded, no GPU job was run, no paid API was called**).

| Item | Value (as stated in the paper) | Where |
|---|---|---|
| Task | "Erasing all furniture from a single room image to generate its empty counterpart" — diminished reality (DR) and virtual staging for XR | Abstract; §1 |
| Base model | FLUX.2[klein], **4-step distilled** version | §2.2, §2.3 |
| Adaptation | LoRA, **rank 64, alpha 32**, applied onto the distilled 4-step model at inference | §2.3 |
| Training data | **2,500 in-house furnished-empty room pairs** | Abstract; §2.3 |
| Training hyper-params | 3,000 steps, lr **1e-4**, batch size **4**, height **768**, EMA decay **0.999**, **differential guidance on** | §2.3 |
| Training stack / hardware | `ai-toolkit` (Ostris), **single NVIDIA A5000, 12 hours** | §2.3 |
| Input format | A **masked RGB image** (furniture regions painted **magenta**) + a prompt: *"This is a photo of a room in which all objects are marked with a magenta mask. Remove all the masked regions and their shadows from this photo, while ensuring that all the unmarked regions remain absolutely unchanged."* | §2.2 |
| Metrics | **LPIPS** (texture fidelity, 300 test pairs) and **Layout Error** (px, 100 layout-annotated furnished images; Eq. 1) | §2.4 |
| Baseline 1 | SD1.5 inpainting + LoRA, conditioned by **depth + normal ControlNets** (α = 0.5 each) from a 3D layout extractor; "not robust to shadows", artifacts in non-planar regions | §2.1 |
| Result (Table 1) | SD+LoRA+ControlNet **0.249 / 1.84 px**; FLUX.2 **0.170 / 2.03 px**; **FLUX.2+LoRA (ours) 0.166 / 1.41 px** | Table 1 |
| Stated limitations | Image-only: no explicit 3D conditioning, no persistent scene representation ⇒ **multi-view and temporal consistency not guaranteed**; inference **up to 5 s/image**, so "offline scene preparation rather than real-time XR" | §3 |
| Stated future work | Explicit geometry conditioning (depth/normal), distillation into faster real-time variants, precomputed empty-room assets for DR systems such as DimSplat | §3 |
| Code / weights / data release | **Nothing stated.** No repository, checkpoint, dataset link, or licence statement appears in the paper text. | §4 below |

### 1.1 What the paper actually demonstrates (and what it does not)

- It demonstrates a **task-specific LoRA on a generalist editor** can recover geometry faithfulness *for the defurnishing task* without giving up texture quality: layout error improves **2.03 px → 1.41 px** against its own FLUX.2 baseline, and beats the explicitly layout-conditioned SD+LoRA+ControlNet baseline on **both** metrics (paper Table 1).
- It does **not** demonstrate anything about: FLUX.1 Fill; Qwen-Image-Edit (mentioned as a prompt-based editor in §1 but never benchmarked); masked-region pixel fidelity outside the *floor boundary* metric; multi-view/temporal consistency (explicitly disclaimed, §3); cost per image; or any hosted endpoint.
- The geometry metric is **floor-region boundary distance** (paper §2.4), i.e. a *planar-layout* metric for empty-room scenes. It is not a general "architecture preserved" metric, and it is not the metric our quality gate or conservation checks use.

---

## 2. Premise corrections — what the repo actually shows

### 2.1 The inpainting path is **not** `src/lib/fal.ts`, and not FLUX.1 Fill

| Issue's premise | Repo reality | Citation |
|---|---|---|
| "currently fal.ai FLUX.1 Fill via `src/lib/fal.ts`" | `src/lib/fal.ts` **does not exist**; fal and Replicate adapters were **deleted in #1240** | `AGENTS.md:74`; `src/lib/fal-spend-guard.ts:15-17` |
| "fal.ai FLUX.1 Fill" is the live inpainter | Only wired provider: **Alibaba Cloud DashScope**, model `qwen-image-2.1-pro` | `src/lib/inference.ts:72-90`; `src/lib/alibaba-adapter.ts:106-121`; `.env.example:41,47`; `AGENTS.md:101` |
| fal is selectable | `INFERENCE_PROVIDER=fal\|replicate` **throws** at configure time | `src/lib/inference.ts:290-299`, `:320-331`; `AGENTS.md:117` |
| FLUX.1 Fill is the inpainting model | FLUX.1 Fill survives only as a **legacy payload builder** (`buildFalFillPayload`, `src/lib/prompts.ts:369`) and a **stale logical name** (`LOGICAL_MODEL.FLUX_FILL = "flux-fill"`, `src/lib/inference.ts:48`); the payload builder is only reachable when `INFERENCE_PROVIDER=fal`, i.e. never in production | `src/lib/prompts.ts:539-554` (`buildInpaintPayloadForActiveProvider`) |
| — | The historical fal incumbent is still measurable: `flux-pro-fill` (fal, mask-fill), **$0.05/MP, ~20 s** | `bake-off/RESULTS.md:11`, `:23` |

**Consequence for this issue:** the paper's baseline is **FLUX.2[klein]**, and its conclusion is "FLUX.2 is not geometry-faithful for defurnishing". We are not running FLUX.2 at all, and we are not running FLUX.1 Fill either. Any comparison the issue implicitly asks for ("LoRA vs FLUX.1 Fill") is **not answerable from this paper** — it contains no FLUX.1 Fill baseline.

### 2.2 Our current edit path is instruction-mode — the mask never reaches the wire

- Alibaba payload builder returns **only** `image_url` + `prompt` (`src/lib/prompts.ts:443-455`), and the adapter posts `messages: [{ role: "user", content: [{ image: imageUrl }, { text: prompt }] }]` with `parameters: { strength, seed?, size: "2048*1536" }` (`src/lib/alibaba-adapter.ts:204-221`). There is **no mask field** on the wire.
- Consequence: the mask the stager paints is a *client-side* concept (region-replacement semantics, white = regenerate, `src/lib/mask-coverage.ts:4-9`) that the provider cannot honour — the whole canvas is re-rendered and the mask's effect is achieved by prompt wording alone. The repo already knows this: *"prompt-only preservation is what drifted architecture in the field report"* (`src/lib/furnishing-detection.ts:8-9`).
- Measured cost of that on the wire: instruction-mode slots drift **28-34** (seedream-5-flash) and **~52** (seedream-5-pro) mean RGB delta in the mask-complement region, versus **~0.006** (flux-pro-fill), **~0.04-0.11** (z-image-turbo-inpaint), **~0.039** (flux-kontext-lora-inpaint) for mask-fill slots (`bake-off/drift-results.md:17-19`). The active provider `qwen-image-2-1` shows **0.000** drift — which the same file correctly labels as *byte-identical reproducibility at a fixed seed*, **not** evidence that the unedited region was preserved (`bake-off/drift-results.md:26-31`).

### 2.3 Our architectural protection is structural, not learned

- The SAM 3.1 furnishings mask is built so that "walls, flooring, windows, trim, doors, and ceiling sit **OUTSIDE the mask** and are preserved **by construction**, not by prompt wording" (`src/lib/furnishing-detection.ts:1-9`). The one-click preset is the mechanism that keeps architecture out of the regenerated region.
- Post-hoc detection of architectural change exists as advisory checks: `src/lib/edit-conservation.ts` (ABACUS-style object counting + scene conservation, §"ABACUS-style edit conservation checks", issue #1446) and `src/lib/inpaint-quality-gate.ts` (which can emit `architecture_risk` when directives ask to change walls/flooring/windows/trim/doors/ceiling and the mask does not cover them — `src/lib/inpaint-quality-gate.ts:56`, `src/lib/ai-route-schemas.ts:322-336`).
- Neither of these is a *learning* mechanism: they constrain what may change and detect violations after the money is spent. A geometry LoRA would be a **third** layer (make the editor itself less likely to distort structure).

---

## 3. Repo-fit analysis — where geometry consistency would help, and where it would not

### 3.1 Where the paper's *idea* maps onto our pipeline

1. **The risk is real and already measured.** Our production editor is instruction-mode (§2.2), so wall/floor geometry can drift; the repo's own mask-complement drift numbers show the scale (`bake-off/drift-results.md:29-32`).
2. **The mechanism is transferable in principle.** The paper's recipe (task-specific LoRA on an inpainting editor, trained on paired before/after room images, differential guidance to focus on the edited region) is a *recipe*, not an API: an "empty→furnished" analogue trained on *our* pairing would be the version that matches our direction (§3.2).
3. **We already have two of the three ingredients the paper needed.** (a) a mask source for furniture regions — SAM 3.1 via `fal-ai/sam-3-1/image` (`src/lib/furnishing-detection.ts:31-32`); (b) a before/after corpus — the repo already exports a selection log for a training corpus (`AGENTS.md:80`, `scripts/export-selection-log.ts`). The missing ingredient is a *furnished-empty* (or *empty-furnished*) image **pair** set plus a GPU training budget.
4. **There is a concrete integration point if the artefact ever existed.** `src/lib/inference.ts:9-13` documents the extension contract: *"a new adapter file plus one switch arm in `resolveProvider` / `getInferenceClient`"*. A self-hosted FLUX.2[klein]+LoRA server would be a new adapter implementing the same four-method surface (`subscribe` / `submit` / `status` / `result`, `src/lib/inference.ts:19-33`). Two extra integration chores would follow: the adapter's output host must be added to `next.config.ts` `images.remotePatterns` (`AGENTS.md:142`), and the *mask convention* differs (see §3.3).

### 3.2 Where it would **not** help — the four hard mismatches

1. **Task direction.** The paper removes furniture; we add it. A defurnishing LoRA's learned priors ("remove all the masked regions and their shadows") are the *opposite* of what our editor is asked to do. Nothing in the repo even asks for removal (`grep -rni "defurnish"` → 0 hits).
2. **Base model / provider.** The LoRA is welded to FLUX.2[klein] 4-step. Our provider is `qwen-image-2.1-pro` on DashScope (`src/lib/alibaba-adapter.ts:106-121`) — a different architecture, a hosted vendor API with no LoRA slot. Adopting the recipe does not give us a model; it gives us a training plan for a model we would have to host ourselves.
3. **Metric mismatch.** The paper's geometry metric is *floor-boundary* Layout Error on empty-room outputs (paper §2.4, Eq. 1). Our risk is *architecture drift in a re-generated furnished room* — walls, windows, trim, door lines, ceiling line. There is no evidence in the paper that the LoRA's benefit transfers to those elements; the paper's own scope statement is that it learns "vanishing lines, room element sizes, and scene layout" (paper §3) for empty-room synthesis.
4. **Where the mask is honoured, the headroom is already ~0.** For mask-fill slots the unedited region is essentially pixel-perfect (`bake-off/drift-results.md:17-19`: flux-pro-fill ~0.006, z-image-turbo-inpaint ~0.04-0.11, flux-kontext-lora-inpaint ~0.039 mean delta). A geometry LoRA aimed at "don't distort what you didn't touch" has little left to fix on a mask-honoring provider; it would matter mainly for an **instruction-mode** provider, i.e. exactly our current one — where, however, we cannot bolt on a FLUX.2 LoRA at all.

### 3.3 Concrete integration requirements (described, **not** implemented)

If the artefact were released and licensed, wiring it would mean:

1. **A self-hosted inference endpoint** (GPU; the paper's own training used an A5000 for 12 h and inference is "up to 5 s/image", paper §2.3/§3) — new infra, new cost line, new on-call surface. The provider abstraction only knows hosted HTTP adapters; there is no self-host adapter and no GPU in this repo or on this VM.
2. **A new adapter** (`src/lib/<name>-adapter.ts`) implementing `subscribe` / `submit` / `status` / `result`, plus one switch arm in `resolveProvider` / `getInferenceClient` (`src/lib/inference.ts:72-90`, `:320-333`) and a new `InferenceProviderName` literal (`src/lib/inference.ts:65`).
3. **Mask-format bridging.** The paper's FLUX.2 setup carries the mask **inside the RGB image** (furniture painted **magenta**) with a prompt that asks the model to keep "all the unmarked regions … absolutely unchanged" (paper §2.2). Our pipeline carries the mask as a **separate artifact** with region-replacement semantics (white = regenerate, `src/lib/mask-coverage.ts:4-9`) and never paints it into the photo. We would need a magenta-composite step in the client or adapter, and a prompt rewrite — i.e. the mask-honouring contract of our current mask pipeline (`src/lib/inpaint-submit.ts`, `src/lib/mask-*.ts`) would have to be re-specified for this provider.
4. **Prompt reuse.** `buildInpaintPrompt` (`src/lib/prompts.ts:343-353`) and the negative prompt / architecture-preservation wording (`src/lib/holistic-prompt.ts:76-136`, `src/lib/prompts.ts` `NEGATIVE_PROMPT`) are written for *our* staging directives ("stage this room", "do not alter architecture"), not for the paper's removal prompt. The paper's LoRA is fine-tuned for the removal instruction; prompt transfer to staging is unproven.
5. **Evaluation harness.** To accept any geometry model we would need our own architecture-drift metric; the paper's Layout Error needs layout-annotated boundaries (`paper §2.4`), which our corpus does not have (we have a selection log of staging runs, `AGENTS.md:80`).
6. **Cost/quotas.** The spend baseline would change: today's ballpark is **~$0.04/image**, 20 inpaint calls/user/day ⇒ **~$0.80/user/day max** (`src/lib/api-quota.ts:39-40`, `src/lib/api-quota.ts:54`); a self-hosted GPU path has no such unit price and the paper publishes **no cost figures**, so the per-image cost of the LoRA path **is not computable from the paper**.

---

## 4. Code / weights availability status

**Status: NO PUBLIC ARTEFACT (verified as far as the paper text allows).**

What I checked, and what I found:

| Item | Status | Evidence |
|---|---|---|
| Paper | Published, 25 Oct 2026, arXiv:2610.34597v1, **2 pages, 3 figures**, ISMAR 2026 poster (non-archival) | arXiv abstract page + PDF |
| LoRA weights | **Not published.** The paper states the LoRA config and training recipe but links no checkpoint (only the `ostris/ai-toolkit` repo, ref. [7]) | paper §2.3 + full-text grep for "code / release / available / github / licence" → only ref. [7] |
| Training code | **Not published.** The recipe is described in prose ("training is done using ai-toolkit [7]") but no repo of their own is linked | paper §2.3 |
| Training data | **Not published, and not licensable.** "we collect and prepare a dataset of 2,500 furnished-empty room pairs **in-house**" | paper §2 |
| Test sets | **Not published.** 300 test pairs (LPIPS) and 100 layout-annotated furnished images (Layout Error) are described but not released | paper §2.4 |
| Base model (FLUX.2[klein]) | Cited as a Black Forest Labs blog post, Jan 2026 (ref. [1]). **I could not verify** from the paper whether the 4-step distilled weights are openly downloadable, redistributable, or commercially licensed — the paper says nothing about licensing or redistribution. | paper §2.2, ref. [1] |
| Licence of the paper's artefact | **Not stated anywhere in the paper.** | full-text read |
| Hosted endpoint (e.g. a fal/Replicate model) | **None referenced.** | full-text read |
| Our repo's LoRA precedent | The repo has evaluated a *vendor* LoRA before — `flux-kontext-lora-inpaint` (fal, mask-fill, $0.035/MP) was a bake-off slot (`bake-off/RESULTS.md:18`, `bake-off/drift-results.md:19`) — i.e. our integration route for LoRAs is a **hosted vendor model**, not a self-hosted checkpoint. | `bake-off/RESULTS.md` |

**What I could NOT verify (stated explicitly, no guessing):**
- Whether the authors intend to release the LoRA, the code, or the dataset, or on what licence.
- The FLUX.2[klein] licence/redistribution terms (not in the paper; I did not fetch BFL's blog post for this evaluation, and did not download any weights).
- Whether the layout extractor of ref. [5] or the ControlNet baseline code is public in a usable form.
- Any hosted price for the LoRA path (the paper publishes no price figures at all).
- Whether the paper's numbers reproduce on our corpus or our provider — **we did not and could not run the benchmark** (no GPU, no weights, no paid API calls on this VM, per the issue's hard stops).

---

## 5. Risks and open questions

**Risks of the (hypothetical) adopt path:**
1. **Licence risk** — unknown licence for the LoRA, the base model and the in-house data (paper is silent). A production inpainting path needs a defensible commercial licence; we cannot infer one.
2. **Infrastructure risk** — a self-hosted GPU endpoint is a new class of infra for this repo (no GPU, no self-host adapter, `src/lib/inference.ts:9-13`).
3. **Prompt/mask-contract risk** — the paper's mask convention (magenta painted into the RGB) and removal instruction do not match our mask semantics or our staging prompts (§3.3).
4. **Evidence-transfer risk** — the geometry gains are measured on empty-room floor boundaries in the paper's own test sets; our metric (architecture preserved while staging) is unmeasured.
5. **Opportunity cost** — the same engineering hour spent on mask-honouring provider coverage and on our deterministic conservation gate (`src/lib/edit-conservation.ts`) buys drift protection for *every* model, including the one we run.
6. **Direction risk** — a defurnishing LoRA in a staging product is a feature we do not have; if unfurnishing is ever wanted, the paper's artefact would still be unavailable.

**Open questions (each needs an answer we do not have today):**
- Q1. Is a *furnishing* LoRA (empty→furnished pairs) even wanted, given our structural mask already excludes architecture (`src/lib/furnishing-detection.ts:1-9`)?
- Q2. Do we have a paired empty/furnished corpus at all (the training corpus today is a *selection log* of staging runs, `AGENTS.md:80` — not image pairs)?
- Q3. What is our own architecture-drift metric? (The paper's Layout Error needs layout-annotated boundaries, paper §2.4; we have none.)
- Q4. Who owns GPU training/serving, and at what cost? (No GPU in repo; the abstraction has no self-host adapter.)
- Q5. Is FLUX.2[klein] commercially usable in our product at all?
- Q6. Would a hosted equivalent exist (a vendor-hosted FLUX.2-family LoRA), which would be our *only* cheap integration route (`bake-off/RESULTS.md:18` precedent)?

---

## 6. What the paper does *not* let us conclude

- It does **not** show FLUX.1 Fill is inferior to the LoRA (no FLUX.1 Fill baseline).
- It does **not** show our provider (`qwen-image-2.1-pro`) is geometry-inconsistent (Qwen-Image-Edit is named in §1 but never benchmarked).
- It does **not** show a LoRA can improve geometry for a *staging* task (the training pairs and the prompt are defurnishing-specific).
- It does **not** quantify cost, and it disclaims multi-view/temporal consistency and real-time use (§3).

---

## 7. Verdict

### **SKIP** — do not adopt, do not adapt this paper's artefact.

**Reason (one sentence):** the paper is a defurnishing (furniture-removal) recipe for a base model we do not use, with no published code, weights, dataset or licence, evaluated on a defurnishing-specific geometry metric, and the architecture-preservation gap it targets is already addressed in our repo structurally (mask excludes architecture) and post-hoc (conservation + quality gate) — so there is nothing to adopt, nothing adaptable without a from-scratch GPU training and self-hosting project, and no evidence that the result transfers to staging.

**Why not ADOPT:** there is no artefact to adopt (no weights, no code, no hosted endpoint — §4), and the paper benchmarks neither our provider nor FLUX.1 Fill (§1.1, §2.1).

**Why not ADAPT:** "adapt" would mean (a) re-training the recipe ourselves on *furnishing* pairs, (b) on a base model we would have to host, (c) behind a new self-host adapter and GPU cost line, (d) with a mask/prompt contract rewrite (§3.3), (e) and with no released dataset to start from. That is a multi-quarter ML-infra project, not an adaptation, and it cannot be validated without spending GPU time we have no budget for.

**Concrete next step (what we do instead, no pipeline change from this issue):** nothing to integrate. Keep the architecture-preservation work where it is already effective and cheap:
1. Keep the SAM 3.1 furniture mask as the structural guarantee (`src/lib/furnishing-detection.ts:1-9`) — do not let architecture into the regenerated region;
2. Keep `src/lib/edit-conservation.ts` + `src/lib/inpaint-quality-gate.ts` as the post-hoc detectors;
3. If mask-honouring coverage is desired, prefer the **mask-fill** path — our own numbers show mask-fill slots at ~0.006-0.11 mask-complement mean delta and $0.01-$0.05/MP (`bake-off/drift-results.md:17-19`, `bake-off/RESULTS.md:11,17`) versus the instruction-mode provider's wholesale re-render.

**Monitor conditions (revisit this call if any of these become true):**
- **M1.** The authors release the **LoRA weights + code + dataset** under a commercial licence, *and* a hosted endpoint (fal/Replicate-style) exists — that removes blockers 1-3 of §5 at once and makes the ~$0.035/MP hosted-LoRA route plausible (`bake-off/RESULTS.md:18` precedent).
- **M2.** We decide to build a **furnishing** (empty→furnished) LoRA and obtain GPU training/serving — then this paper's *recipe* (not its artefact) becomes a useful reference, and the work item should be re-scoped as a training project with its own dataset and metric questions (Q2, Q3).
- **M3.** A **layout-conditioned** inpainting provider becomes available on fal/Replicate with mask support — the paper's own baseline shows explicit layout conditioning already beats plain FLUX.2 on geometry (SD+LoRA+ControlNet 1.84 px vs FLUX.2 2.03 px, Table 1) without touching a generalist editor, and that lever is hostable without any training — note it still does not reach the paper's own 1.41 px LoRA result.

**Nothing in this issue changes the pipeline.** This document is the only file added.
