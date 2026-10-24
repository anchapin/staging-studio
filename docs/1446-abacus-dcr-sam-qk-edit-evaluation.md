# ABACUS / DCR-SAM / QK-Edit evaluation for the staging quality gate

**Issue:** [#1446](https://github.com/anchapin/staging-studio/issues/1446) — Evaluate three items from the 2026-10-21 paper watch against the Staging Studio staging pipeline: (1) ABACUS-style object-counting + scene-conservation checks as a quality gate for staged outputs (arXiv:2610.28316), (2) DCR-SAM — but only *if* SAM masks turn out to be a latency bottleneck (arXiv:2610.27960), (3) QK-Edit attention manipulation on the FLUX pipeline (arXiv:2610.17829).
**Date:** 2026-10-24
**Status:** Research-only — **no code, config or dependency changes** in this issue; this file is the whole change.
**Labels:** `inpainting`, `research`
**Sibling docs:** [`docs/dcr-sam-qk-edit-evaluation.md`](dcr-sam-qk-edit-evaluation.md) — a 2026-10-23 partial evaluation of the same issue covering **DCR-SAM + QK-Edit only**; this document supersedes it as the single #1446 evaluation (it re-verifies that doc's claims against today's tree and adds the ABACUS slice, which that doc explicitly did not cover). Same house style as [`docs/one-step-editing-evaluation.md`](one-step-editing-evaluation.md) (#1444) and [`docs/lenserase-removal-evaluation.md`](lenserase-removal-evaluation.md) (#1445).

**Placement rationale (repo convention):** the paper-watch evaluation family (#1444, #1445, #1446) lives at the root of `docs/` as `<topic>-evaluation.md`, not under `docs/spikes/` (numbered *hand-on operator* spikes, e.g. `docs/spikes/278-clip-latency.md`) and not under `docs/vendor-investigation/` (vendor bake-offs, e.g. `docs/vendor-investigation/236-ideogram-vs-flux-fill.md`). This file therefore follows the sibling-evaluation convention.

---

## 0. TL;DR

- **ABACUS (arXiv:2610.28316) — ADOPT-PARTIALLY.** The paper's *shape* is right for this repo and the repo has **already built the deterministic core** of it: `src/lib/edit-conservation.ts` implements an advisory, dependency-free, pure-function pair of checks — an object-count check (`evaluateCountCheck`, `src/lib/edit-conservation.ts:177`) and a scene-conservation check (`evaluateSceneConservation`, `src/lib/edit-conservation.ts:328`) — with the paper's provenance recorded in the module header (`src/lib/edit-conservation.ts:1-30`) and 460 lines of pinned tests (`tests/edit-conservation.test.ts`). What is **missing is the wiring**: a repo-wide grep finds `edit-conservation` referenced only by its own test file, never imported by `src/` (see §3.3), so today it is a library, not a gate. The **full** ABACUS protocol (panoptic GT, dual detectors, Hungarian instance matching, RAFT + MS-SSIM) is *not* reproducible in this repo (no panoptic GT, no live detector, no GPU service) and is **not** proposed here. The proposed gate is the judge-free, zero-vendor-spend subset: an out-of-mask **scene-conservation** check computed with pixel math we already ship (`scripts/bake-off-drift-test.mts:242-291`) plus the existing `evaluateSceneConservation` region API, and an object-count check whose *counting source* is specified but stays disabled until a live instance segmenter exists. Design in §3.5; first step in §8.1.
- **DCR-SAM (arXiv:2610.27960) — REJECT (today), re-open as spike-first when a trigger lands.** The issue conditions this evaluation on *"if SAM masks are a latency bottleneck"*. **That condition is not met, and cannot be met from the repo's own artefacts:** (a) the only SAM latency numbers in the tree are an explicitly-labelled *ballpark* table, "requires live measurement" (`docs/issue-220-sam-latency-measurement.md:136-148`); (b) **no production code emits any segment timing event at all** — `src/lib/segment-timing.ts` defines the builders (`:30`, `:59`, `:93`) and nothing in `src/` calls them, the client file the older doc points at (`src/components/canvas/use-segment-prewarm.ts`) **does not exist**, and `docs/segment-timing-measurement.md:48-50` states there is no `segment_server_timing` event; (c) the SAM endpoint's provider is **retired** — `assertInferenceConfigured` throws for `fal`/`replicate` (`src/lib/inference.ts:286-300`) and the only wired adapter has no SAM case (`src/lib/alibaba-adapter.ts:106-121`); (d) **no client calls `/api/segment/furnishings`** — the editor renders hard-coded placeholder detections (`src/components/edit-room/EditRoomStudio.tsx:728-734`) and the mask that actually drives an edit is freehand-painted (`src/components/edit-room/MaskLayer.tsx:7`). On top of that the mask **never reaches the provider** (`src/lib/prompts.ts:448-455`, `src/lib/alibaba-adapter.ts:204`), so mask quality is currently unobservable in the product output.
- **QK-Edit (arXiv:2610.17829) — REJECT (as a pipeline change today), monitor.** It is a *training-free, inference-time* intervention inside an MM-DiT: save the source pass's vision query/key tensors, replace the target pass's. Our editor is a **hosted HTTP call** — a DashScope multimodal-conversation POST of image + text (`src/lib/alibaba-adapter.ts:174-240`, payload built at `:204`) — so there is no attention tensor, no sampler and no local weights to hook. **FLUX is not our pipeline**: it survives as a logical model *name* (`src/lib/inference.ts:47-48`), a legacy payload builder (`src/lib/prompts.ts:369-389`), a retired fal model constant (`src/lib/prompts.ts:60`) and a bake-off row (`bake-off/RESULTS.md:11`); the live inpaint provider is `qwen-image-2.1-pro` via Alibaba (`src/lib/alibaba-adapter.ts:106-112`).
- **What actually blocks all three** is one shared fact: **the mask is dropped on the wire** (`src/lib/prompts.ts:448-455` → `{ image_url, prompt }` only). Until a mask-aware provider is wired, mask quality (DCR-SAM), mask-locked structure (QK-Edit) and region-scoped QA (ABACUS conservation) all degrade to "measure the whole frame", because the server has no idea which pixels the user asked to change.

---

## 1. Scope and method

**Issue.** #1446 asks for three evaluations and, for ABACUS specifically, a *design* for a QA gate — the same "evaluate first, integrate later" pattern the #1444/#1445 evaluations used. This document is the evaluation deliverable. **Nothing is integrated here.**

**Evidence rules applied.**

1. Every claim about *this repo* cites a `file:line` that exists in this worktree. Every claim about a *paper* cites the arXiv id and the paper's own section/equation, and is labelled **paper-reported**. Where a paper does not publish something, this document says so instead of estimating.
2. Repo evidence outranks the issue text, which outranks prior knowledge of these papers.
3. Paper text was read from the **arXiv abs pages and HTML renders** (`arxiv.org/abs/2610.28316`, `arxiv.org/abs/2610.27960`, `arxiv.org/abs/2610.17829` and the corresponding `/html/<id>v1` renders), fetched **2026-10-24**. Code availability was checked by HTTP status on the repositories the abs pages link: `github.com/CEA-LIST/ABACUS` → **200**, `github.com/set-path/DCR-SAM` → **200**; the QK-Edit abs page links **no** code repository (its only outbound links are `huggingface.co` boilerplate), so QK-Edit is **paper-only** as of this date.
4. Repo-measured numbers (latency, price, drift) come from our own committed artefacts: `bake-off/RESULTS.md`, `bake-off/drift-results.md`, `bake-off/befores/`, `bake-off/outputs/`.
5. Licence facts: not quoted from memory; not needed for any verdict here, so the licence column is left out rather than guessed.

**Limits of this pass.**

- **Nothing was run.** No model was executed, no image was re-scored, no detector was called. Every number attributed to a paper is **paper-reported**; every number attributed to this repo is either a committed artefact or an explicitly-labelled ballpark.
- The **object-count half** of the proposed gate is specified but **cannot be measured today** — the repo has no live instance segmenter (see §3.2). §3.5 says so explicitly rather than pretending otherwise.
- The two SAM measurement docs in the tree **contradict each other and the current code** (§7.1). Where they do, this document cites the code, not the docs.

---

## 2. Current state: what the pipeline actually does today

### 2.1 The editor call chain

```
client-painted mask + directives
  → POST /api/inpaint                    src/app/api/inpaint/route.ts:35 (maxDuration 60), :199 (schema), :299-301
  → submitInpaintRequest()                src/lib/inpaint-submit.ts:539
      → evaluateQualityGate()             src/lib/inpaint-submit.ts:556 → :323-334  (PRE-FLIGHT, advisory)
      → submitInpaintToActiveProvider()   src/lib/inpaint-submit.ts:375-416
          → buildInpaintPayloadForActiveProvider()   src/lib/prompts.ts:539-554
          → buildAlibabaFillPayload()                src/lib/prompts.ts:448-455  ← { image_url, prompt } ONLY
          → client.submit(LOGICAL_MODEL.FLUX_FILL)   src/lib/inpaint-submit.ts:415
  → provider: Alibaba DashScope           src/lib/alibaba-adapter.ts:106-112 (model), :174-240 (POST), :204 (message body)
```

- The **only** wired provider is Alibaba DashScope; the fal and Replicate adapters were retired in #1240 and selecting them now throws (`src/lib/inference.ts:286-300`, `:326-330`). `resolveAlibabaModel` has exactly one case — `FLUX_FILL` → `ALIBABA_INPAINT_MODEL` (default `qwen-image-2.1-pro`) — and throws for everything else, SAM included (`src/lib/alibaba-adapter.ts:106-121`).
- The **mask is dropped**: the live payload is `{ image_url, prompt }` (`src/lib/prompts.ts:444-455`) and the DashScope message content is `[{ image: imageUrl }, { text: prompt }]` (`src/lib/alibaba-adapter.ts:204`). The client *does* send a mask (`src/app/api/inpaint/route.ts:301`, accepted as a `data:image/*` URL or an allowlisted host — `src/lib/ai-route-schemas.ts:30-51`), and the server accepts it, but the active adapter ignores it.
- FLUX itself is legacy-only in code: logical name (`src/lib/inference.ts:47-48`), legacy fal payload builder with `mask_url` (`src/lib/prompts.ts:369-389`), retired model constant `fal-ai/flux-lora-fill` (`src/lib/prompts.ts:60`), and the *incumbent arm* of our own bake-off (`bake-off/RESULTS.md:11`). Measured: 16.7–22.7 s at 1440×928, $0.05/MP (`bake-off/RESULTS.md:11`); the current provider `qwen-image-2-1` measured 32.1–38.0 s at 2048×1536, $0.04/image (`bake-off/RESULTS.md:15`).

### 2.2 Where staged-output QA happens today (and where it does not)

- **The only QA in the pipeline is a PRE-FLIGHT gate on the *directives*, not on the output.** `evaluateInpaintQualityGate` (`src/lib/inpaint-quality-gate.ts:98-131`) asks gpt-4o-mini to rate directive specificity, flag architecture risk and note furnishing alignment; its contract is explicitly **advisory only — it must never fail an inpaint submission** (`src/lib/inpaint-quality-gate.ts:11-14`), and it is failure-tolerant of OpenAI outages by design (issue #685, `src/lib/inpaint-quality-gate.ts:85-97`, `:122-131`). It runs **before** the provider call (`src/lib/inpaint-submit.ts:556`), and its warnings ride along with the submission result (`src/lib/inpaint-submit.ts:539-556`).
- **There is no post-generation QA of the staged image.** The completion path normalizes the provider's URL (`src/lib/inpaint-output.ts`), decides whether it may be persisted (`src/lib/inpaint-completion.ts:45-56`), and writes it. No pixel, count or structure check runs on the produced image anywhere in `src/`.
- **An ABACUS-style deterministic module already exists but is not wired.** `src/lib/edit-conservation.ts` implements the count check and the conservation check as pure functions and documents itself as "ADVISORY ONLY, like `src/lib/inpaint-quality-gate.ts`" (`src/lib/edit-conservation.ts:1-30`). A repo-wide grep for `edit-conservation` / `evaluateEditConservation` finds hits **only** in `src/lib/edit-conservation.ts` itself and in `tests/edit-conservation.test.ts` — **no module under `src/` imports it.** It is a library with tests, not a gate.

### 2.3 The SAM / mask path, and the latency evidence

- SAM 3.1 exists in the tree only as the fal model id `fal-ai/sam-3-1/image` (`src/lib/furnishing-detection.ts:32`), reached through the logical model `SAM_3_1_IMAGE` (`src/lib/inference.ts:49-50`) by the furnishings route's service (`src/lib/segment-furnishings-service.ts:120`). Results are LRU-cached in-process, 8 entries / 8 MiB (`src/lib/segment-cache.ts:74-75`).
- **The route is not reachable in production.** It calls `client.subscribe(SAM_3_1_IMAGE)` (`src/lib/segment-furnishings-service.ts:113-118`), which resolves to the Alibaba adapter, whose `resolveAlibabaModel` throws for SAM (`src/lib/alibaba-adapter.ts:106-121`); and `fal`/`replicate` throw at configure time (`src/lib/inference.ts:286-300`).
- **No client calls it.** Grepping `src/` for `/api/segment/furnishings` returns route handlers (`src/app/api/segment/furnishings/route.ts`, `src/app/api/v1/segment/furnishings/route.ts`), services (`src/lib/segment-furnishings-service.ts`), schemas (`src/lib/ai-route-schemas.ts:204`) and comments (`src/components/edit-room/EditRoomStudio.tsx:718-721`) — **no `fetch`**. The editor's concept submit handler only sets local state ("#1344 wires the real `/api/segment/furnishings` call; for now we set the concept", `src/components/edit-room/EditRoomStudio.tsx:718-721`), and the detection list the inspector renders is **hard-coded placeholder boxes** (`src/components/edit-room/EditRoomStudio.tsx:728-734`).
- **The mask that actually drives an edit is freehand-painted** on the canvas (`src/components/edit-room/MaskLayer.tsx:7`, `:20-30`), then feathered client-side (`src/lib/mask-feather.ts`).
- **Latency evidence in the repo is a ballpark, not a measurement.** `docs/issue-220-sam-latency-measurement.md:136-148` is headed "Expected numbers (ballpark — requires live measurement)": cold click ~2,000–3,500 ms total / ~1,800–3,000 ms provider; warm ping ~100–250 ms with `falMs: null`; cache hit ~0 ms. Nothing in the tree emits the events those protocols read — see §7.1.

### 2.4 Where the staged output lands (relevant to any post-hoc gate)

- `Room` keeps the before/after photo URLs per variant slot (`prisma/schema.prisma:81-95`).
- `InpaintRequest` stores the provider job id, the provider result URL and the persisted result URL — **but not the mask and not the source image** (`prisma/schema.prisma:155-179`). The mask arrives as a `data:image/*` URL at submit time (`src/lib/ai-route-schemas.ts:30-51`) and is then dropped (`src/app/api/inpaint/route.ts:299-301` → `src/lib/prompts.ts:448-455`).
- This is the single concrete gap a post-hoc ABACUS-style gate has to close: **the edited region must be persisted**, or the server cannot tell "inside the mask" from "outside the mask" after the fact.

---

## 3. ABACUS (arXiv:2610.28316) — object counting + scene conservation as a quality gate

### 3.1 What the paper is

**Paper-reported (abstract, arXiv:2610.28316, Lassoued, Loesch, Audigier; submitted 2026-10-20):** "Instruction-based image editing models can now add, remove a specified number of objects or change their category while preserving the scene. Yet these models often fail to produce the correct number, and these failures grow sharply as scenes become more complex and the requested count increases. Current benchmarks largely miss this problem: they score edits with holistic similarity metrics or with vision-language model (VLM) judges that are themselves poor at counting… We address this issue with ABACUS, a new benchmark, evaluation protocol and dedicated scoring metric for numerical image editing. **Our protocol is judge-free: no VLM or MLLM scores an edit or counts objects** (a VLM only confirms the category of rare ambiguous crops). Instead, it verifies each edit at the instance level against panoptic ground truth confirmed by detector consensus, checking both that **the exact requested count was achieved** and that **the rest of the scene was preserved**, across the add, remove and change operations."

The paper's own scoring (§4.4, Eq. 3) is a **product** of three factors, deliberately unforgiving:

| Factor | Paper definition | Paper-reported |
|---|---|---|
| **CF** — count fidelity | Dice/F1 on counts: `CF(d,K) = 2·min(d,K)/(d+K)` where `K` = requested count, `d` = confirmed new instances | `CF = 1` exactly when `d = K`; over- and under-adding penalized symmetrically (Eq. 4) |
| **SC** — scene consistency | `SC = HM(SC_str, SC_app)` on the background `B` (everything outside the edited region), with `SC_str = exp(−mean‖RAFT(I_o, I_e^m)‖₂)` and `SC_app = MS-SSIM(I_o[B], I_e[B])` | harmonic mean requires *both* structural and appearance preservation (Eqs. 6–8) |
| **OC** — original-category conservation | `OC = 1 − N_rem/N_GT` (add), `1 − a/N_GT` (remove), `1 − (f₁+f₂)/N_GT^cls1` (change) | catches "reached K by regenerating an existing instance instead of adding" (Eqs. 5, 9, 10) |

`Score = CF · SC · OC` (§4.4, Eq. 3). The instance-level machinery behind it (§4.1) is: SAM-3 concept segmentation on both frames → source↔edit instance matching by a composite geometric score (IoU / containment / size-ratio / Hu-moment contour) solved with the Hungarian algorithm → "clean image" construction (erase matched regions with non-local patch inpainting) → **dual-detector confirmation** (RF-DETR + Co-DETR vote on the SAM-localized regions) → a constrained VLM verifier invoked on only 6.4 % of instances for rare ambiguous crops. Benchmark scale (§3.2): 10,944 instructions over 3,845 COCO images, graded easy/medium/hard. Editor leaderboard (§5.3, Table 2): overall `Score` 0.31 (Seedream 4.0), 0.29 (Gemini 2.5 Flash Image), 0.26 (GPT-Image-1), 0.16 (Qwen-Image-Edit), **0.14 (FLUX.1 Kontext)**, 0.11 (Step1X-Edit), 0.09 (BAGEL) — i.e. **the best model in the benchmark still fails ~70 % of the requested numerical edit**.

**Public code:** `github.com/CEA-LIST/ABACUS` (HTTP 200, fetched 2026-10-24).

### 3.2 What the full protocol would need here — and what we do not have

| ABACUS ingredient | Present in this repo? | Evidence |
|---|---|---|
| Panoptic ground truth for the source frame | **No** — no panoptic annotations, no dataset | `prisma/schema.prisma` (no annotation model), `bake-off/` holds 3 source JPEGs + masks only |
| Live instance segmenter (SAM-3 style, per-object masks) | **No in production** — fal retired, Alibaba has no SAM mapping, no client calls the route | `src/lib/inference.ts:286-300`, `src/lib/alibaba-adapter.ts:106-121`, `src/components/edit-room/EditRoomStudio.tsx:728-734` |
| Dual object detectors (RF-DETR, Co-DETR) | **No** | grep for `yolo\|detr\|rf-detr` in `src/` → no hits |
| Dense optical flow (RAFT) / MS-SSIM | **No** | grep → no hits; we have pixel-diff math only (`scripts/bake-off-drift-test.mts:242-291`) |
| Hungarian instance matching | **No** | grep → no hits |
| GPU inference service | **No** | `src/lib/inference.ts:157-190` is an HTTP/job interface, and the only adapter is a hosted API |
| **Mask / edited region for the staged output** | **No** — the mask is dropped on the wire and not persisted | `src/lib/prompts.ts:448-455`, `prisma/schema.prisma:155-179` |
| **Deterministic count + conservation check primitives** | **Yes** | `src/lib/edit-conservation.ts:177`, `:328`, `:456`; tests `tests/edit-conservation.test.ts` |
| **Pixel-drift measurement outside the mask** | **Yes** (research script, pure TS + sharp) | `scripts/bake-off-drift-test.mts:242-291`; measured results `bake-off/drift-results.md` |

**Consequence:** the *paper's* protocol is a **benchmark harness** (ground-truth-driven, GPU-heavy, designed to rank editors). Porting it into Staging Studio as a *runtime* gate is not feasible today. What *is* feasible — and what the issue actually asks for ("integrate ABACUS-style checks as a quality gate for staged outputs") — is the **judge-free, deterministic subset** the repo already implements in `src/lib/edit-conservation.ts`, fed by measurements we can actually take.

### 3.3 What the repo already has (and why it is not a gate yet)

`src/lib/edit-conservation.ts` is a 571-line, dependency-free, side-effect-free module that implements precisely the two checks the issue names:

- `evaluateCountCheck(expected, detections, options)` (`:177`) — derives the expected count per category (`count`, else `beforeCount + add − remove`) and compares it with the observed count in the edited frame; reports `countDelta`, `actualAdd`, `actualRemove`, `unexpectedCategories` (`:122-158` for the result types; `:177-238` for the logic).
- `evaluateSceneConservation(before, after, mask, options)` (`:328`) — compares per-region change scores before vs after, using the before-frame value as the region's own baseline (`effective = max(0, changed − baseline)`), exempts regions inside the edit mask, and reports violations with reasons `"changed" | "missing"` (`:284-294`, `:328-408`).
- `evaluateEditConservation(params)` (`:456`) — the advisory wrapper: **never throws**, returns `{ pass, warnings, countCheck, conservation }` (`:431-441`), skipping whichever check has no input (`:462-470`).
- Default tolerance: an out-of-mask region may change up to **2 %** of its area before it counts as a violation (`DEFAULT_SCENE_CONSERVATION_TOLERANCE = 0.02`, `:278`).
- Contract: **advisory only**, explicitly mirroring the LLM gate (`src/lib/edit-conservation.ts:18-21`).

Its tests pin the contract (`tests/edit-conservation.test.ts`, including "combines count and conservation warnings" and "never throws on malformed input" — `:406`, `:453-459`).

**The gap is wiring, not logic.** Grep for `edit-conservation|evaluateEditConservation` across the tree returns only `src/lib/edit-conservation.ts` and `tests/edit-conservation.test.ts`. No route, service or client module imports it, so no staged output is ever checked. That is the concrete, cheap, high-value part of ABACUS we can adopt.

### 3.4 Verdict: **ADOPT-PARTIALLY**

**Adopt:** the *judge-free deterministic gate shape* ABACUS advocates — count fidelity + scene conservation computed from measurements, never from a VLM judge — because (a) it matches this repo's existing advisory-gate contract (`src/lib/inpaint-quality-gate.ts:11-14`, `src/lib/edit-conservation.ts:18-21`), (b) it costs no vendor spend (pure pixel math + pure functions), and (c) it fills a hole the pipeline demonstrably has: **there is no output-side QA at all today** (§2.2), while the paper's own leaderboard shows the live class of editors failing most numerical edits (§3.1, Table 2: best overall `Score` 0.31; FLUX.1 Kontext 0.14).

**Do not adopt (for now):** the full ABACUS protocol — panoptic GT, dual detectors, Hungarian matching, RAFT/MS-SSIM. It needs artefacts and GPU services this repo does not have (§3.2). Adopting it "in spirit" by asking a VLM to count would violate the paper's central claim (VLM judges are poor at counting — abstract) and would re-introduce the spend the existing LLM gate already costs.

**Explicitly out of scope:** blocking or auto-rejecting a staged output. ABACUS is a *scoring* benchmark; a product gate that refuses to show a generated image to a paying user is a different (and much larger) product decision. Our gate stays advisory, exactly like the existing one.

### 3.5 ABACUS-style QA gate — concrete design

**Placement.** Post-generation, on the inpaint **completion** path — not the pre-flight path (`src/lib/inpaint-submit.ts:556`), which only sees the *directives* and runs before the provider call. The natural hook is the completion/persistence step (`src/lib/inpaint-status.ts:431` `pollInpaintStatus` → `src/lib/inpaint-completion.ts:45` `shouldPersistResult`), with the resulting warnings surfaced next to the existing `qualityWarnings` channel (`src/lib/inpaint-submit.ts:539-556`).

**Inputs the gate consumes (all pipeline outputs, no new vendor):**

| Input | Today | Needed change |
|---|---|---|
| Source ("before") image URL | `Room.beforeImageUrl` / `beforeImageUrl2` (`prisma/schema.prisma:88-90`) | none |
| Edited ("after") image URL | `InpaintRequest.resultUrl` / `Room.afterImageUrl` (`prisma/schema.prisma:89`, `:166`) | none |
| **Edit mask / edited region** | sent to `/api/inpaint` as a `data:image/*` URL, then dropped (`src/app/api/inpaint/route.ts:301`, `src/lib/prompts.ts:448-455`); **not persisted** | persist on `InpaintRequest` (`prisma/schema.prisma:155-179`) — a `maskUrl String?` column, or a downsampled mask digest |
| **Requested count `K` per category** | implicit in the free-text directive (`promptDirectives`, `src/lib/ai-route-schemas.ts:95`); our own bake-off prompts show the shape: "a mid-century walnut sofa, a cream linen armchair, a round walnut coffee table, a woven jute rug, and warm brass floor lamp" (`bake-off/vacant-insert.json`) | a deterministic count parser over the directive (or a client-supplied structured `counts`), e.g. `src/lib/edit-count-parser.ts`; counts must be **requested**, never inferred from the output |
| Detections (before / after) | none | produced by a counting source — see the count metric below |

**Metric 1 — object-count accuracy (ABACUS `CF`, repo-native subset).**

- Definition: for each category `c` with a requested count `K_c` and a realized count `d_c`, report `CF_c = 2·min(d_c,K_c)/(d_c+K_c)` (paper Eq. 4) and a binary `d_c == K_c`.
- Realized counts come from a **counting source**, and the honest state of this repo is that there is none:
  - our instance-label path labels *already-detected crops* (`src/lib/label-instances-service.ts:1-60`, cache in `src/lib/vision-labels.ts`) — it **cannot count** objects in a frame;
  - the SAM-style per-object mask endpoint can count instances of one concept, but its provider is retired and no client calls it (§2.3).
- **Therefore:** ship metric 1 as **specified-but-disabled** (`evaluateCountCheck` already accepts absent inputs and reports `countCheck: null`, `src/lib/edit-conservation.ts:462-470`). The first live counting source to appear — a re-wired `/api/segment/furnishings`, or ABACUS's own public evaluator run offline over our fixtures (`github.com/CEA-LIST/ABACUS`, HTTP 200) — flips it on without changing the gate's shape.

**Metric 2 — scene conservation (ABACUS `SC`, repo-native subset).** Two layers, both zero-spend:

- **Pixel layer (primary, measured today):** out-of-mask **mean RGB delta** between before and after, computed with the diff code the bake-off already uses (`scripts/bake-off-drift-test.mts:242-291`; the mask-complement convention — white = edit, black = preserve — is documented at `:259-263`). Our own baselines are already measured and can serve as the threshold reference: `qwen-image-2-1` **mean delta 0.000 / max 0** over 728,224 unedited pixels (`bake-off/drift-results.md:34-36`), `flux-pro-fill` ~0.006 (`bake-off/drift-results.md:13`), while instruction-mode editors drift 28–52 (`bake-off/drift-results.md:22-27`). The repo's own stated "no drift" expectation is **mean delta < 2 across RGB** (`scripts/bake-off-drift-test.mts:16`).
- **Region layer (secondary, already implemented):** feed per-region change scores into `evaluateSceneConservation` (`src/lib/edit-conservation.ts:328`) with the persisted mask as the exempt region list, using the module's default 2 % tolerance (`:278`) and its `"missing"` reason for a region that vanished (`:299-306`).

**Suggested pass/fail thresholds (advisory wording — never blocks):**

| Signal | PASS | WARN | FAIL |
|---|---|---|---|
| Count, `d_c` vs requested `K_c` | `d_c == K_c` (`CF_c == 1`) | `CF_c ≥ 0.5` | `d_c == 0` (`CF_c == 0`, e.g. the editor added nothing) |
| Count, unexpected categories | none | 1–2 extra categories | ≥ 3 extra categories (reported as `unexpectedCategories`, `src/lib/edit-conservation.ts:144-158`) |
| Out-of-mask drift (pixel layer) | mean delta ≤ 2.0 (`scripts/bake-off-drift-test.mts:16`) | 2.0 < mean delta ≤ 8.0 | mean delta > 8.0, or max delta > 32 on ≥ 1 % of unedited pixels |
| Out-of-mask drift (region layer) | no region over the 2 % tolerance (`src/lib/edit-conservation.ts:278`) | 1 violating region | ≥ 2 violating regions, or any region with reason `"missing"` |
| Overall advisory verdict | all PASS | any WARN | any FAIL → **advisory warning surfaced to the user**, no auto-reject |

Thresholds are deliberately anchored to numbers this repo has already measured (`bake-off/drift-results.md`) rather than invented; they should be re-tuned after the first live replay (§8.1) and recorded in the follow-up issue.

**Cost / latency.** The pixel layer is pure TS + `sharp` (already a dependency of the bake-off script) — no vendor spend, no model call, no extra network round-trip beyond downloading the two images the completion path already has. The count layer is the only part with a cost, and it is off by default.

**What this gate deliberately does NOT do** (and why): it does not block or auto-reject a staged image (product decision, not an evaluation); it does not ask a VLM to judge the edit (ABACUS's central claim is that VLM judges miscount); it does not re-render or re-edit; it does not add a provider to the pipeline.

---

## 4. DCR-SAM (arXiv:2610.27960) — SAM masks as a latency bottleneck?

### 4.1 What the paper is

**Paper-reported (abstract, arXiv:2610.27960, Liao, Zhu, Ma, Jiang, Dai; submitted 2026-10-20):** SAM3 "excels at single-concept segmentation" but "falls short in complex, real-world environments where multiple concepts must be segmented simultaneously… as the number of concepts increases, the independent inference paradigm introduces prohibitive inference latency". DCR-SAM decouples cross-modal interactions to cut that latency, aligns textual concepts with visual representations and adds "a dense competition head to enforce explicit inter-class competition", plus "a learnable background token … to absorb non-target objects dynamically". Reported results: "2.3 % ~ 10.7 % performance improvement over state-of-the-art methods", "**33× inference speedup compared to the native SAM3**", and robustness across scenarios.

**Public code:** `github.com/set-path/DCR-SAM` (HTTP 200, fetched 2026-10-24).

The issue's framing is precise: evaluate DCR-SAM **"if SAM masks are a latency bottleneck"**. So the first question is not "is the paper good" but **"are SAM masks a latency bottleneck in *this* repo?"** — and the repo's own artefacts answer it.

### 4.2 Is SAM latency a measured bottleneck here? — no, and it is not even reachable

1. **The only numbers are a ballpark, and the doc says so.** `docs/issue-220-sam-latency-measurement.md:136-148` is headed "Expected numbers (ballpark — **requires live measurement**)": provider time ~1,800–3,000 ms per call, warm ping ~100–250 ms with `falMs: null`, cache hit ~0 ms. These are *estimates for a protocol*, not measurements of this system.
2. **No code emits the timing events those protocols read.** `src/lib/segment-timing.ts` defines `buildSegmentTimingEvent` (`:59`) and `buildSegmentPrewarmEvent` / `emitSegmentTiming` (`:81-93`), but a grep over `src/` shows the only references to those names are inside that file itself and in `tests/segment-timing.test.ts`. The client file the older doc points at (`src/components/canvas/use-segment-prewarm.ts`) **does not exist**; and `docs/segment-timing-measurement.md:48-50` states plainly: "There is no `segment_server_timing` event… Do not look for `segment_server_timing` in the codebase — it was planned but never implemented." The two measurement docs therefore **contradict each other** (§7.1), and the code sides with the newer one.
3. **The SAM path cannot run in production.** The fal and Replicate adapters were deleted in #1240 and selecting them throws (`src/lib/inference.ts:286-300`, `:326-330`); the only wired adapter is Alibaba, whose model resolver has no SAM case and throws for it (`src/lib/alibaba-adapter.ts:106-121`). The segment route calls exactly that path (`src/lib/segment-furnishings-service.ts:113-120`).
4. **No client calls the segment route**, so even a working provider would see zero traffic: the editor's concept handler only sets local state (`src/components/edit-room/EditRoomStudio.tsx:718-721`) and the rendered detections are hard-coded placeholders (`src/components/edit-room/EditRoomStudio.tsx:728-734`).
5. **Masks are not on the critical path of an edit anyway.** The critical path is the provider call: 32–38 s at 2048×1536 for the live provider (`bake-off/RESULTS.md:15`), against a SAM ballpark of ~2–3 s that is *not* on the critical path while §4.2.3–4 hold. Detection is one call per (image, concept), LRU-cached (`src/lib/segment-cache.ts:74-75`).
6. **A better mask would not change the product today.** The mask never reaches the provider (`src/lib/prompts.ts:448-455`; `src/lib/alibaba-adapter.ts:204`), so mask quality is unobservable in the produced image. The mask that does reach the *user's* eyes is the freehand-painted one (`src/components/edit-room/MaskLayer.tsx:7`).
7. **DCR-SAM's mechanism targets a regime we are not in.** Its selling point is *multi-concept* segmentation in one pass; the one place that would want it — the one-click "restage furnishings" preset, whose regeneration target is the union of per-object masks over detected furniture (`src/lib/holistic-preset.ts:7`) — does not exist as a shipped multi-concept call today, and the segment route is driven by a single concept (`src/lib/furnishing-detection.ts:39-42`).

### 4.3 Verdict: **REJECT** (for this issue) — re-open as **spike-first** when a trigger lands

Rejected *for this issue*, because the issue's own precondition is unmet: there is **no measured** SAM latency bottleneck in this repo (no emitter, no live number), and the path is not even live (§4.2). Adopting a 33×-faster segmenter to fix a bottleneck that has never been measured, on a route that no client calls, behind a provider that has been retired, would be optimizing a number we invented.

This is **not** a claim that the paper is unsound — it is licence-clean public work with a public repo, and its mechanism fits the multi-concept preset. It is a claim that *the trigger condition has not occurred*.

**Re-evaluation triggers (any one):**
1. A **mask-aware** provider is wired (the payload builder starts sending a mask — `src/lib/prompts.ts:448-455` changes): mask quality becomes product-visible, and mask *latency* becomes a real user-visible cost.
2. The editor re-wires concept detection to `/api/segment/furnishings` (replacing the placeholders at `src/components/edit-room/EditRoomStudio.tsx:728-734`) **and** the timing events are re-emitted (`src/lib/segment-timing.ts:59-93` get a caller): then a live SAM latency number exists, and the "is it a bottleneck?" question becomes answerable with a measurement instead of a ballpark.
3. The one-click multi-concept preset ships (`src/lib/holistic-preset.ts:7`): the single place where "one pass, many concepts" is genuinely needed, and therefore the only place DCR-SAM's mechanism could apply.

**First step when a trigger lands (no code today):** run the **public DCR-SAM repo unmodified** over our own fixtures (`bake-off/befores/*.jpg` + `*__mask.png`) with our chip concepts, and record per concept: call latency, per-object mask count, and the pure-TS mask proxies we already have — coverage (`src/lib/mask-coverage.ts`) and the postprocess invariants (`src/lib/mask-postprocess.ts`). That yields the *unadapted* multi-concept baseline for free; only if that baseline is promising on interior photos is it worth asking what an 8×4090 training run buys over a hosted per-concept call.

---

## 5. QK-Edit (arXiv:2610.17829) — attention manipulation on the FLUX pipeline

### 5.1 What the paper is

**Paper-reported (abstract, arXiv:2610.17829, Shen, Huang, Li, Lin, Liu, Wang, Feng, Yang, Liew; submitted 2026-10-13):** MM-DiTs "process image and text tokens … via self-attention", which "poses significant challenges for editing, rendering conventional U-Net-based attention manipulation methods ineffective". QK-Edit is "a **training-free** framework that exploits the unique attention dynamics of MM-DiTs for precise text-guided image and video editing. By introducing a novel **query-key manipulation strategy**, our method isolates and adjusts critical attention components to achieve an optimal balance between **prompt fidelity and structural consistency**", across "object addition, object removal, object replacement, changing background, changing material, changing color, and style transformation". It "can be easily implemented with feature replacement in inference" and is demonstrated "on state-of-the-art models, such as **FLUX** and HunyuanVideo".

**Availability:** the abs page links **no** code repository or project page (fetched 2026-10-24; the only outbound links are `huggingface.co` boilerplate). Treat "easily implemented" as **paper-reported, not repo-verified** — and note that "a few lines of code" inside *someone else's* MM-DiT sampler is not "a few lines of code" for a team that has no MM-DiT sampler.

### 5.2 Is the mechanism reachable from this repo's API surface? — no

- **Our editor is an HTTP call, not a diffusion pipeline we host.** The adapter POSTs a DashScope multimodal-conversation request (`src/lib/alibaba-adapter.ts:174-240`; message content `[{ image }, { text }]` at `:204`) and returns an image URL. There is **no local sampler, no model object, no attention tensor** anywhere in the repo, so there is nowhere to save the source pass's vision Q/K and nowhere to replace the target pass's. A hosted API does not expose its attention internals.
- **FLUX is not in the pipeline.** It exists as (a) a logical model name (`src/lib/inference.ts:47-48`), (b) a legacy fal payload builder that is still unit-tested but unreachable (`src/lib/prompts.ts:369-389`, constant at `:60`), (c) the incumbent arm of the bake-off (`bake-off/RESULTS.md:11`), and (d) a compatibility fallback in the vendor doc. The live provider is `qwen-image-2.1-pro` (`src/lib/alibaba-adapter.ts:106-112`). QK-Edit's evidence is on FLUX.1-dev and HunyuanVideo — models we do not run.
- **Even if it were reachable, the axis is questionable for us.** Our mask today is painted and *not honoured on the wire* (`src/lib/prompts.ts:448-455`), so the provider already restyles the whole frame and the "structural consistency" QK-Edit optimizes would be measured against a baseline we do not actually have. ABACUS's own leaderboard also puts FLUX-family editors at the **bottom** of the numerical-editing table (FLUX.1 Kontext overall `Score` 0.14, §3.1) — i.e. the paper's model is *not* the one that wins at the thing ABACUS measures.
- **Cost profile changes kind, not degree.** Self-hosting FLUX.1-dev on A100-class GPUs vs **$0.04/image at 32–38 s** today (`bake-off/RESULTS.md:15`) is a capital + ops decision, not a config change.
- **The one integration seam that could host it** is the provider abstraction `InferenceClient.subscribe/submit/status/result` (`src/lib/inference.ts:157-190`) — but that seam is an HTTP/job interface. An attention-level method must live *inside* a local model runner, so it would arrive as a **new provider adapter + a self-hosted GPU service**, i.e. a different issue with a different owner.

### 5.3 Verdict: **REJECT** (as a pipeline change today) — monitor

Rejected for the current pipeline: the mechanism is physically inaccessible through a hosted multimodal-conversation API, FLUX is not in the pipeline, there is no code release to spike, and the cost profile is a different kind of commitment. Kept on the **monitor** list because it is training-free, licence-clean, cheap to implement *once a local MM-DiT exists*, and its stated axis (prompt fidelity vs structural consistency) is precisely the axis this repo worries about — documented repeatedly in `bake-off/drift-results.md` and in the #1445 evaluation (`docs/lenserase-removal-evaluation.md`).

**Re-evaluation triggers (any one):**
1. A **self-hosted** MM-DiT editor is introduced behind `InferenceClient` (`src/lib/inference.ts:157-190`) — then the method is implementable, and the honest first experiment is an A/B on our own fixtures.
2. A mask-aware provider lands **and** we decide that mask-locked structure is no longer sufficient (i.e. the painted mask stops being the contract) — then a global attention edit becomes worth testing.

**First step when a trigger lands (no code today):** A/B the method on `bake-off/befores/` with the existing drift methodology (`scripts/bake-off-drift-test.mts`) and the paper's own axes (prompt fidelity vs structure), against the incumbent rows in `bake-off/RESULTS.md`.

---

## 6. Comparison

| | **ABACUS** (arXiv:2610.28316) | **DCR-SAM** (arXiv:2610.27960) | **QK-Edit** (arXiv:2610.17829) |
|---|---|---|---|
| What it is | Judge-free benchmark + protocol for numerical image editing (count + conservation) | Efficient SAM3 adaptation for multi-class semantic segmentation | Training-free query-key manipulation inside an MM-DiT for text-guided editing |
| Paper's headline | `Score = CF·SC·OC`; best editor scores 0.31; FLUX.1 Kontext 0.14 (Table 2) | 2.3–10.7 % better; **33× faster** than native SAM3 | Balance of prompt fidelity vs structural consistency on FLUX / HunyuanVideo |
| Public code | `github.com/CEA-LIST/ABACUS` (200) | `github.com/set-path/DCR-SAM` (200) | none linked (2026-10-24) |
| Repo-side prerequisite | Persist the edit mask + a counting source | A live mask-aware provider + a re-wired segment route + timing emitters | A self-hosted MM-DiT (attention tensors) |
| Present today? | Deterministic core **yes** (`src/lib/edit-conservation.ts`), wiring **no**, counting source **no** | **No** — provider retired, route uncalled, mask dropped on the wire | **No** — hosted HTTP editor, FLUX not in pipeline |
| Repo evidence for the issue's premise | Output-side QA does not exist at all (§2.2) | **No live SAM latency measurement exists** (§4.2, §7.1) | Editor = hosted call; FLUX legacy only (§5.2) |
| **Verdict** | **ADOPT-PARTIALLY** (gate design in §3.5, first step in §8.1) | **REJECT** today → **spike-first** on trigger | **REJECT** today → **monitor** on trigger |

---

## 7. Contradictions, blockers and stale evidence found while evaluating

These are reported rather than smoothed over; none of them is fixed in this doc-only change.

1. **The two SAM measurement docs contradict each other, and the code contradicts both.** `docs/issue-220-sam-latency-measurement.md:183-186` lists `segment_prewarm_timing` as "✅ Emitted — use-segment-prewarm.ts:140", `segment_server_timing` as "✅ Emitted — route.ts:132,164" and `segment_concept_timing` as "✅ Emitted — furnishings/route.ts:196" (file/line references quoted verbatim from that doc; none of the three named locations matches the current tree). `docs/segment-timing-measurement.md:48-50` says the opposite about `segment_server_timing`. The code says: **no emitter exists** — `src/components/canvas/use-segment-prewarm.ts` does not exist, and grep finds `segment_prewarm_timing` / `segment_concept_timing` / `segment_server_timing` **only** in `src/lib/segment-timing.ts` (as type/builder definitions) — no `console` emission, no route logging. **Consequence:** there is no live SAM latency measurement in this repo, only a ballpark. *(Both docs are point-in-time investigation snapshots, not current guidance — see `AGENTS.md:77`.)*
2. **The mask never reaches the provider** (`src/lib/prompts.ts:448-455` → `src/lib/alibaba-adapter.ts:204`), yet the mask is accepted, validated and rate-limited as if it mattered (`src/app/api/inpaint/route.ts:299-301`, `src/lib/ai-route-schemas.ts:30-51`). Any output QA that needs to know the edited region is therefore blocked on persisting the mask (§3.5, §8.1).
3. **A quality-gate library exists with tests but no caller** — `src/lib/edit-conservation.ts` (571 lines) + `tests/edit-conservation.test.ts` (460 lines) are referenced by nothing under `src/`. Either wire it (§8.1) or delete it; today it is dead weight that will drift.
4. **Stale fal-era constants still read as live.** `FAL_FLUX_FILL_MODEL = "fal-ai/flux-lora-fill"` (`src/lib/prompts.ts:60`) and `buildFalFillPayload` (`src/lib/prompts.ts:369-389`) remain in the tree while `assertInferenceConfigured` rejects `fal` outright (`src/lib/inference.ts:286-300`). A reader can easily mistake the fal payload builder for the live path.
5. **`bake-off/drift-results.md` and `bake-off/RESULTS.md` disagree on the current provider's drift** (0.000 mean delta, `bake-off/drift-results.md:34-36`, vs the ~66 s / "instruction-mode candidates" framing in the same file) — worth a reconciliation pass before the numbers are used as gate thresholds (they are the anchors proposed in §3.5).

---

## 8. Follow-up issues (sized)

### 8.1 Primary — "Wire the ABACUS-style conservation gate into the inpaint completion path (advisory)"

**Size:** one follow-up issue, one engineer, ~2–3 days. It is the *only* issue this evaluation proposes as immediately actionable.

**Scope (in):**
1. Persist the edit mask on `InpaintRequest` (`prisma/schema.prisma:155-179`): add `maskUrl String?` (the mask already arrives as a `data:image/*` URL, `src/lib/ai-route-schemas.ts:30-51`) — or, to avoid storing base64 PNGs, persist a downsampled white-on-black mask digest plus its byte length.
2. Extract the bake-off's pure-TS out-of-mask diff (`scripts/bake-off-drift-test.mts:242-291`) into `src/lib/` (e.g. `src/lib/out-of-mask-drift.ts`) so both the bake-off script and the gate use one implementation; no new dependency (`sharp` is already used).
3. Call the existing deterministic checks — `evaluateSceneConservation` (`src/lib/edit-conservation.ts:328`) with the persisted mask as the exempt region list and the repo's 2 % default tolerance (`:278`), and `evaluateCountCheck` (`:177`) in its disabled/empty form — from the completion path (`src/lib/inpaint-status.ts:431` / `src/lib/inpaint-completion.ts:45`), using `evaluateEditConservation` (`:456`) as the single advisory entry point.
4. Surface the resulting warnings through the existing advisory channel (`qualityWarnings`, `src/lib/inpaint-submit.ts:539-556`) — **advisory only; never block, never auto-reject, never throw** (the module's own contract, `src/lib/edit-conservation.ts:18-21`, `:456-470`).

**Scope (out):** the count source, the full ABACUS protocol, any provider change, any model call, any blocking behaviour.

**Acceptance criteria:**
- Unit tests for the new drift module against the committed fixtures: `bake-off/befores/*__before.jpg` + `bake-off/befores/*__mask.png` + `bake-off/outputs/*` reproduce the numbers already published in `bake-off/drift-results.md` (e.g. `qwen-image-2-1` mean delta 0.000, `flux-pro-fill` ~0.006) — i.e. **the gate and the bake-off agree**.
- A replay run over all 27 outputs in `bake-off/outputs/` reports a drift verdict per image, with zero vendor spend and no network calls beyond fetching the fixture images.
- The gate's thresholds are the ones proposed in §3.5, or a documented re-tuning with the measured distribution attached.
- The existing `tests/edit-conservation.test.ts` contract still passes unchanged (advisory, never throws).

### 8.2 Deferred (not filed now — prerequisites first)

- **"Re-emit the segment timing events"** — the cheapest possible unblocker for the DCR-SAM question, and the precondition for any future latency claim about masks. Wire `emitSegmentTiming` (`src/lib/segment-timing.ts:93`) into the segment route and the editor, and correct or retire `docs/issue-220-sam-latency-measurement.md` and `docs/segment-timing-measurement.md` so the two stop contradicting each other (§7.1). ~half a day.
- **"Object-count source for the ABACUS gate"** — decide between (a) re-wiring `/api/segment/furnishings` behind a live provider (also unblocks the editor's placeholder detections at `src/components/edit-room/EditRoomStudio.tsx:728-734`) and (b) running ABACUS's public evaluator offline over our fixtures as an evaluation harness only. Only after this exists can `evaluateCountCheck` be switched on (§3.5, metric 1).
- **"Mask-aware provider"** — the single change that would make masks (and therefore DCR-SAM, and the region-scoped half of the ABACUS gate) product-visible at all. Not an evaluation deliverable; listed so the dependency is not lost.

---

## 9. Verification

Run from the worktree root at commit `58fc1b0` (develop).

```
$ git status --porcelain
?? docs/1446-abacus-dcr-sam-qk-edit-evaluation.md
?? WORKER_REPORT.md
```

(`WORKER_REPORT.md` is the brief-mandated worker report at the worktree root, not a repository deliverable; **no code, config, dependency, schema or test file was touched** — the only repository change is this document.)

Every path cited in this document was checked to exist:

```
$ for f in src/lib/edit-conservation.ts src/lib/inpaint-quality-gate.ts src/lib/inpaint-submit.ts \
  src/app/api/inpaint/route.ts src/lib/prompts.ts src/lib/inference.ts src/lib/alibaba-adapter.ts \
  src/lib/furnishing-detection.ts src/lib/segment-furnishings-service.ts src/lib/segment-cache.ts \
  src/lib/segment-timing.ts src/app/api/segment/furnishings/route.ts src/app/api/v1/segment/furnishings/route.ts \
  src/lib/ai-route-schemas.ts src/lib/label-instances-service.ts src/lib/vision-labels.ts \
  src/lib/holistic-preset.ts src/lib/mask-coverage.ts src/lib/mask-postprocess.ts src/lib/mask-feather.ts \
  src/lib/inpaint-output.ts src/lib/inpaint-status.ts src/lib/inpaint-completion.ts \
  src/components/edit-room/EditRoomStudio.tsx src/components/edit-room/MaskLayer.tsx \
  src/components/canvas/use-inpaint-runs.ts scripts/bake-off-drift-test.mts prisma/schema.prisma \
  tests/edit-conservation.test.ts bake-off/RESULTS.md bake-off/drift-results.md bake-off/vacant-insert.json \
  bake-off/occupied-replace.json docs/issue-220-sam-latency-measurement.md docs/segment-timing-measurement.md \
  docs/dcr-sam-qk-edit-evaluation.md docs/one-step-editing-evaluation.md docs/lenserase-removal-evaluation.md ; do \
  test -f "$f" || echo "MISSING $f"; done
```

(output: no `MISSING` lines — every cited path exists.)

**No test suite was run:** this change adds one Markdown file and touches no code, so the Vitest suite is unaffected. (Stale-test protocol not applicable.)
