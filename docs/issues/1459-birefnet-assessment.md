# Assessment: local BiRefNet cutouts for the swatch/asset library (issue #1459)

**Issue:** [#1459](https://github.com/anchapin/staging-studio/issues/1459) — assess local BiRefNet furniture cutouts for the swatch/asset library, to offload paid fal.ai calls.
**Date:** 2026-10-26
**Status:** Assessment only — **no production behaviour changed** by this document, and **no cutout quality was measured** (see §1.3).
**Labels:** `research`, `segmentation`, `cost`
**Sibling docs:** [`docs/birefnet-cutout-assessment.md`](../birefnet-cutout-assessment.md) — the earlier desk assessment of #1459 (merged in PR #1464); this document re-derives the same question from the current tree and adds the code-level inventory, the cost table with explicit provenance, and a runnable follow-up protocol. [`docs/1458-soft-matte-evaluation.md`](../1458-soft-matte-evaluation.md) — the #1458 soft-matte evaluation (same house style; it re-verified the "fal SAM is retired" finding that §2 depends on). [`docs/issues/1457-mask-erosion.md`](1457-mask-erosion.md) — the mask-grid conventions. [`docs/1446-abacus-dcr-sam-qk-edit-evaluation.md`](../1446-abacus-dcr-sam-qk-edit-evaluation.md) — the #1446 evaluation (first recorded the "no live segmenter" finding).

**Placement note:** the evaluation family in this repo lives at the root of `docs/` with the issue number as a prefix (`1446-…`, `1458-…`). This file lives under `docs/issues/` because the brief for this slice requires that path; the content follows the same house style (evidence rules, `file:line` citations, explicit "not run" section).

---

## 0. TL;DR — verdict: **STAY provider-backed for live segmentation; HYBRID (local) only for a future asset library, and only if the library gains images**

- **There is no live paid segmentation/cutout call to offload today.** The only segmentation route (`POST /api/segment/furnishings`) reaches a provider through `client.subscribe(LOGICAL_MODEL.SAM_3_1_IMAGE, …)` (`src/lib/segment-furnishings-service.ts:118-120`, `:261`), but the only wired provider is Alibaba DashScope, whose `resolveAlibabaModel()` throws for anything but `FLUX_FILL` (`src/lib/alibaba-adapter.ts:106-121`), and the `fal` / `replicate` providers — the ones that used to serve SAM — throw at configure time (`src/lib/inference.ts:286-300`, `:318-330`). No client calls the route; the editor renders hard-coded placeholder detections (`src/components/edit-room/EditRoomStudio.tsx:718-734`). **So the premise "offload paid fal.ai calls" describes a path that no longer runs in this tree** — a contradiction with the issue text, reported in §7.
- **The paid call that *does* run is the inpaint, and it is Alibaba/DashScope, not fal.ai.** `ALIBABA_INPAINT_MODEL=qwen-image-2.1-pro` (`.env.example:41`), resolved in `resolveAlibabaModel()` (`src/lib/alibaba-adapter.ts:106-121`), costing **~$0.04/image** (repo-sourced: `src/lib/api-quota.ts:39`, `src/app/api/inpaint/route.ts:324`, `bake-off/RESULTS.md:15`). **BiRefNet does not inpaint**, so a local cutout utility cannot reduce that line at all.
- **Cost of the current cutout path is not knowable from this repo.** The repo contains **no price for SAM 3.1**; the only figure anywhere in the tree is an external one quoted in the sibling doc (`docs/birefnet-cutout-assessment.md:16`, $0.005/request for `fal-ai/sam-3/image`, a *different* model id from the repo's `fal-ai/sam-3-1/image`, `src/lib/furnishing-detection.ts:32`). It is reproduced below as an **UNVERIFIED external assumption — needs checking**. Against that assumption the segment surface's worst case is ~$0.50 per user per day (`DEFAULT_DAILY_SEGMENT_LIMIT = 100`, `src/lib/api-quota.ts:58`), which is a guardrail, not an observed spend.
- **A local BiRefNet utility has no per-call API price to compare against** — it converts a per-call API cost into amortised GPU/electricity/ops cost. This repo has **no GPU footprint and no local-inference seam**: the provider abstraction is an HTTP/job interface (`InferenceClient.subscribe/submit/status/result`, `src/lib/inference.ts:156-200`) and the only wired implementation is a hosted HTTP client. No VRAM, throughput, or electricity figure is asserted here (§3.3).
- **Task mismatch for the live path:** SAM-style segmentation returns **one mask per detected object** (up to 30, `src/lib/furnishing-detection.ts:45`; `src/lib/furnishing-detection.ts:12-24`), while a BiRefNet-style cutout produces **one salient foreground**. A cluttered room photo has no single foreground. This is a code-shape argument, not a quality claim (§2.4).
- **The repo's mask representation is binary**, so even a good soft alpha would be thresholded away on the current consumption path (`MASK_PIXEL_THRESHOLD = 128`, `src/lib/mask-coverage.ts:26`; `CUTOUT_ALPHA_THRESHOLD = 128`, `src/lib/mask-flood-fill.ts:43`). A local cutout that must keep alpha needs a *new* consumer, not a swapped provider (§4.3).
- **The named integration target does not exist yet:** `MaterialSwatch` (`prisma/schema.prisma:241-256`) and `ProcurementItem` (`prisma/schema.prisma:260-277`) have **no image field at all** — no `imageUrl`, no `url`, no `cutoutUrl`. There is no asset library to offload work *into* (§2.5).
- **Recommendation:** **stay provider-backed** for anything user-facing and live (the inpaint stays DashScope; segmentation stays where it is, dormant, until a provider is wired or the client calls the route again). **Hybrid, deferred:** if and when swatch/procurement imagery is added, run a **local** cutout as a *batch, offline, cached* step for that imagery only — never inside a request path. **The follow-up that unblocks the decision is a GPU run under the protocol in §5**; this machine cannot run it (no GPU, and the brief forbids downloading weights), so that run remains an open follow-up and is not faked here.

---

## 1. Scope, method, evidence rules

### 1.1 The question

Three questions, per the brief: (1) where paid segmentation/cutout work happens today; (2) what it costs per image versus a local BiRefNet utility; (3) a concrete recommendation with exact integration points if adopted.

### 1.2 Evidence rules applied

1. Every claim about **this repo** cites a `file:line` that exists in this worktree (base commit `fed6870`).
2. Every **price or figure not found in this repo** is labelled **UNVERIFIED external assumption — needs checking** and its assumption is stated in the same sentence.
3. Repo code/config **outranks** the issue text; where they conflict, §7 reports the conflict instead of picking a winner silently.
4. No quality claim is made about BiRefNet (or any model) anywhere in this document. Nothing here asserts that a local cutout would look good.
5. Licence/runtime facts about BiRefNet are **not re-verified here** (no network in this sandbox). They are inherited from the sibling doc with that label attached (`docs/birefnet-cutout-assessment.md:13-14` — MIT licence; ONNX / transformers.js builds).

### 1.3 What was NOT run, and why

| Not run | Why | Consequence |
| --- | --- | --- |
| BiRefNet (or any matting model) — no weights downloaded, no inference | This machine has **no GPU**, the sandbox has neither `torch` nor `onnxruntime` (the sibling #1458 doc recorded `ModuleNotFoundError` for both at `docs/1458-soft-matte-evaluation.md:41`), and the brief forbids downloading or running a model | **No quality, latency, VRAM, or throughput number exists in this document.** §4 and §5 are design + protocol, not results |
| Any fal.ai call | Paid API; forbidden by the brief and by the repo's own spend discipline (`src/lib/fal-spend-guard.ts`) | No live provider latency or price observed |
| Any DashScope / Alibaba call | Paid API; forbidden by the brief | No live inpaint images, no observed price |
| Any network fetch (fal model pages, Hugging Face, upstream licence files) | No network in this sandbox | External figures are inherited-from-sibling or labelled UNVERIFIED, never asserted as verified |

**Cutout quality was not evaluated.** There is no evidence in this document that BiRefNet produces better, equal, or worse cutouts than the provider path.

---

## 2. Q1 — Where paid segmentation / cutout work happens today

### 2.1 Inventory (code, not issue text)

| Concern | What the code does today | Citation |
| --- | --- | --- |
| Provider registry | Exactly one logical model is wired for the inpaint (`FLUX_FILL`); the segmentation logical model still exists (`SAM_3_1_IMAGE: "sam-3-1-image"`) | `src/lib/inference.ts:46-51` |
| Provider selection | `INFERENCE_PROVIDER` defaults to `"alibaba"`; `fal` / `replicate` parse but **throw at configure time** (retired in #1240) | `src/lib/inference.ts:69-90`, `:286-300`, `:318-330`; `.env.example:47` |
| **Inpainting** | Alibaba Cloud DashScope multimodal-conversation endpoint; model id from `ALIBABA_INPAINT_MODEL`, default `qwen-image-2.1-pro` | `src/lib/alibaba-adapter.ts:44`, `:54-58`, `:106-121`; `.env.example:41` |
| Inpaint wire body | `{ model, input.messages[{image,text}], parameters:{ n, watermark, prompt_extend, strength, seed?, size } }` — **no mask field** | `src/lib/alibaba-adapter.ts:198-224` |
| Inpaint payload builder | `buildAlibabaFillPayload()` returns exactly `{ image_url, prompt }` — the mask is dropped before the wire | `src/lib/prompts.ts:448-457`, `:539-551` |
| **Segmentation** | `POST /api/segment/furnishings` → `runFurnishingDetection()` → `client.subscribe(LOGICAL_MODEL.SAM_3_1_IMAGE, …)` → Alibaba adapter → **exhaustiveness throw** | `src/app/api/segment/furnishings/route.ts:143`; `src/lib/segment-furnishings-service.ts:118-120`, `:261`; `src/lib/alibaba-adapter.ts:106-121` |
| Segmentation model id & contract | `fal-ai/sam-3-1/image`; bare concept prompt (default `"furniture"`); `return_multiple_masks: true`, `max_masks: 30`, `include_scores: true`; returns **one alpha-cutout PNG per detected object** | `src/lib/furnishing-detection.ts:12-24`, `:32`, `:42`, `:45`, `:104-118` |
| Segmentation quota | `segment` surface, `DEFAULT_DAILY_SEGMENT_LIMIT = 100` per user per day, claimed **before** the paid call and refunded on failure | `src/lib/api-quota.ts:52`, `:58`, `:71-72`; `src/app/api/segment/furnishings/route.ts:117-140` |
| Inpaint quota | `inpaint` surface, `DEFAULT_DAILY_INPAINT_LIMIT = 20` per user per day | `src/lib/api-quota.ts:54`, `:67-69` |
| Other paid surfaces | OpenAI copy (gpt-4o-mini), OpenAI vision instance labels, Browserless PDF export | `src/lib/api-quota.ts:1-8`, `:39-43`; `src/lib/label-instances-service.ts:1-12` |
| **Mask / cutout consumption** | Provider masks are decoded **format-agnostically**: alpha-cutout *or* grayscale-white-on-black; pixels are rebuilt with alpha derived from the classification | `src/lib/mask-format.ts:31-42`, `:69-90`; `src/lib/mask-flood-fill.ts:43`, `:55-65` |
| Mask → binary | Both classifiers threshold at 128: `MASK_PIXEL_THRESHOLD = 128` (luminance + alpha) and `CUTOUT_ALPHA_THRESHOLD = 128` (alpha) | `src/lib/mask-coverage.ts:26`, `:33-36`; `src/lib/mask-flood-fill.ts:43`, `:65` |
| Overlay rendering | Per-instance tinted overlays built from the returned `maskDataUrls` | `src/lib/instance-overlays.ts:64-90` |
| Segment result cache | In-process LRU: 8 entries / 8 MiB of mask data URLs | `src/lib/segment-cache.ts:74-75`, `:104-105` |
| Holistic (one-click) masks | Full-room RGBA buffers (alpha always 255) serialised to a data-URL PNG for the inpaint route | `src/lib/holistic-mask.ts:1-26` |
| Client-side mask editing | Freehand brush mask, feathered client-side before upload | `src/lib/mask-feather.ts` (implementation `src/lib/mask-feather.ts:67`), applied to the brush mask before upload (`src/app/(dashboard)/projects/[id]/project-detail-view.tsx:1630`; chain traced in `docs/1458-soft-matte-evaluation.md:122`) |

### 2.2 What is *live* versus what is *dormant*

- **Live and paid:** the **inpaint** (Alibaba DashScope) and the OpenAI / Browserless surfaces. These are the only provider calls a user can trigger.
- **Dormant / unreachable:** the whole segmentation path. The route exists, is auth-checked, quota-guarded and unit-tested (`tests/api/segment-furnishings-partial-masks.test.ts`), but its provider dispatch cannot succeed: `getInferenceClient()` returns the Alibaba client (`src/lib/inference.ts:318-330`), and `resolveAlibabaModel("sam-3-1-image")` hits the exhaustiveness `throw` (`src/lib/alibaba-adapter.ts:113-121`).
- **Not wired to any client:** `grep -rn "segment/furnishings" src/` returns only route handlers, the service, the zod schema, and comments — **no `fetch` call**. The editor's concept chip only sets local state, and the inspector receives two hard-coded placeholder detections (`src/components/edit-room/EditRoomStudio.tsx:716-734`).

**Consequence for this issue:** there is currently **no paid fal.ai segmentation spend to offload**. The spend that a cutout utility would sit next to is the *inpaint* line, and a cutout model cannot serve the inpaint (§2.4).

### 2.3 Where a mask/cutout would be consumed if a local utility existed

Chain a local cutout would have to plug into (all repo-named):

1. **Producer** — either the segmentation route's provider call (`src/lib/segment-furnishings-service.ts:261`, currently `deps.subscribe`) or a new offline/batch step (§4.2).
2. **Decode + classify** — `maskGridFromProviderPixels()` (`src/lib/mask-format.ts:31`) already accepts an **alpha-cutout** PNG (it branches to `maskGridFromAlphaPixels` when any pixel has alpha < 128, `src/lib/mask-format.ts:40-42`). A BiRefNet-style RGBA output therefore decodes through the *existing* path with no format change — this is the single strongest structural argument for a local cutout in this repo.
3. **Consumers** — overlays (`src/lib/instance-overlays.ts:77-84`), union/coverage checks (`src/lib/mask-coverage.ts:39-58`), the one-click preset union (`src/lib/holistic-mask.ts`), and finally the inpaint mask upload (`src/components/canvas/use-inpaint-runs.ts:322` → `src/app/api/inpaint/route.ts:301` → `src/lib/inpaint-submit.ts:375`).

### 2.4 Task-shape mismatch (code argument, not a quality claim)

- The segmentation contract is **per-object**: `return_multiple_masks: true`, `max_masks: 30` (`src/lib/furnishing-detection.ts:45`, `:104-118`), and the module doc records that a bare concept prompt returned **9 per-object masks** on the probe photo while multi-term prompts returned zero (`src/lib/furnishing-detection.ts:12-24`).
- The consumer contract is **per-instance**: `maskDataUrls` is an array parallel to `scores` and to per-instance vision labels (`src/lib/segment-cache.ts:52-61`), and the overlay builder indexes instances positionally (`src/lib/instance-overlays.ts:77-84`).
- A single-salient-foreground cutout produces **one** mask. To satisfy the existing contract it would have to be run once per object region — i.e. N model invocations per room photo, against a route whose daily cap is 100 *detection calls* (`src/lib/api-quota.ts:58`). Nothing in this repo establishes that such a decomposition is available; it is not claimed here.

### 2.5 The named integration target: swatch / procurement imagery

| Model | Fields | Citation |
| --- | --- | --- |
| `MaterialSwatch` | `id, projectId, name, hexCode, materialType, useCase, vendor?, sku?, sortOrder` — **no image field** | `prisma/schema.prisma:241-256` |
| `ProcurementItem` | `id, projectId, category, item, description?, status, sku?, estCost?, vendor?, notes?, sortOrder, createdAt, updatedAt` — **no image field** | `prisma/schema.prisma:260-277` |
| Their write paths | `saveMaterialSwatch` / `saveProcurementItems` accept no image input | `src/app/actions/material-swatch.ts:20-40`, `src/app/actions/procurement.ts:14-30` |

**There is no asset library and no swatch imagery in the data model.** "Offloading paid fal.ai calls for the swatch/asset library" therefore describes a *feature that does not exist yet*; the assessment's job is to say what it would cost and where it would attach, not to optimise an existing pipeline.

---

## 3. Q2 — Cost per image: provider-backed cutout path vs a local BiRefNet utility

### 3.1 Repo-sourced figures (these are the only ones asserted as facts)

| Figure | Value | Source | Provenance |
| --- | --- | --- | --- |
| DashScope Qwen-Image-2.1-Pro inpaint | **~$0.04 / image** | `src/lib/api-quota.ts:39`; `src/app/api/inpaint/route.ts:324`; `bake-off/RESULTS.md:15` (also `:39`) | Repo code comment + repo bake-off table (the bake-off notes it as "per Alibaba pricing", i.e. a list-price snapshot from the bake-off run of 2026-10-12) |
| Inpaint wall-clock (same provider) | 32.1–38.0 s at 2048×1536 | `bake-off/RESULTS.md:15` | Repo bake-off measurement |
| Inpaint wall-clock (production note) | "~30 s", synchronous | `src/app/api/inpaint/route.ts:26-34` | Repo code comment |
| fal FLUX.1 [pro] Fill (mask-fill) | $0.05 / megapixel | `bake-off/RESULTS.md:11`, `:23` | Repo bake-off table |
| fal z-image-turbo-inpaint (mask-fill) | $0.01 / megapixel | `bake-off/RESULTS.md:17` | Repo bake-off table |
| fal flux-kontext-lora-inpaint (mask-fill) | $0.035 / megapixel | `bake-off/RESULTS.md:18` | Repo bake-off table |
| OpenAI gpt-4o-mini copy | ~$0.0002 / generation | `src/lib/api-quota.ts:40-41` | Repo code comment ("approximate list prices, Oct 2026 — re-check before relying on these", `src/lib/api-quota.ts:38`) |
| Browserless PDF export | ~$0.001–0.006 / export | `src/lib/api-quota.ts:42-43` | Repo code comment |
| Segment daily cap | 100 calls / user / day | `src/lib/api-quota.ts:58` | Repo code |
| Inpaint daily cap | 20 calls / user / day | `src/lib/api-quota.ts:54` | Repo code |

### 3.2 The cutout/segment line — no repo price

- **The repo contains no price for SAM 3.1 (or any segmentation provider).** The only figure anywhere in the tree is in the sibling assessment: "$0.005 per request for `fal-ai/sam-3/image`" with the note that "the repo calls `fal-ai/sam-3-1/image`; its price was not verified" (`docs/birefnet-cutout-assessment.md:16`).
- **UNVERIFIED external assumption — needs checking:** *fal.ai prices `fal-ai/sam-3/image` at $0.005 per request.* Two independent caveats: (a) the model id in the repo is `fal-ai/sam-3-1/image` (`src/lib/furnishing-detection.ts:32`), a different model whose price is unknown; (b) the figure is an external list price, not observed in this repo.
- **Derived-from-unverified figure (shown only to size the cap, not to assert spend):** 100 calls/day/user × $0.005 ≈ **$0.50 per user per day** at the `segment` cap (`src/lib/api-quota.ts:58`). This is a *worst case if every capped call were billed*, not a measurement, and it inherits the unverified price.
- The `segment` cap is a *guardrail*, and the route's own doc records that the paid call happens **after** the atomic quota claim and is refunded on failure (`src/app/api/segment/furnishings/route.ts:117-140`, `src/lib/api-quota.ts:11-14`). Since the route is unreachable in this tree (§2.2), **observed segment spend today is $0.**

### 3.3 The local BiRefNet line — a different *kind* of cost, not a smaller number

Plainly: **a local BiRefNet utility has no per-call API price, so there is no per-image API figure to compare against $0.04 or $0.005.** Its cost is:

- **Capital / ops:** a GPU host. **This repo has no GPU footprint and no local-inference seam.** The provider abstraction is an HTTP/job interface — `InferenceClient.subscribe/submit/status/result` (`src/lib/inference.ts:156-200`) — and the only implementation is a hosted HTTP client (`src/lib/alibaba-adapter.ts:174-181`). The #1446 evaluation reached the same conclusion ("GPU inference service: **No**", `docs/1446-abacus-dcr-sam-qk-edit-evaluation.md:111`).
- **Electricity / idle time:** an amortised cost per image = (host cost × time the host is on) / images produced. **No repo figure exists for any term in that formula, so no per-image number is given here.** Stating one would be inventing it.
- **Latency:** **UNVERIFIED external assumption — needs checking.** No model-latency number for BiRefNet exists in this repo or in the sibling doc, and none may be measured here (no GPU, no weights). The sibling #1458 evaluation measured only the repo's *own* CPU alpha plumbing (~170 ms at 1024×768, `docs/1458-soft-matte-evaluation.md:169`) and explicitly did not measure a matting network.
- **VRAM:** **UNVERIFIED external assumption — needs checking.** The sibling docs refer to "6–8 GB VRAM class hardware" (`docs/1458-soft-matte-evaluation.md:18`, `:168`) as an external expectation; **this document does not assert a VRAM figure**, and §5 makes measuring peak VRAM part of the follow-up.
- **Licence:** BiRefNet is MIT per the sibling doc (`docs/birefnet-cutout-assessment.md:13-14`) — inherited from that doc, **not re-verified here** (no network). MIT is compatible with reuse of code *and* weights with the notice retained.

**The comparison that can honestly be made today:** the local option converts a *variable, metered, per-call* cost into a *fixed, mostly-idle* cost, and that trade only pays off if (a) the host is already paid for, and (b) the volume is high enough to amortise it. Condition (a) is false for this repo today (no GPU footprint), and condition (b) cannot be estimated because the segment path is unreachable (§2.2) and the asset library does not exist (§2.5).

---

## 4. Q3 — If a local cutout utility were adopted: exact integration points

### 4.1 Proposed module and contract (design only — no source change in this slice)

- **Module:** a new pure-ish utility, e.g. `src/lib/birefnet-cutout.ts`, exposing
  `cutout(image: { bytes: Uint8Array } | { url: string }) -> Promise<{ png: Buffer; width: number; height: number }>`.
- **Input contract:** one RGB image (bytes or URL) — the same "one image in" shape the segment route already validates (`furnishingsSegmentRequestSchema`, `src/lib/ai-route-schemas.ts:204`).
- **Output contract:** **one RGBA PNG whose alpha channel is the matte** (alpha 0 = background, alpha 255 = foreground), at the source pixel dimensions — the same shape the segmentation provider is documented to return ("RGBA alpha-cutout PNG at the source image's pixel dimensions", `src/lib/furnishing-detection.ts:20-22`). Optionally a scalar confidence, to sit alongside the provider's `scores` array (`src/lib/furnishing-detection.ts:115`).
- **Why this shape works with zero format churn:** `maskGridFromProviderPixels()` already detects the alpha-cutout format and classifies it by alpha (`src/lib/mask-format.ts:31-42`, `src/lib/mask-flood-fill.ts:43`, `:55-65`), and the cache/overlay/label consumers are all keyed on `maskDataUrls: string[]` (`src/lib/segment-cache.ts:52-61`; `src/lib/instance-overlays.ts:64-90`).

### 4.2 Two distinct integration points (they are not interchangeable)

**Integration point A — asset library (batch, offline, cached). Recommended shape if adopted.**

- Prerequisite: add an image field to `MaterialSwatch` and/or `ProcurementItem` (`prisma/schema.prisma:241-256`, `:260-277`) and an upload path. **This is a schema + UI feature, not a provider swap.**
- Wiring: a one-shot job after upload (a server-side task or an offline operator script) that calls the cutout utility, stores the RGBA PNG in Supabase Storage next to the room photos, and writes the resulting URL onto the row.
- Cost shape: **one model call per product image, amortised, cached** — no per-view cost, no request-path latency, and it does not touch the `segment` or `inpaint` quota surfaces (`src/lib/api-quota.ts:52`).
- Runtime: the repo has no worker/queue for this; `scripts/` contains operator-run harnesses (`scripts/bake-off-image-apis.mts`, `scripts/soft-matte-alpha-probe.mts`), so an **operator-run script** is the lowest-friction form until a queue exists.

**Integration point B — live segmentation (not recommended; contradicts the current contract).**

- Seams that would change: `deps.subscribe` in `defaultSegmentFurnishingsServiceDeps()` (`src/lib/segment-furnishings-service.ts:116-120`) and the model id it passes (`logicalModel: LOGICAL_MODEL.SAM_3_1_IMAGE`, `:120`), plus a new logical model in `LOGICAL_MODEL` (`src/lib/inference.ts:46-51`) and a provider arm in `resolveProvider()` / `getInferenceClient()` (`src/lib/inference.ts:69-90`, `:318-330`).
- **Why not:** the route contract is *one mask per detected object, up to 30* (`src/lib/furnishing-detection.ts:45`, `:104-118`), consumed positionally (`src/lib/instance-overlays.ts:77-84`). A single-foreground cutout does not satisfy that contract (§2.4); and `INFERENCE_PROVIDER` is a **deployment-level flag, not a per-request switch** ("in production we run a single provider at a time", `src/lib/inference.ts:13-14`), so a local model would have to displace the inpaint provider or become a new provider value — a materially larger change than "swap the segmenter".
- The guard in `src/lib/fal-spend-guard.ts` exists precisely to stop a paid call from being reachable outside the quota/abstraction path; a local model added *outside* `InferenceClient` would need that guard's review too.

### 4.3 What would NOT change

- **The inpaint path stays on Alibaba Cloud DashScope / Qwen-Image.** Nothing in a cutout utility touches `resolveAlibabaModel()` (`src/lib/alibaba-adapter.ts:106-121`), the DashScope request body (`src/lib/alibaba-adapter.ts:198-224`), `ALIBABA_INPAINT_MODEL=qwen-image-2.1-pro` (`.env.example:41`), or the ~$0.04/image line (`src/lib/api-quota.ts:39`). A cutout model cannot inpaint; replacing the inpaint provider would be a different issue with a different owner (the same conclusion the #1446 evaluation reached for FLUX: `docs/1446-abacus-dcr-sam-qk-edit-evaluation.md:233-234`).
- **The mask wire format stays binary on the current consumption path.** `MASK_PIXEL_THRESHOLD = 128` (`src/lib/mask-coverage.ts:26`) and `CUTOUT_ALPHA_THRESHOLD = 128` (`src/lib/mask-flood-fill.ts:43`) mean a soft matte is collapsed to 0/1 before use. If a future BiRefNet output must preserve partial alpha, that requires a *new* consumer that keeps the RGBA PNG intact (asset-library rendering) — not a change to the inpaint mask pipeline. (The #1458 evaluation documents this same constraint: `docs/1458-soft-matte-evaluation.md:16`.)
- **The quota surfaces and caps** (`src/lib/api-quota.ts:52-72`) stay as they are; a local cutout would be metered by *wall-clock/host*, not by `DailyApiUsage`.
- **The inpaint request path, the freehand brush mask, the client-side feathering** (`src/lib/mask-feather.ts:67`) and the one-click holistic presets (`src/lib/holistic-mask.ts`) are untouched.

---

## 5. Q4 — Evaluation protocol for the follow-up GPU run (reproducible)

This is the deliverable that makes the follow-up cheap to run. **It has not been run.** It is written so that a single GPU-equipped machine can execute it end-to-end and produce the evidence that §6's decision bar needs.

### 5.1 Preconditions (the blocker to state loudly)

- A machine with a CUDA GPU and Python with `torch` (or an ONNX runtime) installed. The repo's own sandbox is not one: no GPU, and `torch` / `onnxruntime` are absent (`docs/1458-soft-matte-evaluation.md:41`). **Any run must record the GPU model, driver, CUDA version, and the exact model build + hash.**
- Weights: use the MIT build referenced by the sibling doc (`docs/birefnet-cutout-assessment.md:14` — `onnx-community/BiRefNet-ONNX`, MIT). **UNVERIFIED external assumption — needs checking**: that build's licence and file list must be confirmed on the run machine (no network here). Record the exact revision.

### 5.2 Sample set

**Tier 1 — repo fixtures (already committed, no collection needed):**

| File | Why it is in the set | Citation |
| --- | --- | --- |
| `bake-off/befores/vacant-insert__before.jpg` | real room photo used by the inpaint bake-off | `bake-off/befores/` |
| `bake-off/befores/occupied-replace__before.jpg` | real room photo, occupied variant | `bake-off/befores/` |
| `bake-off/befores/repeat-stability__before.jpg` | real room photo, repeat case | `bake-off/befores/` |
| `docs/demo/issue-248-verification-living-room.jpg` | the demo room photo used to verify detection overlays | `docs/demo/` |

**Tier 2 — hard cases (must be collected by the operator; the repo contains no such imagery):** ≥ 3 examples each of

- **plants** (fine foliage, gaps between leaves, semi-transparent edges),
- **sheer curtains** (partial transparency across the whole object),
- **glassware** (specular highlights, see-through body).

Plus ≥ 10 **isolated product shots** (single object, plain or lifestyle background) — the case a salient-object cutout is actually built for. Sources: operator's own catalogue photography; **do not** pull licensed third-party imagery into the repo.

**Tier 3 — the baseline the comparison needs:** the same Tier-1 + Tier-2 images through the **existing provider path** (`POST /api/segment/furnishings`, `src/app/api/segment/furnishings/route.ts:143`), **if and only if** a provider is wired by then (see §5.6 — it currently is not). If no provider can be wired, record the baseline as **unavailable** and evaluate against manual ground truth only.

### 5.3 Ground truth

For each sampled image, hand-label a **binary object polygon** (or per-object polygons) in a simple editor, stored as PNG alpha (the repo's own representation) in a `ground-truth/` folder next to the run output. Ground truth is required for the quantitative metrics below; without it, only the subjective failure-mode taxonomy is possible.

### 5.4 Metrics (all computable offline on the GPU machine)

| Metric | Definition | Why |
| --- | --- | --- |
| **IoU** | intersection / union of predicted alpha ≥ 128 and ground-truth alpha, per instance | direct agreement with the repo's own binary convention (`src/lib/mask-coverage.ts:26`) |
| **Boundary F-score** | precision/recall of predicted-vs-true boundary pixels within a 2 px tolerance | catches halo/erosion errors that IoU hides |
| **Alpha MAE / soft-IoU** | mean |a_pred − a_gt| and IoU on the *continuous* alpha (before thresholding) | the only way to score translucent cases (curtains/glass) fairly; also tests whether alpha survives at all |
| **Background residue** | mean alpha in the ground-truth background region | catches the classic "shadow/hair halo" failure |
| **Edge halo** | fraction of foreground-boundary pixels whose alpha is < 128 (a broken edge) | this is the exact defect the repo already fights with erosion (`docs/issues/1457-mask-erosion.md`) |
| **Latency** | seconds/image on the target GPU, batch=1 (report the median of 10) | compare against the inpaint's 32–38 s (`bake-off/RESULTS.md:15`) and the ~30 s note (`src/app/api/inpaint/route.ts:26-34`) |
| **Peak VRAM** | `nvidia-smi` peak during a run | replaces the unverified "6–8 GB" figure with a measurement |
| **Cost per image** | (host hourly cost × wall-clock) / images produced — with the hourly cost **stated as an input by the operator** | makes the amortisation explicit instead of inventing a per-call price |
| **Failure-mode label** | per image: `clean` / `halo` / `missing-thin-part` / `background-kept` / `wrong-object` / `no-alpha` | gives the qualitative record the brief forbids faking |

### 5.5 Decision bar (this is what flips the recommendation)

**Adopt for the asset library (Integration point A) if ALL hold:**
1. Median IoU ≥ 0.90 on isolated product shots, and ≥ 0.80 on room photos.
2. Boundary F-score ≥ 0.90 at 2 px tolerance on the same sets.
3. Background residue ≤ 0.02 (mean alpha in background) and edge-halo fraction ≤ 0.05.
4. On the hard cases (plants / sheer / glassware): **≥ 70 % of instances rated `clean` or `acceptable` by a human rater**, and **no** catastrophic failure (wrong object, or output with no alpha at all) on more than 1 image in 10.
5. Measured cost per image on the operator's host ≤ **¼ of the provider path's per-image cost** — and since the provider segment price is **UNVERIFIED**, this criterion must be evaluated *after* the provider price is checked (§5.6), or the run must report cost per image in absolute units and defer the comparison.
6. Median latency ≤ 30 s/image batch=1 (i.e. not worse than the inpaint's measured 32–38 s band, `bake-off/RESULTS.md:15`) — otherwise it cannot sit in a user-facing path.

**Adopt for the live segmentation path (Integration point B) if ALL hold:**
1. A method exists to emit **per-object** masks from the local model, matching the route's contract (≤ 30 masks per call, `src/lib/furnishing-detection.ts:45`).
2. The per-object masks score ≥ the provider baseline on the same images (baseline currently unavailable — §5.3 Tier 3).
3. The N-invocations-per-photo cost still fits the `segment` cap semantics (`src/lib/api-quota.ts:58`) — i.e. one room photo must not consume 30 quota units without a deliberate design change.

**Recommendation flips to "stay provider-backed" (no local cutout anywhere) if:**
- Criterion 3 or 4 fails on the hard cases (the repo's mask pipeline is binary and threshold-based — `src/lib/mask-coverage.ts:26` — so a soft-matte advantage cannot be spent on the current path anyway), **or**
- the measured per-image cost on the operator's host is not at least 4× cheaper than the verified provider price, **or**
- no GPU host is available to the project at all (the case today).

### 5.6 Two blockers that are not about the model

1. **No provider baseline today.** The segment route cannot reach a provider in this tree (`src/lib/alibaba-adapter.ts:106-121`; `src/lib/inference.ts:286-300`). Either wire a provider for the baseline arm, or accept ground-truth-only evaluation.
2. **No provider price today.** The repo has no SAM price; the only candidate figure is external and for a different model id (`docs/birefnet-cutout-assessment.md:16`). Whoever runs the follow-up must **check the live price of `fal-ai/sam-3-1/image`** and record it, replacing the UNVERIFIED label.

### 5.7 Estimated effort (engineering estimate — not a measurement)

| Step | Estimate | Note |
| --- | --- | --- |
| Set up the GPU environment, fetch + hash the MIT ONNX build | 0.5 day | one-time; includes the licence re-check of §5.1 |
| Write the run harness (repo-style script under `scripts/`, mirroring `scripts/soft-matte-alpha-probe.mts`) | 0.5 day | must not touch `src/` |
| Collect Tier-2 hard cases | 0.5 day | operator |
| Hand-label ground truth (≈ 25 images) | 0.5–1 day | the hidden cost; budget it explicitly |
| Run + score (metrics of §5.4) | 0.25 day | offline, CPU scoring of alpha PNGs |
| Write up results into this file | 0.25 day | |

**Total ≈ 2.5–3 days of human effort + one GPU session.** No figure in this table is a measurement; it is an estimate and should be treated as such.

---

## 6. Q5 — Recommendation

**Stay provider-backed for everything live; adopt a local cutout only as a deferred, batch, asset-library step if and when swatch/procurement imagery exists. Recommendation: HYBRID, deferred, gated on §5.**

Reasoning, strictly from §1–§4:

1. **There is no paid fal.ai segmentation spend to offload.** The fal/replicate adapters were retired in #1240 and throw at configure time (`src/lib/inference.ts:286-300`, `:318-330`); the Alibaba adapter has no SAM arm (`src/lib/alibaba-adapter.ts:106-121`); no client calls the route (`src/components/edit-room/EditRoomStudio.tsx:718-734`). A local utility aimed at "offloading fal.ai calls" would be aimed at a path that does not run — and would buy nothing measurable.
2. **The live paid line is the inpaint, and BiRefNet cannot serve it.** DashScope `qwen-image-2.1-pro` at ~$0.04/image (`src/lib/api-quota.ts:39`, `src/app/api/inpaint/route.ts:324`, `bake-off/RESULTS.md:15`) is a generative-inpaint call; a segmentation/matting model is not a substitute, and the inpaint wire body carries no mask field at all (`src/lib/alibaba-adapter.ts:198-224`, `src/lib/prompts.ts:448-457`). Offloading the inpaint line is a different issue.
3. **The contract mismatch is structural, not a quality question.** The live segmentation contract is per-object and capped at 30 masks (`src/lib/furnishing-detection.ts:45`); a salient-foreground cutout yields one. Until the per-object decomposition exists, swapping the provider behind `deps.subscribe` (`src/lib/segment-furnishings-service.ts:116-120`) would break the positional consumers (`src/lib/instance-overlays.ts:77-84`).
4. **The asset-library target does not exist.** `MaterialSwatch` and `ProcurementItem` carry no image fields (`prisma/schema.prisma:241-256`, `:260-277`). Any "offload for the swatch library" plan is a **feature proposal** (schema + upload + storage + a cutout job), not a provider swap — and its cost case should be built when the volume is known, not now.
5. **The cost argument does not close today.** A local utility has no per-call price; it converts to amortised host cost, and the repo has no GPU footprint and no local-inference seam (`src/lib/inference.ts:156-200`; `docs/1446-abacus-dcr-sam-qk-edit-evaluation.md:111`). The provider-side number it would be compared against does not even exist in the repo (§3.2).
6. **What is genuinely cheap and structural:** the decode side already speaks "alpha-cutout PNG" (`src/lib/mask-format.ts:31-42`), and the asset-library use case is *batch + cached + off the request path* — so if the library ships with images, a local cutout is the right shape (no latency budget, no quota surface, run once per image). That is why the recommendation is **hybrid**, not "never".

**What would flip this recommendation:** the §5 run, plus a verified provider price for `fal-ai/sam-3-1/image`. Until then, the honest position is: *no measurable saving is available today, and the follow-up is cheap (≈ 2.5–3 days) precisely because the sample set, metrics, and pass bar are fixed above.*

---

## 7. Contradictions between the issue text and the code (reported, not resolved silently)

| # | Issue text says | This tree says | Citation |
| --- | --- | --- | --- |
| 1 | fal.ai handles SAM segmentation | fal/replicate are **retired**; `assertInferenceConfigured()` and `getInferenceClient()` throw for them; the only wired provider is Alibaba | `src/lib/inference.ts:286-300`, `:318-330`; `.env.example:47` |
| 2 | SAM segmentation is a current paid flow | The segment route exists and is quota-guarded, but its provider dispatch hits the Alibaba exhaustiveness `throw`; **no client calls it**; the editor renders hard-coded placeholder detections | `src/lib/segment-furnishings-service.ts:118-120`, `:261`; `src/lib/alibaba-adapter.ts:106-121`; `src/components/edit-room/EditRoomStudio.tsx:716-734` |
| 3 | Inpainting is Alibaba Cloud Model Studio / DashScope `qwen-image-2.1-pro`, default `ALIBABA_INPAINT_MODEL` | **Confirmed by code** — the only part of the issue's premise that the tree supports | `.env.example:41`; `src/lib/alibaba-adapter.ts:106-121`; `src/app/api/inpaint/route.ts:324` |
| 4 | The goal is to "offload paid fal.ai calls" | There is no paid fal.ai call to offload; the remaining paid surfaces are DashScope (inpaint), OpenAI (copy/labels), Browserless (PDF) | `src/lib/api-quota.ts:1-8`, `:39-43` |
| 5 | The swatch/asset library is a place to send cutouts | Neither `MaterialSwatch` nor `ProcurementItem` has any image field; there is no asset library in the data model | `prisma/schema.prisma:241-256`, `:260-277` |
| 6 | (repo-internal) the segment surface is a paid DashScope SAM 3.1 call | The quota module's own header calls the `segment` surface "Alibaba Cloud DashScope SAM 3.1 segmentation", but the only SAM model id in the tree is fal's `fal-ai/sam-3-1/image` (`src/lib/furnishing-detection.ts:32`) and the Alibaba adapter has no SAM arm (`src/lib/alibaba-adapter.ts:106-121`). The header names an intent the dispatch does not implement | `src/lib/api-quota.ts:1-8`; `src/lib/furnishing-detection.ts:32` |
| 7 | (implicit) a local cutout would replace the provider cutout | The repo's mask representation is binary (threshold 128 in two places), so a soft alpha is collapsed before use — a local cutout's soft-matte advantage cannot be spent on the current path without extra work | `src/lib/mask-coverage.ts:26`; `src/lib/mask-flood-fill.ts:43`; `docs/1458-soft-matte-evaluation.md:16` |

---

## 8. Open follow-ups (explicitly *not* done here)

1. **The GPU evaluation run** — §5, in full. Not run: no GPU on this machine, no model downloaded, no quality claim made. **This is the blocking follow-up for any adoption decision.**
2. **The provider price check** — the live price of `fal-ai/sam-3-1/image` (the repo's model id, `src/lib/furnishing-detection.ts:32`), to replace the UNVERIFIED $0.005 figure inherited from `docs/birefnet-cutout-assessment.md:16` (which quotes a *different* model, `fal-ai/sam-3/image`).
3. **A decision on whether segmentation should be revived at all.** If the segment route stays unreachable, both "provider-backed segmentation" and "local BiRefNet segmentation" are moot. That decision (wire a provider / re-point the client / delete the route) is upstream of this issue.
4. **Licence re-verification** of the BiRefNet ONNX build on a networked machine (§5.1), since this sandbox has no network.
5. **The asset-library feature spec** (schema fields for imagery, upload/storage path, cutout job) — a prerequisite for Integration point A (§4.2), and out of scope for this assessment.

---

*All `file:line` citations in this document refer to this worktree at base commit `fed6870`. Figures marked "UNVERIFIED external assumption — needs checking" are not verified here and must not be relied on for a spend decision until §8.2 is closed.*
