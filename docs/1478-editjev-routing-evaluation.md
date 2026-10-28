# EditJev (arXiv:2610.32635) evaluation for staging-studio's image-editing path

**Issue:** [#1478](https://github.com/anchapin/staging-studio/issues/1478) — evaluate "EditJev: System One Routing for Image Editing Models" (arXiv:2610.32635) against staging-studio's current image-editing path and record an adopt / adapt / skip call.
**Date:** 2026-10-28
**Status:** Analysis only — **no code, config or workflow changes land from this issue.**
**House style:** follows `docs/1480-inversion-free-single-evaluation-evaluation.md` (#1480), `docs/one-step-editing-evaluation.md` (#1444), `docs/lenserase-removal-evaluation.md` (#1445), `docs/1446-abacus-dcr-sam-qk-edit-evaluation.md` (#1446).

---

## 0. TL;DR — verdict: **SKIP** (do not adopt, do not adapt; monitor conditions in §7)

- **What the paper is.** EditJev is a **System One router**: a multimodal LLM backbone (Qwen3-VL-4B-Instruct, frozen + LoRA) with a **linear preference head** that, in **one forward pass**, emits a fixed-length score vector over a fixed candidate list of editing models; the selected editor is `argmax_i(û_i + β·s_i)`, where `s_i` is a normalised speed score derived from each candidate's mean generation latency (paper Abstract; §3.2, Eqs. 2–5). It is trained offline on **pairwise preferences** built from running *all* candidates on every training request and scoring their outputs with an MLLM judge (paper §3.3, Eqs. 6–9).
- **Paper-reported headline numbers.** On **ImgEdit** the router lifts the aggregate score from **4.540** (best fixed editor, Qwen-Image-Edit) to **4.592**, and cuts estimated end-to-end latency from **56.90 s** to **22.33 s** (−60.8 %); on **GEdit-En** it goes **8.194 → 8.255** with latency **56.90 s → 38.88 s** (−31.7 %) (paper Abstract; Table 1; Table 2; Table 3). Routing overhead is **0.094 s** for EditJev vs **4.39–17.68 s** for the API-based MLLM routers (paper Table 1, "Latency(s)" column; §4.2). Router latency was measured **on an NVIDIA RTX PRO 6000** (paper §4.1). The paper publishes **no price/cost figures, no code, no checkpoint and no router training-set description** in the text we could read (§9, "not published").
- **Premise correction (the issue's premise is stale).** The issue says we route everything through "one vendor/model (fal.ai FLUX.1 Fill)". The *shape* of the premise (one provider, one model) is right; the *identity* is wrong. fal and Replicate were **retired in #1240** — `INFERENCE_PROVIDER=fal|replicate` now throws (`src/lib/inference.ts:295`, `src/lib/inference.ts:326`); the only wired provider is **Alibaba Cloud DashScope**, model `qwen-image-2.1-pro` by default (`src/lib/inference.ts:86`, `src/lib/alibaba-adapter.ts:111`, `.env.example:41`). The *logical* model name is still the stale `LOGICAL_MODEL.FLUX_FILL = "flux-fill"` (`src/lib/inference.ts:48`), but the wire model is Qwen-Image-2.1-Pro at `size: "2048*1536"` (`src/lib/alibaba-adapter.ts:111`, `src/lib/alibaba-adapter.ts:221`). FLUX.1 Fill survives only as a *legacy payload builder* (`src/lib/prompts.ts:384`) and as a *historical bake-off slot*.
- **Why it does not apply to us today — three independent blockers, any one of which is fatal:**
  1. **There is no candidate pool to route between.** Exactly one provider adapter is wired (`src/lib/inference.ts:318-333` → `src/lib/alibaba-adapter.ts`) and exactly one logical model is mapped (`src/lib/alibaba-adapter.ts:106-121`); the only other models we have are same-vendor variants of the *same* editor behind a deployment-level env var (`AGENTS.md`, `ALIBABA_INPAINT_MODEL`). A router over K = 1 is a no-op. Re-wiring fal as a second candidate is a **vendor re-introduction project** (it was deleted in #1240), not a routing change.
  2. **The router is not candidate-agnostic in the sense we would need.** The preference head is a fixed-dimensional output over the *specific* candidate list it was trained on (paper Eq. 3); the paper lists "larger and **dynamically evolving** pools … support the addition and removal of editors **without extensive retraining**" as **future work** (paper §5). There is no released artefact (no code, no weights, no training data published), so nothing can be re-pointed at our candidate set.
  3. **The router's own cost model assumes a GPU we do not have.** The 0.094 s routing number is *local* inference on an RTX PRO 6000 (paper §4.1); our repo has **no GPU and no GPU rate card**, so the per-request cost of a 0.094 s local router is **not computable** here (paper price: **not published**). The only routers the paper prices in latency — API MLLMs — cost **4.39–17.68 s** each (paper Table 1), i.e. **+12 % to +55 %** on top of our measured **32.1–38.0 s** edit (`bake-off/RESULTS.md:15`).
- **Cost/latency estimate mapped to OUR pipeline (see §5 for the full table).** Today: **$0.04/image** and **32.1–38.0 s/edit** (`src/lib/api-quota.ts:39`; `bake-off/RESULTS.md:15`), capped at **20 inpaint calls/user/day** (`src/lib/api-quota.ts:54`) ⇒ worst case **$0.80/user/day** (`src/lib/api-quota.ts:39-41`). With a single wired candidate, a router's per-request saving is **$0.00 and 0.0 s** — there is nothing to choose. If a second, cheaper **mask-honoring** candidate were wired (the cheapest mask-fill slot we have measured is `z-image-turbo-inpaint` at **$0.01/MP** and **8.4 s**, `bake-off/RESULTS.md:17`), a perfect router would be worth roughly **$0.013/image (≈33 % of $0.04)** and **≈24 s/edit (≈74–78 % of our edit latency)** — **this is an assumption-based derivation**, because it assumes (a) fal re-wiring, (b) a correct route on every request, and (c) a router whose own overhead is negligible. The paper's headline "−60.8 % latency" is measured against a **56.90 s self-hosted fixed baseline**, not against our 32–38 s hosted edit; that is a different denominator and the percentage does not transfer.
- **Quality risk of a wrong route (our concrete case).** Our current provider is **instruction-mode**: the mask never reaches the wire (`src/lib/prompts.ts:416`, `src/lib/prompts.ts:448-455`) and the whole canvas is sent and regenerated (`src/components/edit-room/CanvasStage.tsx:96`). A wrong route to a mask-**less** editor is therefore a **whole-room re-render**: our own bake-off measured mask-complement drift of **28–34** (seedream-5-flash) and **~52** (seedream-5-pro) mean RGB delta for instruction-mode slots, against **~0.006–0.11** for the mask-fill slots (`bake-off/drift-results.md`) — i.e. the failure mode is "the walls and floor move", exactly what `src/lib/edit-conservation.ts` exists to catch *after* the money is spent. Note the trap in our own numbers: `qwen-image-2.1`'s **0.000** drift figure is *byte-identical reproducibility at a fixed seed*, **not** evidence that the unedited region was preserved (`bake-off/drift-results.md`, "Qwen-Image-2.1 is perfectly reproducible with a fixed seed"). Routing would multiply the number of paid attempts at which such a failure can occur (a wrong route costs $0.04, a user-initiated retry costs another $0.04).
- **Call: SKIP.** The paper's contribution is a trained router artefact; there is no artefact to adopt, no candidate pool to route over, no price to compare, and the quality headroom it demonstrates over the best fixed editor is **+0.052 / +1.1 % aggregate** (paper Table 1) while a wrong route on our pipeline risks a full-room regeneration. Revisit only if the §7 monitor conditions hold.

---

## 1. Scope, method and evidence rules

**Issue #1478 asks** for a desk evaluation of arXiv:2610.32635 against staging-studio's current image-editing path, on (a) applicability, (b) per-edit cost/latency, (c) quality risk, (d) an explicit adopt/adapt/skip call — as a **document only**.

**Evidence rules applied (same as the sibling docs):**

1. Every claim about **this repo** cites a file (and line) in this worktree; every claim about **the paper** cites its arXiv id and the paper's own section/table and is labelled **paper-reported**.
2. Paper numbers are quoted **with their context** (backbone, benchmark, hardware, table). Where the paper publishes nothing (price, code, router training set), the cell says **not published** rather than estimating.
3. Repo-measured numbers (latency, price, drift) come from our own committed artefacts (`bake-off/RESULTS.md`, `bake-off/drift-results.md`) and outrank any paper claim or issue framing.
4. **Nothing was benchmarked.** No paid endpoint was called, no model was executed, no GPU was touched for this document.

**Paper sources actually reached (2026-10-28).**

| Source | URL | Result |
|---|---|---|
| arXiv HTML render (full text) | `https://arxiv.org/html/2610.32635v1` | **HTTP 200 — full text read** (Abstract, §1–§5, Tables 1–7, References). No appendix section is present in the HTML render; the document ends at the References. |
| arXiv abstract page | `https://arxiv.org/abs/2610.32635` | **HTTP 200** — title, authors (Zhile Guan, Xu Jiang, Yule Duan, Gongbo Zhang, Shuyu Wang, Xiao Chen, Jian Zhang; Peking University / Tsinghua University), version `v1 [cs.CV]`, submitted **23 Oct 2026**. |

No second-hand summary was used, and no number in this document comes from anywhere other than that HTML render and this repo.

**Limits of this pass.**

- **No router artefact exists to evaluate.** The paper publishes no code, no checkpoint, no training-data recipe and no price; the HTML render we read contains no appendix. Consequently every "what would it cost us" line below is an **explicitly labelled assumption**, never a measurement.
- The paper's training corpus (how many requests, from which datasets, how the pairwise labels were filtered) is **not published** in the readable text, so we cannot judge how a router trained on ImgEdit/GEdit-En instruction edits would transfer to our prompt-plus-mask staging requests.
- The paper's quality metric is an MLLM-judge aggregate on instruction-edit benchmarks. **Our operative metric is out-of-mask pixel drift / region conservation** (`scripts/bake-off-drift-test.mts`, `src/lib/edit-conservation.ts`), which the paper does not report at all. Any cross-walk between the two is an assumption.
- We did **not** run the router, did not call a paid endpoint, and did not benchmark anything (§8).

---

## 2. What the method actually is (paper-reported)

### 2.1 Problem formulation (§3.1)

A **fixed ordered candidate list** `ℳ = (M₁ … M_K)` of editing models; a routing policy `π: 𝒳 × 𝒞 → [K]` picks one index before generation (Eq. 1). The quality `Q_i(x,c)` of each candidate is **unknown at selection time** — that is the whole problem. The desideratum is a favourable **quality–latency trade-off**, where `t_i` is each candidate's mean end-to-end generation latency.

### 2.2 The router (§3.2)

- A **fixed multimodal routing template** `R(x, c, ℳ)` describes the request and lists the candidates; the MLLM backbone `F_θ` encodes it, and the **hidden state of the last non-padding token** becomes the request representation (Eq. 2).
- A **preference head** `G_φ` (linear) maps that vector to a **fixed-dimensional score vector** `û = (û₁ … û_K)` — the "System One" output: no autoregressive model-name generation, no response parsing (Eq. 3; §3.2).
- **Latency-aware selection:** `s_i = (t_max − t_i)/(t_max − t_min) ∈ [0,1]` from the candidates' mean latencies (Eq. 4), then `î = argmax_i(û_i + β·s_i)` (Eq. 5). `β` trades quality against speed **at inference time, without retraining**.

### 2.3 Training (§3.3)

- For each training request, **all** candidates are executed offline and their outputs judged by an **MLLM evaluator** (VIEScore-style, four 0–10 dimensions: editing success, preservation, naturalness, artifact-freedom). `SC = min(success, preservation)`, `PQ = min(naturalness, artifacts)`, aggregate `O_i = √(SC_i·PQ_i)` (Eq. 6).
- Preference pairs are kept only when the score gap is **≥ δ = 0.5** (Eq. 7), and the router is trained with a **pairwise ranking loss** `softplus(û_b − û_a)` averaged over pairs (Eqs. 8–9).
- Ablation (paper Table 4, ImgEdit): pairwise ranking **4.6002** vs MSE regression **4.5545** vs MCQ generation **4.5491**. Table 5: removing the **source image** from the router input drops the score to **4.5717** (from 4.6002) — the router needs the picture, not just the instruction. Table 6: backbone scale barely matters (2B 4.5898 / 4B 4.6002 / 32B 4.5898).

### 2.4 Reported results (paper-reported, with context)

Setup (§4.1): router backbone **Qwen3-VL-4B-Instruct** (frozen parameters, LoRA adapters + linear head); candidate pool **FLUX.2 Klein 4B, FLUX.2 Klein 9B, FLUX.1-Kontext-dev, OmniGen2, Qwen-Image-Edit**; `β = 0.7` (ImgEdit) and `0.02` (GEdit-En); `δ = 0.5`; **all latency measured on an NVIDIA RTX PRO 6000** with each model's official config, mean generation time over **20** test requests; router latency averaged over **5** requests. Benchmarks: **ImgEdit** (737 requests) and **GEdit-En** (606 requests), evaluated with **GPT-5.1** as the primary judge (§4.1).

| Method | ImgEdit overall ↑ | GEdit-En `G_O` ↑ | Routing overhead (s) | End-to-end latency ImgEdit / GEdit-En (s) |
|---|---|---|---|---|
| Best fixed editor (Qwen-Image-Edit) | 4.540 | 8.194 | — | 56.90 / 56.90 |
| GPT-5.5 Routing | 4.380 | 7.920 | 11.85 | 51.15 / 53.55 |
| Gemini-3.7-Flash / GLM-5.3-Flash / Kimi-K3 Routing | 4.123 / 4.137 / 4.134 | 6.996 / 7.402 / 7.543 | 17.68 / 4.39 / 14.50 | not published |
| Jev Routing (System One baseline) | 4.138 | 7.762 | 0.87 | not published |
| **EditJev** | **4.592** | **8.255** | **0.094** | **22.33 / 38.88** |

Sources: paper Table 1, Table 2, Table 3, §4.2.

- **Quality gain over the best fixed editor: +0.052 ImgEdit (4.540 → 4.592) and +0.061 GEdit-En (8.194 → 8.255)** — about **1.1 %** and **0.7 %** relative (relative percentages are **derived** from the paper's table values, not printed by the paper).
- **Speed-weight trade (paper §4.3, Fig. 4):** sweeping `β` from 0.4 → 1.0 moves estimated end-to-end latency **26.79 s → 17.73 s (−33.8 %)** while the score moves **4.5966 → 4.5667**. At `β = 0.7`: **4.5916 @ 22.33 s**, only 0.0050 below the `β = 0.4` score.
- **Human alignment (paper Table 7, §4.4):** on 20 cases × 20 participants (400 judgments), EditJev's selected model matched the participant's pick **81.75 %** of the time vs **34.50 %** for GPT-5.5 routing; Spearman **ρ = 0.7478** between vote counts and the router's speed-adjusted scores. **≈18 % of the time the router's choice disagrees with the human-preferred model.**
- **The paper's own scope limit (§5, Conclusion):** future work includes "larger and **dynamically evolving** pools of editing models … support the addition and removal of editors **without extensive retraining**", plus "more reliable and scalable routing supervision" and "agentic multimodal judges". I.e. **candidate-pool generality is explicitly future work, not a shipped property.**
- **Not published** (stated as such rather than estimated): per-image/per-request **price** of any candidate editor or of the router itself; **code**; **checkpoints**; the router's **training-set composition and size**; **VRAM**/GPU-hour cost of the 0.094 s router.

### 2.5 What the method is *not*

- It is **not** a mask-aware router: the benchmarks and the candidate pool are **instruction-mode** editors (ImGEdit/GEdit-En style image+instruction), and the router's inputs are (source image, instruction, candidate names, candidate mean latencies) — **no mask channel** anywhere in the formulation (§3.1–§3.2).
- It is **not** a quality *guarantee*: it is a learned score over a fixed candidate set, with a deliberately tunable speed term that trades quality away for latency (§4.3).
- It is **not** provider-agnostic in the deployment sense: the whole design assumes the router can *choose* among locally hosted candidates, each of which can be run offline on every training request to build labels (§3.3) — an assumption our API-only, single-vendor setup cannot satisfy today.

---

## 3. What our pipeline does today (repo facts) — and the premise correction

### 3.1 The current edit path, end to end

```
POST /api/inpaint                                src/app/api/inpaint/route.ts
  → quota reserve (20/user/day)                  src/lib/api-quota.ts:54, :67-68
  → quality gate (advisory)                      src/lib/inpaint-submit.ts:320-333
  → submitInpaintToActiveProvider()              src/lib/inpaint-submit.ts:375-417
      prompt = buildInpaintPrompt(aesthetic,directives)   src/lib/inpaint-submit.ts:382
      payload = buildInpaintPayloadForActiveProvider()     src/lib/prompts.ts:539-554
          → Alibaba branch → { image_url, prompt }         src/lib/prompts.ts:448-455
      client = await getInferenceClient()                  src/lib/inpaint-submit.ts:390
          → resolveProvider() → "alibaba"                  src/lib/inference.ts:72-88
          → createAlibabaClient()                          src/lib/inference.ts:318-333
      submitWithRetry(...)  (transient 5xx backoff)        src/lib/inpaint-submit.ts:75-146
      → dashscopeGenerate()  (circuit breaker 3 / 30 s)    src/lib/alibaba-adapter.ts:182-184
          model = ALIBABA_INPAINT_MODEL || "qwen-image-2.1-pro"  src/lib/alibaba-adapter.ts:106-121
          body: messages[{image, text}], size "2048*1536"        src/lib/alibaba-adapter.ts:198-224
  → status polling                                src/lib/inpaint-status.ts:431
```

Facts that matter for a router:

| Fact | Value | Source |
|---|---|---|
| Providers wired | **one** — `alibaba`; `fal`/`replicate` parse but **throw** at configure time (retired in #1240) | `src/lib/inference.ts:65`, `:72-88`, `:295`, `:326` |
| Logical models mapped | **one** — `LOGICAL_MODEL.FLUX_FILL` → `ALIBABA_INPAINT_MODEL` (default `qwen-image-2.1-pro`); everything else throws | `src/lib/inference.ts:48`, `src/lib/alibaba-adapter.ts:106-121` |
| Stale name | the logical model is still called `flux-fill` even though the wire model is Qwen-Image-2.1-Pro | `src/lib/inference.ts:48`, `src/lib/alibaba-adapter.ts:111` |
| Wire mode | **instruction-mode** — DashScope multimodal-conversation, image + text; `mask_url` **ignored** | `src/lib/alibaba-adapter.ts:198-224`, `src/lib/prompts.ts:416`, `:448-455` |
| Output size | `2048*1536` | `src/lib/alibaba-adapter.ts:221` |
| What is sent | the **whole canvas** snapshot, not a masked crop; the mask is a client-side artefact | `src/components/edit-room/CanvasStage.tsx:96` |
| Is the output composited back under the mask locally? | **No** — no local composite exists; the provider's full-frame output is what the user sees | `src/lib/inpaint-output.ts` (no mask handling), `src/lib/inpaint-submit.ts:375-417` |
| Price | **~$0.04/image** | `src/lib/api-quota.ts:39`; `bake-off/RESULTS.md:15` |
| Measured latency | **38.0 s / 32.1 s / 33.7 s** per case at 2048×1536 | `bake-off/RESULTS.md:15` |
| Code comment on latency | "synchronous and takes ~30s" (hence `maxDuration = 60`) | `src/app/api/inpaint/route.ts:26-35` |
| Cost guardrails that exist today | daily inpaint cap **20/user/day** (`DAILY_INPAINT_LIMIT`); per-provider circuit breaker (3 failures / 30 s cooldown); submit retry with backoff; provider-job cancel on post-submit write failure; a spend guard that fails the build if a route calls a paid inference helper outside the abstraction | `src/lib/api-quota.ts:54`, `:67-68`; `src/lib/alibaba-adapter.ts:182-184`; `src/lib/inpaint-submit.ts:75-146`; `src/lib/inference.ts:228-231`; `src/lib/fal-spend-guard.ts` |
| Existing **routing** code | **none** — no vendor-choice, no per-request provider selection, no cost-aware dispatch anywhere in `src/` | `src/lib/inference.ts:14-17` ("the flag is for incidents and A/B tests, not for splitting traffic on a per-request basis") |

### 3.2 Premise correction, stated plainly

> Issue #1478 says: *"we currently route everything through one vendor/model (fal.ai FLUX.1 Fill)"*.

- **Stale part:** it is **not** fal.ai FLUX.1 Fill. fal's adapter and `lib/fal.ts` were deleted in #1240 and selecting them throws (`src/lib/inference.ts:295`, `:326`); the production provider is **Alibaba Cloud DashScope `qwen-image-2.1-pro`** (`src/lib/alibaba-adapter.ts:111`, `.env.example:41`). FLUX.1 Fill survives only as a legacy payload builder (`src/lib/prompts.ts:369-397`) and as a historical bake-off slot (`bake-off/RESULTS.md:11`).
- **Still-true part:** we *do* send every edit to **one** provider/model — there is exactly one wired adapter, one logical model, and no per-request dispatch. So the structural premise ("single-vendor, no routing") holds; only the vendor/model identity was stale.
- **Second consequence of the correction:** the issue's suggested follow-up ("router model-agnosticism **in front of our endpoints**") has a smaller surface than the issue assumes. There is no endpoint *set* to sit in front of — there is one DashScope endpoint and one model id, and the only other candidates we have ever measured were **fal-hosted** models (`bake-off/RESULTS.md:11-19`), i.e. a vendor we deliberately retired.

### 3.3 Our candidate inventory (what a router could choose between, today)

Measured in our own bake-off, run 2026-10-12 (`bake-off/RESULTS.md`, `bake-off/drift-results.md`):

| Slot | Vendor | Mode | Latency | Price | Mask-complement drift | Available today? |
|---|---|---|---|---|---|---|
| `qwen-image-2-1` (**current**) | alibaba | instruction | 32.1–38.0 s @2048×1536 | **$0.04/image** | 0.000 (byte-identical at fixed seed) | **yes — the only wired provider** |
| `z-image-turbo-inpaint` | fal | mask-fill | 8.4 s @2000×1328 | $0.01/MP | ~0.04–0.11 | no — fal retired |
| `flux-kontext-lora-inpaint` | fal | mask-fill | 16.5–18.6 s | $0.035/MP | ~0.039 | no — fal retired |
| `flux-pro-fill` | fal | mask-fill | 16.7–22.7 s | $0.05/MP | ~0.006 | no — fal retired |
| `nano-banana-2-1` | fal | instruction | 14.6–18.6 s | $1 (sentinel row) | 0–36 (half-deterministic) | no — fal retired |
| `seedream-5-flash` | fal | instruction | 20.6–145.1 s | $0.027/image | 28–34 | no — fal retired |
| `flux-pro-kontext` | fal | instruction | 6.3–12.4 s | $0.04/image | not published (instruction mode) | no — fal retired |

**Reading of the inventory (the decisive fact for this evaluation):** the only *mask-honoring* candidates we have measured live on the **retired** vendor, and the only *live* candidate is the **instruction-mode** one. A router over "our endpoints" would therefore have to choose between (a) nothing, or (b) re-introducing fal — a vendor decision (licence/ToS/ops), not a routing decision.

---

## 4. Applicability verdict: is the router model-agnostic enough to sit in front of our endpoints?

**Answer: no — not as a router artefact, and not today as a routing decision.** Three separate reasons, each sufficient on its own:

1. **The router's *interface* is generic; its *weights* are not.** The formulation is candidate-agnostic in principle: any ordered candidate list, any editor, a score vector of length K (paper §3.1, Eq. 3). But the head is trained on one specific pool (FLUX.2 Klein 4B/9B, FLUX.1-Kontext-dev, OmniGen2, Qwen-Image-Edit — paper §4.1) and the paper explicitly lists "dynamically evolving pools … without extensive retraining" as **future work** (§5). Nothing is published that could be re-pointed at `{qwen-image-2.1-pro, qwen-image-2.1-turbo, qwen-image-2.0-pro}` or at a re-wired fal set.
2. **There is no artefact to sit in front of anything.** The paper publishes **no code and no checkpoint**; the HTML render contains no appendix. Even a "we'll train our own" path needs the training set, the judge protocol, and a GPU — none of which exist in this repo.
3. **Our request shape is instruction-mode, which superficially fits the paper — but our *candidate set* has no mask-honoring member that is live.** The router would be choosing between editors that differ in a property the router does not model at all: **mask-honoring vs mask-less**. The paper's supervision signal (an MLLM judge scoring editing success / preservation / naturalness / artifacts, §3.3) contains no "did it respect the painted region" term, and its candidate pool is instruction-mode editors on image+instruction benchmarks (the paper states no mask channel anywhere in §3.1–§3.3). A learned preference head over such candidates cannot, on its own, protect our mask-locked contract; that would need a **hard capability gate** (route only to mask-honoring editors), i.e. a rule-based router — which is a different (and much simpler) thing than EditJev.

**Where the paper *does* fit our architecture, honestly stated:** our request already contains exactly the two things the router consumes — the source image and the instruction prompt (`src/lib/inpaint-submit.ts:381-399` builds `imageUrl` + `buildInpaintPrompt(...)`), and our per-candidate mean latencies are measurable (the bake-off table above). So the *inputs* for a router exist in our code. The *pool*, the *labels*, the *artefact* and the *evaluation* do not.

---

## 5. Per-request cost / latency / quality estimate, mapped to OUR pipeline

### 5.1 Our baseline (repo-measured)

| Quantity | Value | Source |
|---|---|---|
| Price per edit | **$0.04/image** | `src/lib/api-quota.ts:39`; `bake-off/RESULTS.md:15` |
| Latency per edit | **32.1 s / 33.7 s / 38.0 s** (2048×1536) | `bake-off/RESULTS.md:15` |
| Latency, code comment | "~30s" synchronous | `src/app/api/inpaint/route.ts:26-28` |
| Worst-case daily spend per user | **$0.80/day** (20 × $0.04) | `src/lib/api-quota.ts:39-41`, `:54` |
| Model's own determinism | byte-identical across runs at a fixed seed | `bake-off/drift-results.md` |

### 5.2 What a router would cost and save, per request, in our units

| Line | Estimate | Basis |
|---|---|---|
| **Router overhead — local EditJev-style (0.094 s)** | **+0.094 s** per edit (~0.3 % of a 32–38 s edit) — good latency, **cost not computable**: paper price **not published**, and we have no GPU/GPU rate card to host it | paper Table 1 (0.094 s) + paper §4.1 (RTX PRO 6000) + absence of any GPU rate in this repo |
| **Router overhead — API MLLM router** | **+4.39 s to +17.68 s** per edit (**≈ +12 % to +55 %** of a 32.1–38.0 s edit) — this is the *paper's own* router comparison set (GLM-5.3-Flash 4.39 s … Gemini-3.7-Flash 17.68 s; GPT-5.5 11.85 s) | paper Table 1 latency column; our baseline from `bake-off/RESULTS.md:15` |
| **Router API cost per request** | **not published** by the paper; our only published MLLM price point is `gpt-4o-mini` at ~$0.0002/generation (`src/lib/api-quota.ts:40-41`) — **not** a router quote, listed only as the nearest repo anchor | paper (silent) + `src/lib/api-quota.ts:40-41` |
| **Saving from routing — K = 1 (today)** | **$0.00/image and 0.0 s/edit** — with one wired candidate there is nothing to choose; every request pays the same $0.04 and the same 32–38 s | `src/lib/inference.ts:318-333`; `src/lib/alibaba-adapter.ts:106-121` |
| **Saving from routing — if a cheap mask-fill candidate were live** | ≈ **$0.013/image** and ≈ **24 s/edit** (a *perfect* router always picking the cheapest mask-honoring slot: $0.04 → ~$0.027 at $0.01/MP × 2.66 MP, and 32–38 s → 8.4 s) | **assumption**, layered on `bake-off/RESULTS.md:15` and `:17`; requires (a) fal re-wiring, (b) a correct route every time, (c) negligible router overhead. **Not a measurement.** |
| **Quality delta from routing (per paper)** | **+0.052** ImgEdit aggregate (4.540 → 4.592) and **+0.061** GEdit-En (8.194 → 8.255) over the *best fixed* editor — ≈ +1.1 % / +0.7 % relative | paper Tables 1–2; relative % **derived** |
| **Quality delta from routing (mapped to our metric)** | **not published / not mappable** — the paper reports no pixel-drift, region-conservation or mask-honouring metric, so the +0.052 aggregate cannot be translated into our out-of-mask drift units | paper §4.1 metric list (judge scores only) vs `src/lib/edit-conservation.ts`, `scripts/bake-off-drift-test.mts` |
| **Headline latency claim, re-based on us** | the paper's "−60.8 % end-to-end latency" is **56.90 s → 22.33 s**, i.e. against a *self-hosted 56.90 s fixed editor*. Our edit is 32.1–38.0 s hosted at $0.04/image. **The percentage does not transfer**; re-basing it would require the candidate-set generation times we do not have (our only other candidates are fal-hosted and retired) | paper Table 3 + `bake-off/RESULTS.md:15` |
| **Demo-traffic volume** | **not published** in this repo — there is no measured requests/day figure for the demo, only the per-user daily cap of 20 (`src/lib/api-quota.ts:54`). Any "$ saved per demo day" number would be an assumption; at the cap the theoretical ceiling is **$0.80/user/day** and **20 edits × 32–38 s** | `src/lib/api-quota.ts:39-54`; no traffic measurement found in `docs/` |

### 5.3 Reading of §5

The economics do not currently exist. **The only line item in this table that is a measured fact about our traffic is $0.04/image and 32–38 s/edit**; everything that would improve them is gated on (a) re-wiring a second provider, and (b) a router artefact that nobody has published. The paper's own numbers show the *shape* of the prize (a large latency win against a slow fixed baseline) but not its size against a $0.04, 35-second hosted edit that is already near the floor of what an API image edit costs.

---

## 6. Quality-risk notes (what a wrong route would do to our inpainting step)

1. **The wrong route for a mask-locked fill is a whole-room re-render.** Our current provider is instruction-mode and the mask never reaches the wire (`src/lib/prompts.ts:416`, `:448-455`); the full canvas is uploaded (`src/components/edit-room/CanvasStage.tsx:96`) and the provider's full-frame output is what the user gets (no local composite under the mask). If a router sends a request to a **mask-less** editor, the "unedited" room is regenerated by that editor. Measured consequence from our own bake-off (mask-complement mean RGB delta, `bake-off/drift-results.md`): instruction-mode slots **28–34** (seedream-5-flash), **~52** (seedream-5-pro), **0–36 and half-deterministic** (nano-banana-2-1) versus mask-fill slots **~0.006** (flux-pro-fill), **~0.04–0.11** (z-image-turbo-inpaint), **~0.039** (flux-kontext-lora). A wrong route therefore moves the room by tens of RGB levels — walls, floor, window frames, skirting — which is precisely what `src/lib/edit-conservation.ts` (region conservation) and `src/lib/inpaint-quality-gate.ts` (advisory `architecture_risk`) exist to catch.
2. **Do not misread our own 0.000 drift figure.** `qwen-image-2.1`'s **0.000 mean / 0 max** delta is *byte-identical reproducibility at a fixed seed*, **not** evidence that the unedited region was preserved — the mask was never sent (`bake-off/drift-results.md`, "Qwen-Image-2.1 is perfectly reproducible with a fixed seed"). A router would not make that better; it would add a second, differently-behaving generator to the same contract.
3. **Routing error rate vs quality headroom.** The paper's own human study puts EditJev's agreement with the human-preferred model at **81.75 %** (paper Table 7) — i.e. it disagrees on **~18 %** of judgments — while its aggregate gain over the best fixed editor is **+0.052** (paper Table 1). A per-request picker with a ~18 % disagreement rate and a ~1 % aggregate upside is a poor trade **if** a wrong pick costs a full-room regeneration (item 1) and a paid retry.
4. **The speed term deliberately spends quality.** `β` trades score for latency (paper §4.3: `β` 0.4 → 1.0 gives 26.79 s → 17.73 s for 4.5966 → 4.5667). On our pipeline the latency prize is small (we are not choosing between a 57 s and a 22 s editor — we have one editor at 32–38 s), so any `β > 0` applied to our traffic would be **paying measurable quality for latency we cannot realise**.
5. **Cost-of-failure on a wrong route.** Every wrong route is a **paid** request: $0.04 billed before we know the output is wrong (`src/app/api/inpaint/route.ts:324-330` notes the provider already billed us), then a user-initiated retry is another $0.04. Routing multiplies the number of paid attempts per successful edit; our current daily cap of 20/user/day (`src/lib/api-quota.ts:54`) is a **volume** guardrail, not a **quality** guardrail, and would not stop a wrong route from consuming the user's whole cap.
6. **No conservation guarantee is model-agnostic.** Our out-of-mask conservation machinery is a **post-hoc measurement** (`src/lib/edit-conservation.ts`), i.e. it can flag a bad edit but not prevent it. Routing widens the distribution of possible outputs without any of that machinery changing.
7. **Silent-stale-name hazard.** If a router were ever added, the logical model name `flux-fill` (`src/lib/inference.ts:48`) would misdescribe the candidate set (Qwen-Image-2.1-Pro), and the payload builder would still branch on `INFERENCE_PROVIDER` (`src/lib/prompts.ts:545-553`) rather than on the routed candidate — a class of bug the existing `tests/prompts.test.ts` pins for the legacy path only.

---

## 7. Recommendation

**SKIP** — do not adopt, do not adapt, do not spike. Rationale, in order of weight:

1. **Nothing to adopt.** No code, no checkpoint, no training data, no price (paper: *not published*). Adopting "EditJev" would mean re-implementing the paper's training pipeline, not using the paper.
2. **Nothing to route between.** One wired provider, one logical model (`src/lib/inference.ts:318-333`; `src/lib/alibaba-adapter.ts:106-121`). A router over K = 1 saves $0.00 and 0.0 s per request.
3. **The candidate pool we would need is on a retired vendor.** Every mask-honoring candidate we have measured is fal-hosted (`bake-off/RESULTS.md:11-18`), and fal was deliberately retired in #1240. Re-introducing it is a vendor/licence/ops project, and it is *not* what issue #1478 asks for.
4. **The measurable upside in our units is small and unproven.** The paper's gain over the best fixed editor is **+0.052 aggregate** (Table 1) — about 1 % — and the paper's headline latency win is measured against a **56.90 s self-hosted** baseline, not our 32–38 s, $0.04 hosted edit. We would be trading a known, measured, deterministic pipeline for a ~1 %-scale, unmeasured-in-our-units gain.
5. **The downside is asymmetric.** A wrong route on our instruction-mode pipeline can regenerate the whole room (measured drift 28–52 for mask-less slots) and is paid for at $0.04 a pop.

**Conditions that would change this call** (revisit as a *new* issue, not this one — all must hold):

- **Two or more live, mask-honoring candidates.** Concretely: a second provider adapter wired behind the existing `InferenceClient` interface (`src/lib/inference.ts:157-231`) with a published per-image price and a measured mask-complement drift, so a routing decision has a real spread to exploit. (Without mask-honouring candidates, the router's own selection rule must be replaced by a hard capability gate, which is a rule-based router, not EditJev.)
- **A router artefact, or the budget to train one.** Either the authors publish code + weights + training data (they currently publish none), or we accept training a Qwen3-VL-class router ourselves — which requires a GPU this repo does not have, a pairwise-label corpus, and an MLLM judge; on today's evidence (paper §3.3, §4.3) the judge and the gap threshold `δ` are the two knobs that decide the label quality.
- **A routing evaluation in OUR units**, before any routing is enabled: per-request price, seconds per edit, and **out-of-mask drift via `scripts/bake-off-drift-test.mts`** on `bake-off/befores/`, plus the existing advisory gate — the paper reports none of these metrics, so they must be produced locally (which costs paid API calls; that spend is out of scope for this issue).
- **A latency justification that survives our baseline.** The prize is only real if the candidate pool contains editors materially faster *and* cheaper than 32–38 s / $0.04 (the retired `z-image-turbo-inpaint` slot at 8.4 s / $0.01/MP is the shape of that, `bake-off/RESULTS.md:17`). If the spread is ~$0.004 and ~2 s, the paper's β-weighted selection rule (§3.2, Eq. 5) has nothing to work with.

**If those conditions were met, the cheapest sensible first step would not be EditJev**: it would be a **rule-based, capability-gated dispatch** (mask-honouring first, cheapest-measured-second, hard fallback to the current provider) behind the existing `InferenceClient` seam, evaluated with our own drift harness. That is a *different* design from the paper's learned preference head, and it is what §7's conditions would justify — EditJev itself remains unnecessary until a candidate pool exists **and** the learned part measurably beats the rule.

**What a real benchmark would have required (and was NOT run):** a second wired provider; a trained router (GPU); a pairwise-label corpus with an MLLM judge; a paid A/B over ≥3 fixtures × ≥3 candidates (≈ $0.04–$0.05 per image per slot ⇒ ~$0.4 per round per fixture, **assumption**: 3 candidates × 3 cases × $0.04); drift runs on `bake-off/befores/`; and human review of mask-locked fills. Per this issue's hard stops, **none of it was performed**; this is recorded as a finding, not a result.

---

## 8. What this issue did **not** do

- ❌ No paid API call (no Alibaba DashScope, no fal, no OpenAI, no hosted image model).
- ❌ No GPU workload; this VM has no GPU and the paper's cheap router needs one (paper §4.1).
- ❌ No benchmark, A/B, drift run or quality comparison was executed — every quality/cost number above is quoted from the paper, measured by the repo, or labelled an assumption.
- ❌ No source, config, workflow, prompt, provider or product/demo change. **This document is the entire deliverable.**
- ❌ No attempt to train, port or approximate the router.

---

## 9. Sources

**Paper** (full text read from the arXiv HTML render, fetched **2026-10-28**):

- arXiv:2610.32635v1 — *EditJev: System One Routing for Image Editing Models*, Zhile Guan, Xu Jiang, Yule Duan, Gongbo Zhang, Shuyu Wang, Xiao Chen, Jian Zhang (Peking University / Tsinghua University), submitted 23 Oct 2026. <https://arxiv.org/abs/2610.32635> · HTML render <https://arxiv.org/html/2610.32635v1>.
- Cited inside this doc: Abstract; §1 (contributions, −60.8 % / −31.7 % latency); §2.2 (model routing); §3.1 (Eq. 1); §3.2 (Eqs. 2–5, preference head, speed score, `β`); §3.3 (Eqs. 6–9, pairwise ranking, `δ = 0.5`); §4.1 (Qwen3-VL-4B-Instruct backbone, candidate pool, `β`, RTX PRO 6000, 20 requests / 5 requests, ImgEdit 737 + GEdit-En 606, GPT-5.1 judge); §4.2 + Tables 1–3 (quality, routing latency, end-to-end latency); §4.3 + Tables 4–6 + Fig. 4 (ablations, `β` sweep 26.79 → 17.73 s); §4.4 + Table 7 (81.75 % / 34.50 %, ρ = 0.7478); §5 (future work: dynamically evolving pools without extensive retraining); References.
- **Not published** in the reachable text: price/cost figures, code, checkpoints, router training-set composition, router VRAM, per-candidate generation times as a table (only aggregates and the speed-weight curve are given). The HTML render contains **no appendix section**.

**Repo** (this worktree, base `origin/develop` @ `f31cdad`):

- `src/lib/inference.ts:1-18` (provider-agnostic abstraction; "not for splitting traffic on a per-request basis"), `:48` (`LOGICAL_MODEL.FLUX_FILL`), `:65`, `:72-88` (`resolveProvider`), `:157-231` (`InferenceClient`), `:295`, `:326` (fal/replicate retired → throw).
- `src/lib/alibaba-adapter.ts:73`, `:94-99`, `:106-121` (`resolveAlibabaModel`, default `qwen-image-2.1-pro`), `:158`, `:182-184` (circuit breaker 3 / 30 s), `:198-224` (DashScope body, `size: "2048*1536"`), `:332`, `:400`.
- `src/lib/prompts.ts:332-352` (`buildInpaintPrompt`), `:369-397` (legacy fal FLUX.1 Fill payload — historical), `:416` ("Alibaba is instruction-mode; mask_url is ignored"), `:448-455` (`buildAlibabaFillPayload` → `{image_url, prompt}`), `:539-554` (provider-branch payload builder).
- `src/lib/inpaint-submit.ts:75-146` (submit retry), `:320-333` (quality gate), `:375-417` (`submitInpaintToActiveProvider`, `:382` prompt build, `:390` `getInferenceClient`).
- `src/app/api/inpaint/route.ts:26-35` ("~30s", `maxDuration = 60`), `:301`, `:324-330` (fire-and-forget submit; provider already billed).
- `src/lib/inpaint-status.ts:431` (`pollInpaintStatus`).
- `src/lib/api-quota.ts:39-41` (~$0.04/image, ~$0.0002/generation, ~$0.95/user/day worst case), `:54` (`DEFAULT_DAILY_INPAINT_LIMIT = 20`), `:67-68` (`DAILY_INPAINT_LIMIT`).
- `src/lib/fal-spend-guard.ts` (spend guard; notes fal is no longer a wired provider), `src/lib/circuit-breaker.ts`, `src/lib/edit-conservation.ts`, `src/lib/inpaint-quality-gate.ts`, `src/lib/mask-*.ts`.
- `src/components/edit-room/CanvasStage.tsx:96` (full-canvas snapshot), `src/lib/inpaint-output.ts` (no mask compositing).
- `bake-off/RESULTS.md:11-19`, `:23-49` (per-slot latency/price, run 2026-10-12), `bake-off/drift-results.md` (mask-complement drift per slot; Qwen byte-identical reproducibility; "Architectural constraints" — instruction-mode models cannot honour the painted mask), `bake-off/befores/` (fixtures).
- `scripts/bake-off-drift-test.mts` (our drift methodology), `.env.example:41` (`ALIBABA_INPAINT_MODEL=qwen-image-2.1-pro`), `AGENTS.md` (provider + env-var conventions, `ALIBABA_INPAINT_MODEL` overrides).
- House style / prior conclusions: `docs/1480-inversion-free-single-evaluation-evaluation.md` (#1480), `docs/one-step-editing-evaluation.md` (#1444), `docs/lenserase-removal-evaluation.md` (#1445), `docs/1446-abacus-dcr-sam-qk-edit-evaluation.md` (#1446), `docs/1458-soft-matte-evaluation.md` (#1458, same premise-correction pattern).
