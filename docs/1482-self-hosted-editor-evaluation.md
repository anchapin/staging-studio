# Self-Hosted Editor vs the API Edit Path — economics / speed / quality (region freezing + step caching) — evaluation for staging-studio

**Issue:** [#1482](https://github.com/anchapin/staging-studio/issues/1482) — "[paper] Evaluate self-hosted editor economics/speed/quality vs API (region freezing + step caching)".
**Paper:** *Freeze What Is Settled, Cache What Is Smooth: Spatial Freezing Keeps Step Caching in Its Low-Error Regime*, arXiv:2610.34177v1 (cs.CV), submitted 25 Oct 2026, Baiyan Li and Ganxuan Yang — Lancaster University + Beijing Jiaotong University. arXiv licence: arXiv non-exclusive distribution licence 1.0 (i.e. no code/weight licence is granted by the paper). "10 pages, 7 figures" (paper metadata).
**Date:** 2026-10-28
**Status:** Desk evaluation only — **no code, config, workflow or demo change lands from this issue.** No GPU job was run, no model weights were downloaded, no paid image API call was made, and **no rendered prototype, benchmark run or latency measurement of our own is claimed anywhere in this document**. Every number below is either quoted from a cited source (with location), read from this repo's committed artefacts (with file and line), or explicitly labelled an assumption.
**House style:** follows `docs/1481-grounded-exploration-evaluation.md` (#1481), `docs/1480-inversion-free-single-evaluation-evaluation.md` (#1480), `docs/1477-geometry-consistent-defurnishing-evaluation.md` (#1477), `docs/1478-editjev-routing-evaluation.md` (#1478), `docs/1458-soft-matte-evaluation.md` (#1458).

---

## 0. TL;DR — verdict: **SKIP** (self-hosting now); one licence-first follow-up issue (§7)

- **The issue's parenthetical names a real paper, and we found it.** "Region freezing + step caching" is the subject of **arXiv:2610.34177** (*Freeze What Is Settled, Cache What Is Smooth*), which proposes **FreezePlan**: freeze the tokens an edit leaves untouched, spend the saved budget on a conservative step cache (DBCache + first-order TaylorSeer), and run **5.05×** faster than the dense 40-step output at **29.8 dB PSNR** to that output with **no significant VLM-judge drop** (paper abstract, §IV-B Table II). All of the paper's measurements are on **Qwen-Image-2.1** — the same model family our API path serves today.
- **The paper is an acceleration paper for *self-hosted* inference; it does not compare to API economics.** The paper never prices anything (its own per-image cost is **not published**) and never benchmarks a hosted endpoint. The economics/speed/quality-vs-API comparison the issue asks for is therefore **ours to make**, and this document makes it from repo artefacts plus cited external sources.
- **The decisive blocker is a licence, not an arithmetic.** The open weights of the paper's model (**`Qwen/Qwen-Image-2.1`** on Hugging Face) are published under the **Qwen RESEARCH LICENSE AGREEMENT** — "use … **FOR NON-COMMERCIAL PURPOSES ONLY**", with commercial use requiring "a separate commercial license" on request (§2.a/§2.b of that licence). **The commercial price is not published.** This matches our own bake-off note that the fal-hosted Qwen slot was "flagged Private/research-only" and that a "commercial grant from Alibaba" was required before production (`bake-off/RESULTS.md:39`, `bake-off/drift-results.md:79-83`). Until that grant exists, the entire self-hosted cost model is hypothetical.
- **The method's own fallback lands on our flagship flow.** FreezePlan decides the frozen region from the model's own change statistics (`‖x̂₀ − ref‖` above median + 2×MAD) and **falls back to dense inference when the edit is global** (paper §III-E). On the paper's own pre-registered split the fallback fired on **11/44 samples (25 %)** (paper §V(1)). Our hero beat is *"Stage entire room"* — a global edit (`docs/DEMO_SCRIPT.md`, beat 3) — i.e. exactly the case the paper gives up on. The speed win therefore does **not** reliably apply to the flow we would most want to accelerate.
- **Region freezing is not "honouring our painted mask".** Our editor paints a mask and it is the strongest control we have — but the mask **never reaches the model** today (`src/lib/prompts.ts:416`, `bake-off/drift-results.md:62-68`), and FreezePlan's frozen region is model-internal, not our mask. Freezing buys *speed*, not *mask fidelity*. Conflating the two is the main mis-read this issue invites.
- **Our API path is already inside the demo budget with zero new infra.** `qwen-image-2.1-pro` on Alibaba DashScope: **$0.04/image**, **32.1–38.0 s** at 2048×1536 (`bake-off/RESULTS.md:15`), daily cap 20 inpaint/user/day ⇒ **≈ $0.80/user/day** worst case (`src/lib/api-quota.ts:37-46`, `:54`), against a **≤90 s** live-result rule (`docs/DEMO_SCRIPT.md:24`).
- **If the licence were granted, the marginal arithmetic would favour self-hosting, but the fixed cost dominates at our volumes.** At the Runpod community rate for an RTX 4090 (**$0.89/hr**, pricing page fetched 2026-10-28) and the paper's own dense figure (**24.5 s per 1024-px edit**), the marginal GPU cost is **≈ $0.006/image** dense and **≈ $0.001/image** at 5.05× — **assumption-based** (§4). Against $0.04/image the break-even is around **~19 000 images/month** on one always-on GPU (§4, arithmetic shown, every input labelled).
- **Call: SKIP.** Do not move the edit path to a self-hosted editor, and do not implement FreezePlan. **Next step (a follow-up issue, not this one): a licence-first probe** — ask Qwen/Alibaba for commercial terms for the weights (price today: not published), measure our *real* monthly edit volume from the DB rather than assuming the quota cap, and only then run one small offline bake-off of the open weights with **step caching only** (the region-freezing implementation is not published) against our own fixtures (§7).
- **What was NOT done:** no GPU run, no weight download, no paid API call, no rendered image, no benchmark, no pipeline change. Every number below is quoted with a source, read from a repo file, or labelled an assumption.

---

## 1. Scope, method, evidence rules

**The referenced draft is not available.** The issue body points at a draft at `/tmp/staging_issue6.md`. That file is **not present on this machine**, so it could not be read. The scope of this evaluation is therefore defined from the **issue title** plus **repo evidence** (the wired edit path, the committed bake-off artefacts, the demo script, the quality gates). Nothing in this document pretends to have read that draft.

**Ambiguities found in the title, reported rather than guessed away:**

1. **"Self-hosted editor" is undefined in the issue.** We take the concrete meaning to be: *the image-editing model runs on hardware we (or a contractor under our control) operate, instead of on a hosted provider's endpoint* — with the repo's own provider seam (`InferenceClient`, `src/lib/inference.ts:19-33`) as the integration point. This is the same reading the repo used in its two prior self-hosting evaluations (`docs/1477-geometry-consistent-defurnishing-evaluation.md:99`, `docs/1458-soft-matte-evaluation.md:168`).
2. **The parenthetical is a method name, not an evaluation axis.** The paper behind "region freezing + step caching" is an *inference-acceleration* paper (§3). It reports no price, no hosted-endpoint comparison and no business case; "economics vs API" is our work, not the paper's. We label the paper's contribution "paper-reported" throughout and keep our own derivation visibly separate.
3. **"the API" means our current production edit path**, which is Alibaba DashScope `qwen-image-2.1-pro` — *not* the fal-hosted Qwen slot of the bake-off and *not* the retired FLUX Fill incumbent (§2.1). The bake-off row for `qwen-image-2-1` is our measurement **of that same model**, routed through the same Singapore endpoint, so it is the right anchor; the fal-hosted variant of the same weights was "flagged Private/research-only" and is not what we run.

**Evidence rules applied (same as the sibling evaluations):**

1. Every claim about **this repo** cites a file in this worktree (with a line number where it matters). Every claim about **the paper** cites arXiv:2610.34177 plus its own section/table/appendix and is labelled **paper-reported**. Every claim about **the outside world** cites a URL plus the location on that page and the fetch date.
2. **No second-hand summaries were used** for any load-bearing claim. The paper was read from the arXiv abstract page and the arXiv HTML render (`https://arxiv.org/abs/2610.34177`, `https://arxiv.org/html/2610.34177v1`, fetched 2026-10-28). Model licences were read from the Hugging Face model repository's own `LICENSE` file and API metadata (`https://huggingface.co/Qwen/Qwen-Image-2.1`, `https://huggingface.co/api/models/...`, fetched 2026-10-28). GPU prices were read from the provider's own pricing page (`https://www.runpod.io/pricing`, fetched 2026-10-28). Implementation availability was read from the project's own repository metadata and README (`https://api.github.com/repos/vipshop/cache-dit`, `https://raw.githubusercontent.com/vipshop/cache-dit/main/README.md`, fetched 2026-10-28).
3. **Where a source publishes nothing, the cell says "not published".** Applied to: the commercial price of the Qwen weights (§3.3), the paper's own $/image cost (§4), the paper's hardware memory figure (§5, contradiction), the exact pixel count behind the paper's "1024-pixel edit" (§4).
4. **Repo-measured numbers outrank any external claim.** Where the two disagree — e.g. the same model's latency in the bake-off vs the drift run — **both are quoted and the disagreement is flagged**, not averaged away (§2.3, §5).
5. **Nothing was benchmarked, rendered, or executed for this document.** No paid endpoint was called; no model was run; no weights were fetched.

**Limits of this pass.**

- The paper's benchmark is **GEdit-Bench (English part, 11 edit types)**, 44 samples per split, **one seed**, judged by a **local Qwen3-VL-8B** — not a commercial judge (paper §IV-A, §V(5)). GEdit-Bench is a *general editing* benchmark; staging (whole-room restaging, furniture-anchored replacement) is not in it. Its absolute PSNR/dB and VLM numbers are **not** transferable to staging.
- The paper reports **no cost figures and no hosted-API comparison at all** (§4).
- We have **no GPU**, no self-host adapter, and no GPU on-call owner in this repo (`src/lib/inference.ts:9-13`, `docs/1477-geometry-consistent-defurnishing-evaluation.md:99`, `docs/1458-soft-matte-evaluation.md:18`).

---

## 2. The API path as actually wired in this repo

### 2.1 Provider, model, plumbing

| Aspect | What the repo actually does | Citation |
|---|---|---|
| Provider selection | `INFERENCE_PROVIDER`; the literal `"alibaba"` is the **only** wired provider; `"fal"` / `"replicate"` are parsed but **throw at configure time** so a stale deploy surfaces the issue | `src/lib/inference.ts:60-83`, `:289-326` |
| Logical model names | `LOGICAL_MODEL.FLUX_FILL` / `LOGICAL_MODEL.SAM_3_1_IMAGE` — call sites pass logical names, the adapter resolves the provider-specific id | `src/lib/inference.ts:46-53` |
| Adapter surface | `subscribe` / `submit` / `status` / `result`; "Adding a future provider … is a new adapter file plus one switch arm in `resolveProvider` / `getInferenceClient`" | `src/lib/inference.ts:9-33` |
| Model in production | `qwen-image-2.1-pro` on Alibaba Cloud Model Studio, Singapore endpoint, multimodal-generation surface | `docs/vendor-investigation/1240-bakeoff-oct-2026.md` §2; `bake-off/RESULTS.md:39` |
| Wire payload | `buildAlibabaFillPayload` returns **`{ image_url, prompt }` — and nothing else** | `src/lib/prompts.ts:443-455` |
| Provider knobs | `seed` / `strength` are threaded by the adapter into DashScope's `parameters` block; `guidance`, `num_inference_steps`, `negative_prompt` are **not** exposed on this path | `src/lib/prompts.ts:404-441`, `src/lib/alibaba-adapter.ts` |
| Sync vs queue | **Synchronous** — one round trip, the result URL is returned inline in the POST response | `docs/vendor-investigation/1240-bakeoff-oct-2026.md` §2 |
| Spend control | daily inpaint quota, **20/user/day**, claimed *before* submit and refunded on pre-submit failure; a post-submit row-write failure keeps the unit because "Alibaba already billed us, ~$0.04/image" | `src/lib/api-quota.ts:54`, `src/app/api/inpaint/route.ts:301-345` |
| Prompt construction | `buildInpaintPrompt` appends `FRAMING_CONTEXT`; a fixed `NEGATIVE_PROMPT` (walls, windows, trim, doors, molding, structural columns…) is the architecture-preservation instrument | `src/lib/prompts.ts:26`, `:34`, `:343-350` |

### 2.2 How masks travel — they do not

The client **does** send a mask: the inpaint route reads `maskUrl` from the request and hands it to the payload builder (`src/app/api/inpaint/route.ts:301`). The Alibaba payload builder then **drops it** — the input field is documented as *"Alibaba is instruction-mode; `mask_url` is ignored by the model"* (`src/lib/prompts.ts:416`), and the emitted payload is `{ image_url, prompt }` only (`src/lib/prompts.ts:443-455`).

Our own bake-off says the same thing in plain words: the top visual picks "take `image_urls: [...]` and a prompt, with no `mask_url` field. **The mask rectangle the staging editor paints cannot be communicated to them on the wire.**" (`bake-off/drift-results.md:62-68`).

What carries the load instead, on our side, is a stack of compensations:

- **mask dilation** (isotropic `DEFAULT_MASK_EXPANSION_RADIUS = 15` px plus an anisotropic variant) and **mask post-processing / feathering** (browser-side pre-upload) — the modules live in `src/lib/` and are described in `docs/vendor-investigation/1240-bakeoff-oct-2026.md` §3.1 ("isotropic (DEFAULT_MASK_EXPANSION_RADIUS=15px) and anisotropic", "Mask feathering is now a browser-side pre-upload pass");
- **`FRAMING_CONTEXT`** appended to every edit prompt — `src/lib/prompts.ts:34`, `:343-350`;
- **the negative prompt** — `src/lib/prompts.ts:26`;
- **advisory gates after the fact** — the OpenAI inpaint quality gate (`src/lib/inpaint-quality-gate.ts:1-25`) and the deterministic edit-conservation measures (`src/lib/edit-conservation.ts:1-27`).

**Consequence for this issue:** on the *current* path, a hand-painted mask is a **prompt-shaping and post-hoc-check device, not a conditioning channel**. Anything the issue calls "region freezing" must be judged against that fact, not against an imagined mask honouring API.

### 2.3 Repo-measured latency / cost / drift artefacts

All of these are our own committed artefacts; they are the strongest evidence in this document.

| Measurement | Value | Citation |
|---|---|---|
| Price, active model | **$0.04 / image** (Alibaba commercial terms, Singapore) | `bake-off/RESULTS.md:15`, `:39` |
| Latency, active model | **38.0 s** (vacant-insert), **32.1 s** (occupied-replace), **33.7 s** (repeat-stability), output **2048×1536** | `bake-off/RESULTS.md:15`, `:40-42` |
| Latency, same model, drift run | **~66 s** | `bake-off/drift-results.md:29` |
| Drift outside the painted rectangle, same model | mean delta **0.000**, max delta **0** over 728 224 unedited pixels — "every output pixel byte-identical across runs" | `bake-off/drift-results.md:29`, `:33-37` |
| Cost of the mask fill alternative we dropped | `flux-pro-fill` **$0.05/MP**, 16.7–22.7 s; `z-image-turbo-inpaint` **$0.01/MP**, 8.4 s, mask capable | `bake-off/RESULTS.md:11`, `:17`, `:47` |
| Our spend ceiling | 20 inpaint/user/day ⇒ **≈ $0.80/user/day**, "worst case per user ≈ $0.95/day (~$28/month at the cap every single day)" | `src/lib/api-quota.ts:37-46`, `:54` |
| Demo latency budget | live result must appear **≤90 s**; the narration is written around a **~35 s** measured queue wait; the escape hatch is a **pre-generated** variant revealed on a stall | `docs/DEMO_SCRIPT.md:23`, `:24`, `:25`, `:48` |

**Two repo-level inconsistencies we flag rather than smooth over:**

1. **The same model is 32–38 s in one artefact and ~66 s in the other** (`bake-off/RESULTS.md:15` vs `bake-off/drift-results.md:29`). Two different runs, two different harnesses; both are quoted. For planning we use the **conservative ~66 s** number for the API path, which is also the number our own drift write-up uses ("Latency 66 s — meaningful UX hit", `bake-off/drift-results.md:80`).
2. **A zero-drift, byte-identical result from an instruction-mode model with no mask on the wire is not self-explanatory.** Our drift metric measures the region *outside the painted rectangle*; with no mask on the wire, the model still reproduced those pixels exactly across runs (`bake-off/drift-results.md:33-37`). Whether that is model behaviour, prompt behaviour, or a property of how the harness measured is **not established in the repo**. Any self-hosted comparison must use the **same metric and the same fixtures** or the two numbers are not comparable.

---

## 3. The self-hosted alternative, concretely

### 3.1 What "self-hosted editor" would mean *for this repo*

Concretely, the smallest self-hosted editor that keeps our edit path recognisable is:

- **Model:** the open weights of **Qwen-Image-2.1** — the same generation model our DashScope endpoint serves (paper §I and §IV-A; `bake-off/RESULTS.md:39`). Published at `Qwen/Qwen-Image-2.1` on Hugging Face: **7 115 124 736 parameters in BF16** (HF API `safetensors` metadata), of which the model card describes a **7 B visual generation component** with "32 Single-Stream DiT layers" and "mixed-granularity attention and **prefix KV cache reuse**" (model card, *Introduction*). The card's own quick start uses `diffusers.QwenImage21Pipeline`, `num_inference_steps=40`, bf16, and `pipe.enable_model_cpu_offload()` as the memory option (model card, *Quick Start* / *Memory Optimization*).
- **Serving shape:** a small HTTP service we operate, exposing the repo's existing job interface — i.e. **a new adapter file plus one switch arm** in `resolveProvider` / `getInferenceClient` (`src/lib/inference.ts:9-33`). The seam is HTTP-shaped, so a self-hosted GPU service fits it; the paper's method, however, lives *inside* the model runner (see §3.3).
- **Hardware class:** **one 24 GB consumer GPU** — the paper's own hardware ("one RTX 4090", 1024 px, bf16, 40 steps, CFG=1; paper §I and §IV-A). Model size implies ≳14 GB of weights in bf16 (7.115 B params × 2 bytes — **assumption**, arithmetic from the HF metadata), so a 24 GB card is the plausible class with headroom for activations at our output size.
- **Speed layer (half public):** step caching via **`cache-dit`**, a PyTorch-native DiT inference engine — **Apache-2.0**, with an explicit adapter for `QwenImage21Transformer2DModel` in its support table (GitHub API + README, fetched 2026-10-28). The paper states its DBCache implementation "reproduces the official `cache-dit` outputs bit-for-bit" (paper §III-E), so the *step-cache operator* is reproducible from public code.
- **Speed layer (half not public):** the **region-freezing** half — FreezePlan's token-selection rule, its `x̂₀` anchor handling and its K/V retention are described in the paper (§III-B, §III-E) but **the paper publishes no code and no repository link** (see §3.3). Its `RegionE`/`SpotEdit` baselines were re-implemented by the authors from those works' official code (paper §IV-A).

### 3.2 Established technique vs speculation for *this* codebase

| Claim | Status | Grounding |
|---|---|---|
| Region freezing (skip computing tokens an edit leaves untouched) is an established acceleration technique for diffusion-transformer editors | **Established (paper-reported, with prior-work lineage)** | paper §I, §II (cites SpotEdit, RegionE, EEdit); our own reading of the prior art is only via the paper's account |
| Step caching / forecasting across denoising steps is established | **Established** | paper §II (DeepCache, FORA, Δ-DiT, TeaCache, TaylorSeer, …) |
| The two compose better than either alone, and the gain is in the *schedule*, not the selector | **Established for Qwen-Image-2.1 at 1024 px on one RTX 4090** | paper §IV-C (Table III): swapping selectors under the same schedule costs only 0.5–0.6 dB median PSNR |
| FreezePlan reaches **5.05× at 29.77 dB** PSNR to the dense output, ΔVLM **−0.06 [−0.15, +0.01]** | **Paper-reported (pre-registered split B, 44 samples, 1 seed)** | paper §IV-B Table II |
| Region freezing will speed up **our** staging edits | **Speculation — and the paper's own fallback argues against it for whole-room edits** | paper §III-E (global-edit fallback) + §V(1) (11/44 = 25 % fallback); our hero flow is "Stage entire room" (`docs/DEMO_SCRIPT.md`, beat 3) |
| The acceleration holds at our **2048×1536** output | **Speculation** — the paper's headline is a "1024-pixel edit" whose exact pixel count is **not published**, and the paper states its cost coefficients are "hardware-specific" (§V(3), Appendix D) | paper §I, §IV-A, Appendix D |
| The accelerated output passes **our** quality gates | **Speculation** — the paper's metrics are PSNR-to-dense-output and a local 8B VLM judge; we have no equivalent judge | paper §IV-A; our gates: `src/lib/inpaint-quality-gate.ts:1-25`, `src/lib/edit-conservation.ts:1-27` |
| We can obtain the right to use the weights commercially | **Unresolved** — commercial licence is *requestable*, **price not published** | `Qwen/Qwen-Image-2.1` `LICENSE` §2.a/§2.b |
| A self-hosted path can honour **our painted mask** | **Unresolved and, for the paper's method, false** — the paper's frozen region is model-internal (`‖x̂₀ − ref‖` statistics), not our mask | paper §III-E; our masks are dropped today (`src/lib/prompts.ts:416`) |

### 3.3 Code / weights / licence availability — the two gates

**Weights.** The weights exist and are ungated: `Qwen/Qwen-Image-2.1` is a public, non-gated repository (HF API: `gated: false`), with `diffusers` and `safetensors` tags, 200 640 downloads and 3 485 likes at fetch time (HF API, fetched 2026-10-28). **Nothing needs to be requested to read the licence.**

**Licence — the blocker.** The repository's `LICENSE` file is the **Qwen RESEARCH LICENSE AGREEMENT (release date September 20, 2026)**:

- §2.a: the grant is "to use, reproduce, distribute, copy, create derivative works of, and make modifications to the Materials **FOR NON-COMMERCIAL PURPOSES ONLY**";
- §2.b: "You shall not use the Materials for any commercial purpose without obtaining a separate commercial license from us" (request channel given in the licence);
- §1.i defines "Non-Commercial" as "for research or evaluation purposes only".

Staging-studio sells staging to real-estate clients; the self-hosted weights of *this* model are therefore **not usable for production without a separate commercial grant**, whose **price is not published**. This is the same wall our own bake-off already hit on the hosted side: the fal-hosted Qwen slot was "flagged Private/research-only", and the recommended path was "a commercial grant from Alibaba required before production" (`bake-off/drift-results.md:79-83`, `bake-off/RESULTS.md:39`).

**Code.** The paper publishes **no code and no repository link** — its arXiv HTML render contains no code-release statement, and its arXiv licence is the **arXiv non-exclusive distribution licence 1.0**, which grants distribution of the paper, not a code/weight licence. The paper's own §III-E says its caching implementation matches `cache-dit` bit-for-bit, so the *caching* half can be built from public Apache-2.0 code; the *freezing* half would have to be re-implemented from the paper text by us. The paper's §IV-A also says SpotEdit and RegionE were "ported from their official code" — i.e. the prior region methods have public implementations, though the paper does not give their repositories inline (they are in its reference list, e.g. arXiv:2510.25590 for RegionE, arXiv:2512.22323 for SpotEdit).

**Alternatives if the Qwen commercial grant does not arrive** (licences read from the HF API, fetched 2026-10-28 — each would need its own bake-off, none is the paper's model):

| Self-hostable editor | Licence tag | Params (HF metadata) | Note |
|---|---|---|---|
| `Qwen/Qwen-Image-Edit` | **apache-2.0** | 20 430 401 088 | Commercially usable; **a different model** from our API model — adopting it is a *model swap* with its own quality risk and its own bake-off cost |
| `stabilityai/stable-diffusion-xl-base-1.0` | **openrail++** | 2 567 463 684 | Commercially usable; older generation, not the paper's model |
| `black-forest-labs/FLUX.1-Fill-dev` | license:other, **gated: auto** | 11 902 391 360 | The mask fill family our editor was designed around; licence is "other" and gated ⇒ not a commercial drop-in |
| `black-forest-labs/FLUX.1-Kontext-dev` | license:other, **gated: auto** | 11 901 408 320 | same |

---

## 4. Economics

### 4.1 Cost drivers, side by side

| Driver | API path (today) | Self-hosted editor |
|---|---|---|
| Variable cost per image | **$0.04** (cited: `bake-off/RESULTS.md:15`, `:39`) | **GPU time only**: hourly rate × seconds per image ÷ 3600 → §4.2 (**assumption-based**) |
| Fixed cost | **$0** (no fixed infra; the provider's fleet is not ours) | GPU rental or owned GPU, weights storage, model service, monitoring, **on-call** |
| Concurrency cost | Provider-side queueing, absorbed inside the vendor's price; our own guardrail is the **20/day/user** quota | **Ours** — one 24 GB card serves one 1024-px edit at a time unless we batch; queueing becomes our latency risk |
| Overage/retries | **$0.04 per attempt** — a post-submit failure is billed ("Alibaba already billed us, ~$0.04/image", `src/app/api/inpaint/route.ts:324`) | GPU time for the failed attempt only, but **plus** our engineering time to notice |
| Volume ceiling | 20 images/user/day ⇒ **≈ $0.80/user/day** (`src/lib/api-quota.ts:37-46`, `:54`) | Bounded by GPU throughput and VRAM, not by a quota — but the *cost* is bounded by GPU-hours we pay for |
| Licences | Commercial terms bundled with the Alibaba account (cited: `bake-off/RESULTS.md:39`) | **Qwen weights are non-commercial**; a commercial grant must be obtained, **price not published** (§3.3) |
| Adjacent spend that does **not** change | The advisory OpenAI gate (`gpt-4o-mini`), SAM segmentation, PDF export, copy generation (`src/lib/api-quota.ts:37-46`) | same |

### 4.2 The marginal arithmetic (every input labelled)

Inputs, with provenance:

- **Dense latency: 24.5 s per edit, 40 steps, 1024 px, one RTX 4090** — *paper-reported* (paper §I; §IV-A). Cross-check with the paper's own cost model: `T = T_fix + n_full·C + …` with `T_fix = 1.48 s`, `C = 0.575 s` (Appendix D) ⇒ 1.48 + 40×0.575 ≈ **24.5 s**. The paper's model reproduces its own headline; that is an internal-consistency check, not our measurement.
- **FreezePlan speed-up 5.05×** — *paper-reported* (paper §IV-B Table II).
- **RTX 4090 (24 GB) $0.89/hr; RTX A5000 (24 GB) $0.27/hr; RTX 5090 (32 GB) $1.19/hr; A100 PCIe (80 GB) $1.79/hr; H100 PCIe (80 GB) $2.89/hr** — *cited*: runpod pricing page, fetched 2026-10-28 (community per-hour listings).

Derived (all **assumptions**, each stated):

| Quantity | Value | Assumption chain |
|---|---|---|
| Images per GPU-hour, dense @1024 px | ≈ **147** | 3600 s ÷ 24.5 s; 1 GPU, 1 image at a time, **100 % utilisation**, no batching, no I/O |
| Marginal GPU cost per image, dense @1024 px | ≈ **$0.0061** | 147 img/hr on $0.89/hr |
| Images per GPU-hour, FreezePlan @1024 px | ≈ **742** | 24.5 s ÷ 5.05; same utilisation assumptions |
| Marginal GPU cost per image, FreezePlan @1024 px | ≈ **$0.0012** | 742 img/hr on $0.89/hr |
| Scale-up to our 2048×1536 output | **3–5×** the 1024-px cost | **Assumption** (our output is 3.15 MP; the paper's "1024-pixel edit" pixel count is **not published**; token count grows ~linearly, attention ~quadratically, and the paper's own cost model is linear in the active fraction — no measured curve exists) |
| Marginal GPU cost per image at our resolution | **≈ $0.02–$0.035** dense, **≈ $0.003–$0.006** at 5.05× | $0.0061 and $0.0012 scaled by 3–5× |

### 4.3 Break-even shape

Let **A** = $0.04/image (API, cited), **m** = marginal self-hosted cost per image (assumption-derived above), **F** = fixed monthly self-hosted cost. Self-hosting wins when `N > F / (A − m)`.

Using the numbers above, on **one always-on RTX 4090 at $0.89/hr** (**assumption**: 730 h/month ⇒ **F ≈ $650**/month):

- with `m ≈ $0.006` (dense, our resolution, conservative end): `N ≳ 650 / 0.034 ≈ **19 000 images/month**`;
- with `m ≈ $0.003` (accelerated): `N ≳ 650 / 0.037 ≈ **17 500 images/month****.

Against our own demand ceiling: the quota allows 20 images/user/day (`src/lib/api-quota.ts:54`), so **19 000 images/month ≈ 32 users running at the cap every day** — and that is *before* any on-call, storage, egress, engineering or licence cost. On the same arithmetic, a **1-user** demo-scale deployment spends **$24/month** on the API ($0.04 × 600) versus **≈ $650/month** of GPU for one always-on card — the API is ~**27× cheaper** at that volume.

**Qualitative conclusion (what the issue actually asks):** the break-even sits at a volume we have **no evidence of reaching**, and it is *not* reached by lowering the per-image cost — the fixed GPU + ops line dominates until the GPU is genuinely saturated. Two corollaries:

1. **A self-hosted editor can win on *latency* long before it wins on *cost*.** A dedicated GPU next to the request path removes the provider's queue and the network hop, and FreezePlan's 5× is a genuine latency lever (paper §IV-B) — but only if the licence and the hardware exist (§3.3).
2. **The break-even arithmetic is void if the commercial licence is not granted**, because then the self-hosted alternative is not legally available at any price. We therefore do **not** present a "self-hosting saves money" conclusion; we present a **conditional** one.

**Not published / not verified:** the commercial price of the Qwen weights; any $/image or $/GPU-hour figure from the paper; our actual monthly edit volume (the DB was not queried for this document, and querying it was out of scope of a desk evaluation).

---

## 5. Speed

### 5.1 Latency drivers, API path

| Stage | Cost | Evidence |
|---|---|---|
| Request → provider | one **synchronous** round trip to the Alibaba Singapore endpoint | `docs/vendor-investigation/1240-bakeoff-oct-2026.md` §2 |
| Provider generation | **32.1–38.0 s** at 2048×1536 in the bake-off; **~66 s** in the drift run | `bake-off/RESULTS.md:15`; `bake-off/drift-results.md:29` |
| Our own overhead | quota reservation, DB writes with bounded retry, result persistence/polling | `src/app/api/inpaint/route.ts:301-345`; `src/lib/inpaint-submit.ts` |
| Provider-side queue | folded into the measured numbers; the demo narration is written around a **~35 s** wait | `docs/DEMO_SCRIPT.md:23` |
| **Budget** | live result must appear **≤ 90 s**; beyond that the script reveals a **pre-generated** variant | `docs/DEMO_SCRIPT.md:24`, `:25`, `:48` |

**Caching effects on the API path — the paper's levers are unavailable here.** Region freezing and step caching are *inference-internal* decisions (which tokens to compute, which steps to reuse). A hosted API takes `{ image_url, prompt }` and returns an image (`src/lib/prompts.ts:443-455`); there is **no parameter** through which we could ask the provider to freeze a region or to skip steps. **The paper's speed lever is only reachable if we host the model.** The one caching lever that *is* available at our layer is result reuse for an identical (image, directive, mask) triple — which would avoid re-paying $0.04 and re-waiting 32–66 s, but which is a *product* decision (pre-generated variants), not the paper's method, and which the demo script already assumes it can fall back to (`docs/DEMO_SCRIPT.md:25`).

### 5.2 Latency drivers, self-hosted path

| Stage | Cost | Evidence |
|---|---|---|
| Model load | weights are **7.115 B params in bf16** ⇒ ≳ **14 GB** (assumption: arithmetic from HF metadata) | HF API `safetensors`, fetched 2026-10-28 |
| Dense generation @1024 px | **24.5 s** (40 steps, ≈0.575 s/step, +1.48 s fixed) | paper §I, §IV-A, Appendix D — *paper-reported* |
| FreezePlan generation @1024 px | **≈4.9 s** implied by 5.05× (paper-reported speed-up; the implied wall time is our arithmetic) | paper §IV-B Table II |
| At **our** 2048×1536 output | **≈15–25 s** accelerated, **≈74–123 s** dense | **assumption** (3–5× scaling, §4.2) |
| Our HTTP hop + queue | 1 request to our own service; **we** own the queue (one card, one edit at a time unless batched) | `src/lib/inference.ts:19-33` |
| Cache-warm vs cold | the paper measures "median real end-to-end speed-up measured with CUDA events" — i.e. **GPU time**, not our request time | paper §IV-A |

### 5.3 Against the demo's latency budget

- **The API path already fits**: 32–38 s (or ~66 s) against a ≤90 s rule (`docs/DEMO_SCRIPT.md:24`), with a pre-generated fallback if it does not.
- **A self-hosted path would fit comfortably *if* the resolution scaling is benign** (≈15–25 s) — but at the pessimistic end of our own assumption (dense at 2048×1536 ≈74–123 s) it would **break the 90 s rule**, and the paper's fallback regime (global edits, 25 % of its test samples) means the accelerated path *is* the dense path for whole-room staging. That is the honest risk statement: **for our hero beat the paper's method buys us the dense latency, not the accelerated one.**
- **Concurrency is the hidden cost.** Today the vendor absorbs concurrency; with one 24 GB card, the second concurrent edit queues behind the first. Our quota (20/user/day) makes this unlikely at demo scale, but it converts a vendor problem into our on-call problem.

---

## 6. Quality — what self-hosting gains or loses for staging specifically

**Gains (real, but narrower than they look):**

1. **A mask channel becomes *possible*.** The model card describes "specify local edits via circles, painted annotations, or **separate masks**" (Qwen-Image-2.1 model card, *Introduction*), and the paper's model is *block-causal with a prefix KV cache* (paper §III-A) — the architecture that makes token-level freezing possible at all. Today our mask is dropped by the payload builder (`src/lib/prompts.ts:416`), so a self-hosted path is the only route to a mask conditioned edit *for this model*. **Caveat, stated plainly:** the released `diffusers` editing example passes **prompt + image only** (model card, *Image Editing*), so mask conditioning in the open pipeline is **not demonstrated** by what we read.
2. **Reproducibility we control.** The paper generates each sample once with a fixed seed (20261023) and reports bit-exact cache reproduction against `cache-dit` (paper §III-E, §IV-A). Our API path is also deterministic per our own metric (drift 0.000 / max 0, `bake-off/drift-results.md:29`) — so this is a tie, not a win.
3. **Latency and control of the schedule** (§5) — the real prize, gated on the licence.

**Losses / risks:**

1. **The frozen region is not our region.** FreezePlan selects the active set from the model's own change statistics and **falls back to dense when the edit is global** (paper §III-E); the fallback fired on **11/44 (25 %)** of test samples (paper §V(1)). Whole-room staging *is* a global edit — so on the flow that matters most to the demo, the method degrades to "no speedup", and on a global edit the *changed* set is the whole frame, leaving nothing to freeze.
2. **"Unchanged" regions can move.** With the `x̂₀` anchor, the unchanged region's PSNR **to the dense output** is **29.9 dB**, versus **33.3 dB** for the reference anchor — while the dense model itself sits at **29.7 dB** from the input (paper §III-B). In other words, a frozen self-hosted editor can differ from the input in "untouched" regions **about as much as the dense model does**. Our repo's architectural invariant ("walls, windows, trim, doors, molding, structural columns…" — `src/lib/prompts.ts:26`) is enforced *today* by prompt wording + dilation + advisory gates, not by any pixel lock; a self-hosted accelerated path does not add a pixel lock, it adds a different approximation of the dense model.
3. **New failure mode: ghosting at the frozen boundary.** "Newly added small objects occasionally show faint ghosting near the frozen boundary; **we have not quantified it**" (paper §V(2)). Staging edits place *new objects* (a sofa, a rug) precisely where a frozen boundary would be. This is the single most staging-specific risk in the paper.
4. **Cache-only artefacts on flat areas.** The paper's qualitative figure shows that on flat-colour regions "TaylorSeer and DBCache turn the cake into noise, while FreezePlan matches the dense output" (paper §IV-E). Staging images are walls, floors, ceilings — large flat areas — so the *baseline* the paper beats is exactly our failure shape, and the paper's positive case is the one we would have to reproduce.
5. **Our gates are uncharacterised against this path.** The inpaint quality gate (`src/lib/inpaint-quality-gate.ts:1-25`) and the deterministic conservation measures (`src/lib/edit-conservation.ts:1-27`) are **advisory only** and were built around one provider's outputs. A different (accelerated, self-hosted) image for the same directive will pass/fail differently; the paper's PSNR-to-dense-output metric is **not** a substitute for the gate, and there is no in-repo judge equivalent to the paper's VLM scoring (paper §IV-A).
6. **Style control is unchanged in principle but not in practice.** FreezePlan changes the *sampling schedule*, not the conditioning: our `buildInpaintPrompt`, `FRAMING_CONTEXT` and `NEGATIVE_PROMPT` (`src/lib/prompts.ts:26-350`) still apply. But the paper runs the raw model at 40 steps with CFG=1 (paper §IV-A) while our hosted call uses DashScope defaults whose step count and guidance are **not published** — so "same model, same prompt" is already an approximation, and self-hosting changes the trajectory again.

**Net quality read:** self-hosting with freezing would **not** improve mask fidelity (freezing is not mask honouring), would **not** improve region preservation in a way our gates currently rely on (the dense model itself re-renders unedited regions), and would add a **new, unquantified** failure mode (boundary ghosting) on the object-addition case staging is made of. The quality case for self-hosting is therefore **weak**; the case for it is **latency and control**, plus economics only above ~17–19 k images/month (§4.3) — and only if the weights are licensed for commercial use.

---

## 7. Verdict: **SKIP**

**Verbatim verdict: SKIP** — do not move the staging edit path to a self-hosted editor, and do not implement FreezePlan.

**Why not ADOPT:** adopting the paper means adopting self-hosting, which means (a) obtaining a commercial grant for weights whose current licence is **non-commercial** and whose commercial price is **not published**; (b) standing up GPU infrastructure and on-call in a repo that has **no GPU, no self-host adapter and no GPU owner** (`src/lib/inference.ts:9-13`, `docs/1477-geometry-consistent-defurnishing-evaluation.md:99`, `docs/1458-soft-matte-evaluation.md:18`); and (c) accepting that the method's own fallback regime (§V(1)) removes the speed-up precisely on the whole-room flow that is our hero beat. Any one of those alone is a multi-quarter infra project.

**Why not "evaluate further with a bake-off" on the GPU yet:** because the bake-off's premise — that the weights may be used — is unresolved, and because the paper's method is not fully public (no region-freezing implementation). Spending GPU money on a licence-encumbered, half-public method before the licence question is answered would be the wrong order of operations.

**Why not SKIP the *idea* entirely:** the technique is real and, on the paper's own evidence, effective for the class of edits where most of the frame is untouched (paper §IV-B). If the licence ever lands and our edit mix turns out to be dominated by *local* edits (a sofa swap inside a painted mask) rather than whole-room restaging, the economics could flip above ~17–19 k images/month (§4.3). That is a **future** decision, not this one.

**Concrete next step (one small follow-up issue — no code lands from this one):**

> **Follow-up issue: "Self-hosted staging editor — licence-first probe"** (no GPU spend until step 3).
>
> 1. **Licence (no spend, no code).** Ask Qwen/Alibaba for commercial terms for the Qwen-Image-2.1 weights (the licence names the request channel; the price today is **not published**). Record the answer — including "no" — in the issue. In parallel, record the **actual** monthly edit volume from the `InpaintRequest` table so §4.3 uses measured demand instead of the quota ceiling.
> 2. **Alternatives (no spend).** For one commercially-licensed candidate (`Qwen/Qwen-Image-Edit`, Apache-2.0, or an SDXL-class inpainting model), record licence, weights size, VRAM need and the mask/annotation capability from the model card — as a table, not a bake-off.
> 3. **Only if step 1 answers "commercial use granted" (and step 2 finds no better licence):** run **one** offline bake-off of the open weights on **our own fixtures** (`bake-off/befores/*.jpg`), on a rented 24 GB card, with **step caching only** via `cache-dit` (Apache-2.0) — **no region freezing**, because no implementation is published. Budget: 20 images at the paper's 1024-px dense rate (24.5 s) ≈ **8 GPU-minutes ≈ $0.10** at $0.89/hr, or at our 2048×1536 rate (74–123 s, our §4.2 assumption) ≈ **25–41 GPU-minutes ≈ $0.4–$0.6** (**assumptions**). Measure wall-clock per image at our 2048×1536 output, and run the outputs through the existing advisory gates (`src/lib/inpaint-quality-gate.ts`, `src/lib/edit-conservation.ts`) for parity with the API path. Artefacts go to `bake-off/`; **no production code changes**.
> 4. **Decision gate.** Open a real migration issue only if *all* hold: commercial licence granted at a price that keeps per-image cost under $0.04; wall-clock ≤ 90 s at 2048×1536 **including** the fallback regime; and the advisory gates pass at parity with the recorded API outputs. Otherwise close the thread as "self-hosting is not for us" and record the numbers.

---

## 8. What was NOT done (per this issue's hard stops)

- **No GPU job, no model run, no weight download, no paid image API call** (Alibaba, fal, OpenAI or any other) was attempted. **No rendered prototype, no benchmark, no measurement of our own** is claimed anywhere in this document.
- **No source code, config, test, schema, workflow or existing doc was changed.** No CI configuration was touched. The only file added by this issue is this document.
- **The referenced draft `/tmp/staging_issue6.md` was not read** — it is not present on this machine. The scope was derived from the issue title and repo evidence, and the ambiguities that produced are listed in §1.
- **We did not obtain a commercial licence quote** for the Qwen weights; that price is **not published** and is labelled as such everywhere it would have been used.
- **We did not query the database** for real edit volume; §4.3 uses the quota ceiling as an explicit upper bound and says so.
- **We did not verify** the paper's "1024-pixel edit" pixel count (not published), nor that region freezing or its anchor behaviour survives at our 2048×1536 output; the 3–5× scaling factor in §4.2 is labelled an assumption.
- **We did not verify that the open `diffusers` pipeline accepts a mask** for Qwen-Image-2.1: the model card's *Introduction* claims mask/annotation-specified local edits, while the released *Image Editing* example passes prompt + image only. Both are quoted; neither is treated as settled.
- **We did not verify GPU prices beyond the fetched pricing page** (community per-hour listings for the listed cards, fetched 2026-10-28). Reserved-cluster and long-term-contract tiers are "contact sales" and are therefore not priced here.
- **We did not re-run the paper's method, re-implement FreezePlan, or evaluate SpotEdit/RegionE directly** — all statements about them are the paper's own reported results and are labelled as such.
- **Internal inconsistency in the paper we flag but do not resolve:** §IV-A states "All runs use one RTX 4090 (**48 GB**)" while a 4090 is a 24 GB card; the paper also never states the pixel count behind "1024-pixel edit". We therefore treat the paper's *hardware line* as unreliable and use only its latency/speed-up figures, scaled by our own labelled assumption.
