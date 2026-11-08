# DCR-SAM / QK-Edit evaluation for the mask-generation and editing surfaces

**Issue:** [#1446](https://github.com/anchapin/staging-studio/issues/1446) — Evaluate DCR-SAM (arXiv:2610.27960) and QK-Edit (arXiv:2610.17829) for the staging pipeline. (The issue's third action — the ABACUS-style object-count / scene-conservation QA checks — shipped separately in PR #1451 and is **not** re-litigated here.)
**Date:** 2026-10-23
**Status:** Research-only (no code changes in this issue).
**Labels:** `inpainting`, `research`
**Sibling docs:** [`docs/one-step-editing-evaluation.md`](one-step-editing-evaluation.md) (#1444, ER-Chord / PreciseEdit) and [`docs/lenserase-removal-evaluation.md`](lenserase-removal-evaluation.md) (#1445, LensErase / SERO / ReState) — same house style, same evidence rules.

---

## 0. TL;DR

- **We do use SAM — but only as a third-party hosted endpoint, and only on a path that is currently unreachable in production.** The only SAM in this repo is the fal.ai model id `fal-ai/sam-3-1/image` (`src/lib/furnishing-detection.ts:32`), reached through the logical model `SAM_3_1_IMAGE` (`src/lib/inference.ts:49-50`). The single wired provider is Alibaba DashScope (`src/lib/inference.ts:285-296`, `src/lib/inference.ts:318-330`) and its adapter has **no mapping for the SAM logical model** — `resolveAlibabaModel` throws for anything but `FLUX_FILL` (`src/lib/alibaba-adapter.ts:106-121`). The fal/replicate providers that used to serve SAM were deleted in #1240 (`src/lib/inference.ts:285-296`). On top of that, **no client code calls `/api/segment/furnishings` any more** — the editor renders hard-coded placeholder detections (`src/components/edit-room/EditRoomStudio.tsx:717-735`), and a grep for `segment/furnishings` across `src/` returns only route handlers, the service, the schema and comments — **no `fetch`** (§2.3). Today the mask that drives an edit is **freehand-painted on a canvas** (`src/components/edit-room/MaskLayer.tsx:1-45`).
- **DCR-SAM (arXiv:2610.27960) — DEFER (not applicable today).** It is an *adapted and fine-tuned* SAM3: a unified learnable prompt sequence, VCTR/VGTP text-refinement modules, a dense competition head and a learnable background token, trained for 80,000 iterations on 8×RTX 4090 (paper §4.1 "Implementation Details"). It is a **multi-class semantic** segmenter (mIoU on ADE20K/COCO-Stuff/Cityscapes/…), while our mask need is a **per-object instance** mask for a single free-text concept ("furniture") — the very regime the paper says SAM3 already excels at. Adopting it would mean self-hosting SAM3 weights and training an adapter (paper repo `github.com/set-path/DCR-SAM`, HTTP 200, needs the SAM3 checkpoint + dataset configs) to replace one hosted call per `(image, concept)` — and masks are not on the critical path of an edit anyway (§3).
- **QK-Edit (arXiv:2610.17829) — DEFER (mechanism unreachable through our API surface).** It is a *training-free, inference-time* intervention: save `Q_vision^src` / `K_vision^src` during source inversion, then replace `Q_vision^tgt` / `K_vision^tgt` during target generation inside an MM-DiT (paper §3, §4.1 — base models **FLUX.1-dev** and HunyuanVideo, A100 GPUs, applied over the first 30 % of diffusion steps). Our editor is a **hosted HTTP call** — a DashScope multimodal-conversation POST of image + text (`src/lib/alibaba-adapter.ts:174-240`) — so there is no attention tensor, no Q/K hook and no local weights to touch. FLUX itself is not in the pipeline: it survives only as a logical model *name* (`src/lib/inference.ts:47-48`), a legacy payload builder (`src/lib/prompts.ts:369-389`), a retired fal model constant (`src/lib/prompts.ts:60`) and a historical bake-off row (`bake-off/RESULTS.md`).
- **The mask does not reach the model today.** The Alibaba payload is `{ image_url, prompt }` and nothing else (`src/lib/prompts.ts:443-455`), even though the client sends `maskUrl` (`src/components/canvas/use-inpaint-runs.ts:250-270`, `src/app/api/inpaint/route.ts:301`). So *any* mask-quality improvement — DCR-SAM's included — is currently unobservable in the product output. That single fact gates both evaluations.
- **First concrete step if either is ever revisited (§6, §7):** measure, don't adopt. For DCR-SAM: run the public repo **as-is on our own fixtures** (no training) to get the multi-concept mask quality and latency numbers on interior photos, and only then ask whether a trained adapter is worth it. For QK-Edit: no spike until a self-hosted FLUX-class MM-DiT exists behind the `InferenceClient` interface (`src/lib/inference.ts:157-190`); when it does, A/B it on `bake-off/befores/` with the existing drift methodology (`scripts/bake-off-drift-test.mts`).

---

## 1. Scope and method

**Issue:** #1446 — evaluate two inference-time research ideas against Staging Studio's staging pipeline: **DCR-SAM** (efficient SAM3 adaptation for multi-class semantic segmentation, arXiv:2610.27960) and **QK-Edit** (training-free attention-based injection for MM-DiT image/video editing, arXiv:2610.17829).

**What this document is.** A desk-research evaluation in the same house style as the two sibling evaluations (#1444, #1445): the current pipeline established from the worktree with file citations, per-technology analysis against that pipeline, a comparison table, one verdict per technology, and a concrete first step. **No production code changes are made in this issue** — this file is the whole change.

**Evidence rules applied.**

1. Every claim about *this repo* cites a `file:line` that exists in the worktree at commit `fefe704` (develop). Every claim about a *paper* cites the arXiv id and the paper's own section/table, and is labelled **paper-reported**.
2. Paper numbers are quoted with their context (backbone, dataset, hardware, number of concepts) or not at all. Where the paper does not publish something, the cell says **not published** rather than estimating.
3. Paper text was read from the **arXiv HTML render** (`https://arxiv.org/html/2610.27960v1`, `https://arxiv.org/html/2610.17829v1`) and the abs pages, fetched **2026-10-23**; the DCR-SAM code claims are read from the actual repository (`github.com/set-path/DCR-SAM`), fetched the same day, with HTTP status recorded in §9.
4. Repo-measured numbers (latency, drift, price) come from our own committed artefacts (`bake-off/RESULTS.md`, `bake-off/drift-results.md`) or from `docs/issue-220-sam-latency-measurement.md`, which outrank any paper's marketing claim. Where a repo number is an *unverified ballpark* (the #220 protocol's table is explicitly "requires live measurement"), it is labelled as such.
5. Licence facts are quoted from the licence field on the arXiv abs page, not from memory.

**Limits of this pass.**

- Neither method was run. DCR-SAM's public repo could be run (it ships training + eval scripts); we did not, because §3 shows the fit is wrong for our mask semantics and the marginal latency gain has no consumer (§3.3).
- The one number we quote for SAM latency in this repo is a **ballpark from a measurement protocol**, not a live measurement (`docs/issue-220-sam-latency-measurement.md`, "Expected numbers (ballpark — requires live measurement)").
- Because the editor's mask never reaches the provider (§2.2), neither evaluation can be scored on end-to-end output quality today. We say so instead of translating a paper metric into a product claim.

---

## 2. Current state: what the pipeline actually does today

### 2.1 The editor is a hosted DashScope call, not a diffusion pipeline we host

```
client-painted mask + directives
  → POST /api/inpaint                       src/app/api/inpaint/route.ts:35 (maxDuration 60)
  → submitInpaintToActiveProvider()         src/lib/inpaint-submit.ts:415
  → buildInpaintPrompt(aesthetic, dirs)     src/lib/prompts.ts:343-351
  → buildInpaintPayloadForActiveProvider()  src/lib/prompts.ts:539-554
  → buildAlibabaFillPayload()               src/lib/prompts.ts:448-455   ← { image_url, prompt }
  → dashscopeGenerate()                     src/lib/alibaba-adapter.ts:174-240  ← HTTP POST
```

- The only wired provider is **Alibaba Cloud DashScope**; `fal` and `replicate` parse but throw at configure time (`src/lib/inference.ts:285-296`, `src/lib/inference.ts:318-330`). `resolveAlibabaModel` maps the logical model `FLUX_FILL` to `ALIBABA_INPAINT_MODEL` or the default `qwen-image-2.1-pro` (`src/lib/alibaba-adapter.ts:106-112`).
- The provider call is a plain `fetch` to the DashScope multimodal-conversation endpoint with `content: [{ image }, { text }]` and `parameters.size = "2048*1536"` (`src/lib/alibaba-adapter.ts:187-225`). **There is no model object, no sampler loop and no attention state in this repository** — it is a Next.js app on Vercel talking to a vendor API.
- FLUX is present only as: the logical model *name* `"flux-fill"` (`src/lib/inference.ts:47-48`), the legacy fal payload builder (`src/lib/prompts.ts:369-389`) and its retired model constant `fal-ai/flux-lora-fill` (`src/lib/prompts.ts:60`), plus the historical bake-off incumbent row (`bake-off/RESULTS.md`). The #1444 and #1445 evaluation docs reach the same conclusion about the fal inpaint path being retired in #1240.
- Latency reality: the inpaint submit is ~30 s and the route's ceiling is 60 s (`src/app/api/inpaint/route.ts:26-35`); our own bake-off measured `qwen-image-2.1` at **32.1–38.0 s at 2048×1536, $0.04/image** (`bake-off/RESULTS.md`).

### 2.2 The mask is painted by hand, and the mask never reaches the model

- The editor's mask surface is `MaskLayer`, a freehand canvas: strokes are composited on a 2-D canvas and exported as a PNG data URL on every stroke (`src/components/edit-room/MaskLayer.tsx:1-45`).
- That data URL is optionally feathered client-side by the FineTune "expand" slider (`src/app/(dashboard)/projects/[id]/project-detail-view.tsx:1614-1630`, `src/lib/mask-feather.ts`) and posted as `maskUrl` to `/api/inpaint` (`src/components/canvas/use-inpaint-runs.ts:250-270`; route body at `src/app/api/inpaint/route.ts:301`).
- **The mask is dropped on the wire.** `buildAlibabaFillPayload` returns exactly `{ image_url, prompt }` (`src/lib/prompts.ts:443-455`) — no mask field — so the model receives the photo and a sentence. (The legacy fal builder still carries `mask_url`: `src/lib/prompts.ts:382-389`.) This is the single most consequential fact for this issue: **a better mask cannot change today's output**.
- Mask *refinement* is local, deterministic grid math — no learned model anywhere in the chain: format-agnostic classification of provider masks (`src/lib/mask-format.ts:2-31`), flood fill / merge (`src/lib/mask-flood-fill.ts:27-104`), dilation (`src/lib/mask-dilation.ts:22-74`), hole filling (`src/lib/mask-postprocess.ts:44-60`), coverage estimation (`src/lib/mask-coverage.ts:18-45`), feathering (`src/lib/mask-feather.ts`).

### 2.3 What "SAM" means in this repo — and why it is not currently a live path

- **The model id.** The detection endpoint is fal.ai's `fal-ai/sam-3-1/image`, prompted with a single bare concept, default `"furniture"` (`src/lib/furnishing-detection.ts:12-42`). Multi-term prompts were empirically shown to return zero masks (module doc, `src/lib/furnishing-detection.ts:12-24`).
- **The plumbing.** `POST /api/segment/furnishings` (`src/app/api/segment/furnishings/route.ts:143`) → `runFurnishingDetection` (`src/lib/segment-furnishings-service.ts:248-284`) → `client.subscribe(LOGICAL_MODEL.SAM_3_1_IMAGE, …)` (`src/lib/segment-furnishings-service.ts:120`).
- **It cannot succeed today.** The only wired provider is Alibaba, and `resolveAlibabaModel` has a case for `FLUX_FILL` only — `sam-3-1-image` hits the exhaustiveness guard and throws (`src/lib/alibaba-adapter.ts:106-121`). The provider that used to serve it (fal) was removed in #1240 and now throws at configure time (`src/lib/inference.ts:285-296`).
- **No client calls it.** `grep -rn "segment/furnishings" src/` returns the route, the service, the schema, the v1 stubs and comments — **no `fetch`** to it anywhere in `src/components` or `src/app`. The editor's concept chips only set local state and render hard-coded placeholder boxes (`src/components/edit-room/EditRoomStudio.tsx:717-735`, `src/components/edit-room/concept-chips.tsx:30-36`); the shell comment says the real call is still to be wired ("#1344 wires the real `/api/segment/furnishings` call; for now we set the concept…").
- **The one-click preset plan** names a `furnishings-detection` mask kind (`src/lib/holistic-preset.ts:64`, `src/lib/holistic-preset.ts:92`) but nothing consumes that constant today (grep: definition only).
- **If it were live**, its cost profile is already known: one billed call per `(image, concept)`, `DETECTION_TIMEOUT_MS = 90_000` (`src/lib/segment-timeouts.ts:8`), route `maxDuration = 300` (`src/app/api/segment/furnishings/route.ts:70`), an LRU cache keyed `<imageUrl>#<concept>` (`src/lib/segment-cache.ts:84-100`), and a repo ballpark of **~1.8–3.0 s of provider latency per call** (`docs/issue-220-sam-latency-measurement.md` — explicitly labelled *ballpark, requires live measurement*).

---

## 3. DCR-SAM (arXiv:2610.27960)

> **Paper-reported.** "Efficient SAM3 Adaptation for Multi-Class Semantic Segmentation via Dense Competitive Representations" — Liao, Zhu, Ma, Jiang, Dai (ICT, Chinese Academy of Sciences), NeurIPS 2026, arXiv:2610.27960, paper licence **CC BY 4.0** (arXiv abs page).

### 3.1 What the paper claims and does

- **Problem statement.** Native SAM3 does *Promptable Concept Segmentation* (PCS) well for a **single** concept, but when many concepts are segmented **simultaneously** it produces "double-high" activations on overlapping regions (semantic misclassification) and its per-concept cross-attention makes inference latency grow as **O(n)** in the number of concepts (paper §1, Fig. 2).
- **Method.** DCR-SAM adapts SAM3 with (i) a **unified learnable prompt sequence** (length 32) replacing per-class text queries, so one forward pass produces a shared, globally contextualised visual representation; (ii) **VCTR** (Vision-Conditioned Text Refinement) + **VGTP** (Vision-Guided Text Pooling) to build discriminative class anchors; (iii) a **dense competition head** for explicit inter-class competition; (iv) an optional **learnable background token** that absorbs non-target objects (paper §1, §3).
- **Reported numbers.** (i) **2.3 %–10.7 %** improvement over SOTA across natural-scene and remote-sensing benchmarks; (ii) **33× inference speedup** vs native SAM3; (iii) robustness across scenarios (paper §1, abstract). The ablation gives the concrete latency pair: on ADE20K, per-image inference **8038 ms → 244 ms**; adding VCTR costs 224 ms → 244 ms (paper §4.3, Table 2). Baselines are SAM3† (native binary) and SAM3‡ (native multi-class) plus InternImage-H, EoMT, SegMAN-L; metric is **mIoU** on ADE20K (150 classes), Cityscapes (19), COCO-Stuff (171), PASCAL-Context59 (59), LoveDA (7), ISPRS Potsdam/Vaihingen (6), iSAID (16) (paper §4.1).
- **Training cost (paper §4.1, "Implementation Details").** Initialised from official SAM3 weights; the SAM3 backbone is **frozen** and only the new parameters (learnable prompt sequence, lightweight cross-modal attention module, learnable background token) are trained; AdamW, lr 1e-4, weight decay 5e-4, batch size 8, **80,000 iterations**, **8 × NVIDIA RTX 4090**.
- **Code.** `github.com/set-path/DCR-SAM` (HTTP 200 on 2026-10-23). The README requires the **SAM3 pretrained checkpoint** (`model.sam3_checkpoint` / `model.checkpoint_path`), per-dataset train/eval configs and class-name prompt files for the eight datasets above, `torchrun` training, and notes that the evaluation script imports a `vis.visualizer.Visualizer` module **not included** in the repository snapshot.

### 3.2 Does it fit what we need? — no, on three independent grounds

| Requirement in our pipeline | DCR-SAM | Fit |
|---|---|---|
| Per-**object instance** mask for one free-text concept ("furniture", "sofa"), used to paint an edit region (`src/lib/furnishing-detection.ts:42`, `src/lib/mask-format.ts:2-13`) | Multi-class **semantic** segmentation: per-pixel class assignment over a fixed dataset class list, mIoU-scored; the paper keeps SAM3's detector head for instance masks and fuses it for the final map (§4.1) | ✗ Different task. The paper's gains are on the *semantic* head, which we do not consume. |
| Many concepts segmented **in one pass** (the paper's whole premise) | — | ✗ The gap does not exist here: our request schema takes **one** concept per call and the chips are five fixed words (`src/lib/ai-route-schemas.ts:182-200`, `src/components/edit-room/concept-chips.tsx:23`). Multi-term prompts were already shown to return zero masks (`src/lib/furnishing-detection.ts:12-24`). |
| Replace a **hosted** call (`fal-ai/sam-3-1/image`) with something better | Requires self-hosting SAM3 **and** training an adapter (80 k iterations × 8 GPUs) | ✗ Infrastructure we do not have: the app is Next.js on Vercel with one hosted provider (`src/lib/inference.ts:318-330`); there is no GPU or model-serving path in the repo. |

### 3.3 Would the 33× speedup even matter here? — no

- **Masks are not on the critical path of an edit.** The critical path is the inpaint provider call: ~30 s, 60 s route ceiling (`src/app/api/inpaint/route.ts:26-35`), measured 32–38 s at 2048×1536 (`bake-off/RESULTS.md`). Detection is one call per `(image, concept)` on explicit user action, LRU-cached (`src/lib/segment-cache.ts:84-100`), with a repo ballpark of 1.8–3.0 s (`docs/issue-220-sam-latency-measurement.md`).
- **The speedup is measured against a regime we do not operate in.** 8038 ms → 244 ms is native SAM3 on ADE20K with 150 categories on an RTX 4090 (paper §4.3); our per-call concept count is **one**.
- **Even a free, perfect mask changes nothing today**, because the mask never reaches the provider (`src/lib/prompts.ts:443-455`).

### 3.4 Verdict: **DEFER** (not applicable today)

Not "reject" — the paper is licence-clean (CC BY 4.0), the code is public, and the mechanism is sound for its own regime. But every one of the three gates above fails on the current architecture, and the one gate that could change (a mask-aware provider) is a *different* issue.

**Re-evaluation triggers (any one):**
1. A **mask-aware** inpaint provider is wired (the payload builder starts sending `mask_url`, i.e. `src/lib/prompts.ts:448-455` changes) — then mask *quality* becomes product-visible and this paper's numbers become worth comparing against.
2. The editor re-wires concept detection to `/api/segment/furnishings` (`src/components/edit-room/EditRoomStudio.tsx:717-735`) — then the detection path becomes a live cost and its *latency* is worth measuring.
3. The one-click "Restage furnishings" preset lands with a **multi-concept** mask kind (`src/lib/holistic-preset.ts:92`) — the single place where "one pass, many concepts" is genuinely needed, and therefore the only place DCR-SAM's multi-class mechanism could apply.

**First concrete step (no code changes today):** when trigger 2 or 3 lands, run the **public DCR-SAM repo unmodified** over our own room fixtures with the chip concepts (`sofa`, `chair`, `table`, `rug`, `lamp`) and record, per concept: call latency, per-object mask count, and the mask-quality proxies we already compute in pure TS — donut-hole count from `fillHoles` (`src/lib/mask-postprocess.ts:44-60`) and coverage from `estimateMaskCoverage` (`src/lib/mask-coverage.ts:45`). That gives us the *unadapted* multi-concept baseline for free (the repo ships an eval script); only if that baseline is promising on interior photos is it worth asking whether an 8×4090 training run buys anything over a hosted per-concept call.

---

## 4. QK-Edit (arXiv:2610.17829)

> **Paper-reported.** "QK-Edit: Revisiting Attention-based Injection in MM-DiT for Image and Video Editing" — Shen, Huang, Li, Lin, Liu, Wang, Feng, Yang, Liew, arXiv:2610.17829 (submitted 2026-10-13), paper licence **CC BY 4.0** (arXiv abs page).

### 4.1 What the paper claims and does

- **Problem.** MM-DiTs (FLUX, SD3, HunyuanVideo, CogVideoX) use Multimodal Self-Attention — text and image tokens concatenated into one self-attention — which breaks the conventional U-Net cross-/self-attention manipulation tricks used by editing methods (paper §1–§2).
- **Method.** A **training-free** framework built on "the unique attention dynamics of MM-DiTs". Concretely: (1) during source inversion/generation, **save** `Q_vision^src` and `K_vision^src`; (2) during target generation, **replace** `Q_vision^tgt` and `K_vision^tgt` with the saved ones (paper §3, "two steps"). The claim is a better **balance between prompt fidelity and structural consistency**, and the authors note it "can be easily implemented with feature replacement in inference" and with "a few lines of code" (paper §1, §3, §6 pseudo-code).
- **Setup.** Implemented on **FLUX.1-dev** (image) and **HunyuanVideo** (video) (paper §4.1). For image editing the query-key manipulation is applied during the **first 30 %** of diffusion inference steps (20 % for video, for temporal consistency). All experiments on **NVIDIA A100** GPUs (paper §4.1). Metrics for image editing: **CLIP_text↑**, **DINO↑**, **PickScore↑** (paper §4.2).
- **Availability.** Training-free and described as a few lines of code, but **no code repository or project page is linked** from the arXiv abs page or the HTML render as of 2026-10-23 (the only outbound links in the render are `flash-attention` and `genmoai/models`, both citations). We did not find a release elsewhere; treat "implementable" as **paper-reported, not repo-verified**.

### 4.2 Is the mechanism reachable from our API surface? — no

- Our editor's surface is `fetch()` to a DashScope multimodal-conversation endpoint (`src/lib/alibaba-adapter.ts:174-240`). There is **no local sampler, no model object, no attention tensor** in this repository, so there is nowhere to save `Q_vision^src` / `K_vision^src` and nowhere to replace `Q_vision^tgt` / `K_vision^tgt`. A hosted API does not expose its attention internals.
- The one integration seam that *could* host such a method is the provider abstraction: `InferenceClient.subscribe/submit/status/result` (`src/lib/inference.ts:157-190`) — the same seam the #1445 doc proposed for a self-hosted ReState worker. But that seam is an **HTTP/job interface**; an attention-level method has to live *inside* a local model runner, so it would arrive as a **new provider adapter + a self-hosted GPU service**, not as a change to the current one.
- **FLUX is not our editor.** The production editor is `qwen-image-2.1-pro` (`src/lib/alibaba-adapter.ts:106-112`); FLUX survives only as a logical name (`src/lib/inference.ts:47-48`), a legacy payload builder (`src/lib/prompts.ts:369-389`), a retired fal constant (`src/lib/prompts.ts:60`) and a bake-off row (`bake-off/RESULTS.md`). QK-Edit's paper evidence is on FLUX.1-dev and HunyuanVideo — models we do not run.

### 4.3 Would it help if it *were* reachable? — plausible on the axis, with real risks

- **The axis matches our problem statement.** The paper's framing — "an optimal balance between **prompt fidelity** and **structural consistency**" (paper §1) — is exactly the tension this repo has been measuring: our staging prompt is a sentence appended to an aesthetic (`src/lib/prompts.ts:343-351`) and the failure mode we fear is the model restyling architecture it was supposed to leave alone (`docs/lenserase-removal-evaluation.md` §2, `bake-off/drift-results.md`).
- **But the structural guarantee we actually sell is mask-locked, and QK-Edit has no mask channel.** Our mask today is painted and (for the legacy fal path) honoured as `mask_url` (`src/lib/prompts.ts:382-389`); for the live path it is not even sent (`src/lib/prompts.ts:443-455`). QK-Edit optimises text-guided edits globally, so it can trade structure away for prompt fidelity — the opposite of a mask-locked region edit.
- **Risks we would have to measure:** attention replacement is a *global* change to the denoising trajectory; on interiors it can move or restyle regions outside the intended edit area (the drift we track in `bake-off/drift-results.md`), and the paper's own metrics are CLIP/DINO/PickScore — **no** furniture-realism or lighting-consistency metric, so the paper cannot answer our axis 1 either.
- **Cost/latency profile is a change of kind, not of degree:** self-hosted FLUX.1-dev on A100-class GPUs vs $0.04/image at 32–38 s today (`bake-off/RESULTS.md`). That is a capital + ops change, not a config change.

### 4.4 Verdict: **DEFER** (mechanism unreachable today; monitor)

Rejected as a *drop-in* for the current editor — the mechanism is physically inaccessible through a hosted multimodal-conversation API, and FLUX is not in the pipeline. Kept as a **monitor** item because it is training-free, licence-clean (CC BY 4.0), cheap to implement once a local MM-DiT exists, and its stated axis (prompt fidelity vs structural consistency) is ours.

**Re-evaluation triggers (any one):**
1. A **self-hosted** MM-DiT editor is introduced behind `InferenceClient` (`src/lib/inference.ts:157-190`) — the same precondition the #1445 doc set for a self-hosted ReState worker.
2. The upstream project publishes code (none linked today) — that removes the implementation cost entirely.
3. Our bake-off surfaces a hosted **FLUX-class** endpoint that exposes the same edit contract we would want from a local runner (`bake-off/RESULTS.md` already tracks `flux-pro-kontext` and `flux-kontext-lora-inpaint` rows).

**First concrete step (only once trigger 1 or 3 fires):** A/B the method against the incumbent row of our own bake-off on the three committed fixtures (`bake-off/befores/vacant-insert__before.jpg`, `occupied-replace__before.jpg`, `repeat-stability__before.jpg`, each with its `__mask.png`), scoring: **CLIP_text** (prompt fidelity — the paper's own metric), **DINO** (structure — the paper's own metric), **PickScore** (realism proxy — the paper's own metric), plus **our** outside-mask mean-RGB delta using the existing methodology (`scripts/bake-off-drift-test.mts`, `bake-off/drift-results.md`), plus a human read of furniture realism and lighting consistency (no paper metric covers these). Acceptance: no regression in outside-mask drift vs the incumbent, and a measurable CLIP/DINO improvement on `occupied-replace`. **This is a research script, not a product change** — and it cannot be written until trigger 1 or 3 fires.

---

## 5. Side-by-side summary

| | **DCR-SAM** (arXiv:2610.27960) | **QK-Edit** (arXiv:2610.17829) |
|---|---|---|
| Kind of change | Model **adaptation** (trained adapter on frozen SAM3) | **Training-free** inference-time attention manipulation |
| Runs on | SAM3 (self-hosted) | FLUX.1-dev / HunyuanVideo (self-hosted) |
| Paper headline | 2.3 %–10.7 % over SOTA; **33×** faster than native SAM3 (8038 → 244 ms on ADE20K, 150 classes) | Better prompt-fidelity ↔ structure balance; CLIP_text / DINO / PickScore gains on FLUX.1-dev |
| Hardware in the paper | 8 × RTX 4090 for training | A100 for inference |
| Code today | Public repo (HTTP 200) — but needs the SAM3 checkpoint, dataset configs, and a missing `vis.visualizer` module | **No repo/project page linked** on arXiv (verified 2026-10-23) |
| Our surface that would have to change | Replace hosted `fal-ai/sam-3-1/image`; add GPU serving; train an adapter | Add a local MM-DiT provider behind `InferenceClient`; no hook exists in a hosted API |
| Does our pipeline use it today? | **No** — SAM is a hosted fal model id (`src/lib/furnishing-detection.ts:32`), the only wired provider cannot serve it (`src/lib/alibaba-adapter.ts:106-121`), and no client calls the route (`src/components/edit-room/EditRoomStudio.tsx:717-735`) | **No** — the editor is a hosted DashScope HTTP call (`src/lib/alibaba-adapter.ts:174-240`); FLUX is legacy only (`src/lib/prompts.ts:369-389`) |
| Is the target metric even visible downstream? | **No** — the mask is dropped on the wire (`src/lib/prompts.ts:443-455`) | **No** — the provider never receives the mask either; structure preservation today is prompt-only |
| Verdict | **DEFER** | **DEFER** |

---

## 6. The one change that would unblock both (and is not this issue)

Both evaluations are gated by the same architectural fact: **the client-computed mask never reaches the provider** (`src/lib/prompts.ts:443-455` vs `src/components/canvas/use-inpaint-runs.ts:250-270`). Until a mask-aware inpaint path exists, mask-quality research (DCR-SAM) and mask-structure research (QK-Edit, for the mask-locked variant) are both unmeasurable in the product. That is an *inpaint-provider* decision (the bake-off already lists mask-capable candidates — `bake-off/RESULTS.md`), not a research-paper decision, and it should be tracked separately from #1446.

## 7. What we deliberately did not do

- **No production code changes.** This issue ships one markdown file. No prototype was built: for DCR-SAM the fit is wrong (§3.2) and for QK-Edit the mechanism is unreachable (§4.2); both first steps above are *described*, not implemented.
- **No re-litigation of the issue's third action.** The ABACUS-style object-count / scene-conservation checks shipped in PR #1451 (`feat(lib): deterministic ABACUS-style edit conservation checks`, `src/lib/edit-conservation.ts`) and are out of scope here.
- **No claim that these papers are bad.** Both are solid work in their own regimes; the verdicts are about *our* pipeline, dated 2026-10-23, and each carries explicit re-evaluation triggers (§3.4, §4.4).

## 8. Verification performed

```bash
git status --porcelain          # → only docs/dcr-sam-qk-edit-evaluation.md is new
npm run lint                    # oxlint .           → clean
npm run typecheck               # tsc --noEmit       → clean
npm test                        # vitest run         → green (docs-only change; no test touches this file)
```

There is **no markdown linter or doc-format check** in this repo: `package.json` exposes only `lint` (oxlint), `typecheck`, `test`, `e2e`, `bake-off` and `release:check`; no `.markdownlint*`/`.mdlrc` config exists; and CI explicitly skips markdown-only pushes via `on.push.paths-ignore: ['**.md']` (`.github/workflows/ci.yml`). The doc's format therefore follows the sibling evaluation docs (`docs/one-step-editing-evaluation.md`, `docs/lenserase-removal-evaluation.md`) rather than a tool.

## 9. Sources (all fetched 2026-10-23)

| Source | URL | Status |
|---|---|---|
| DCR-SAM abs page (licence CC BY 4.0, repo link) | `https://arxiv.org/abs/2610.27960` | 200 |
| DCR-SAM HTML render (§1, §3, §4.1, §4.3) | `https://arxiv.org/html/2610.27960v1` | 200 |
| DCR-SAM code (README, checkpoints, training commands) | `https://github.com/set-path/DCR-SAM` | 200 |
| QK-Edit abs page (licence CC BY 4.0, **no** repo link) | `https://arxiv.org/abs/2610.17829` | 200 |
| QK-Edit HTML render (§1, §2, §3, §4.1, §4.2, §6) | `https://arxiv.org/html/2610.17829v1` | 200 |
| Our own bake-off (latency, price, drift) | `bake-off/RESULTS.md`, `bake-off/drift-results.md` | in-repo |
| SAM latency protocol (ballpark) | `docs/issue-220-sam-latency-measurement.md` | in-repo |
