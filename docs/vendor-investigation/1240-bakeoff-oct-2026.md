# Bake-off: Latest Image Editing APIs vs FLUX.1 Fill for Staging (#1240)

**Issue:** [#1240](https://github.com/anchapin/staging-studio/issues/1240)
**Date:** 2026-10-13
**Stakeholders:** Engineering, Product (Circle G Designs), Alex (sign-off)
**Status:** **Research-only. No provider flip.** Awaiting Alex's sign-off before any production change.

---

## 1. Scope and constraints

This is a **ranked bake-off**, not a market survey and not a provider flip. The current production
inpaint provider as of #1240 is **Alibaba Cloud DashScope** (`qwen-image-2.1-pro`), reached through
the provider-agnostic `InferenceClient` in `src/lib/inference.ts` and the adapter in
`src/lib/alibaba-adapter.ts`. The fal / Replicate adapters were retired as part of #1240; their
adapter modules were deleted, and the `"fal"` / `"replicate"` values of `INFERENCE_PROVIDER` are
parsed but throw a clear error at configure time so a stale deploy surfaces the issue rather than
silently falling through.

Constraints (per the issue body and the orchestrator's instructions):

- **No paid API calls from this research.** This bake-off relies on public documentation, prior
  investigations in the repo (`docs/vendor-investigation/235-gpt-image-vs-nano-banana-vs-fal.md`,
  `docs/spikes/233-qwen-variant-spike.md`, `docs/spikes/235-vendor-investigation.md`), and the
  known wire shapes of each provider. They are documented evidence, not benchmark numbers.
- **No production code touched.**
- **No provider flip without Alex's sign-off.**

What this document **is**: a research deliverable that ranks the six candidate models on the
methodology the issue prescribes (vacant / occupied / repeat-edit cases × fidelity / realism /
price / latency), names a top-3, and flags which (if any) deserve a follow-up empirical probe
inside the $50 API budget the issue mentions.

What this document **is not**: a benchmark, a model card, or a go-decision. The numbers below are
directional, sourced from each vendor's public pricing page and the existing repo investigations,
not from paid probe runs against the live APIs.

---

## 2. Current production baseline (already in the codebase)

| Aspect | Value |
|---|---|
| Provider | Alibaba Cloud DashScope |
| Model | `qwen-image-2.1-pro` (Singapore-verified; `ALIBABA_INPAINT_MODEL` env override) |
| Endpoint | `/api/v1/services/aigc/multimodal-generation/generation` (workspace-scoped, ap-southeast-1) |
| Mask channel | ❌ **None** — the wire format is image+prompt only; mask-based control is **not** first-class |
| Synchronous? | ✅ One round-trip, the URL is returned in the POST response |
| Daily cap | 20 inpaint / user (`DAILY_INPAINT_LIMIT`), per-image ($0.04/image on Singapore) |
| Adapter | `src/lib/alibaba-adapter.ts`; `submit` returns `{ request_id, result }` inline (#1240 multi-instance fix) |
| Env | `ALIBABA_DASHSCOPE_API_KEY`, `ALIBABA_BAILIAN_WORKSPACE_ID`, `ALIBABA_INPAINT_MODEL` |
| Compensation hacks required | None on the wire; the editor uses mask+dilation+FRAMING_CONTEXT regardless |

The **absence of a mask channel** is the structural reason a bake-off is interesting. The current
Qwen model is excellent at creative generation but treats the masked region as a *suggestion*,
which is why the codebase wraps it in `mask-dilation.ts`, `mask-postprocess.ts`, and
`FRAMING_CONTEXT` in `src/lib/prompts.ts`. A model with a **first-class mask channel** could
retire or shrink that compensation surface — the issue's premise.

---

## 3. Vendor profiles

### 3.1 FLUX.1 Fill Pro — incumbent (via fal, retired in #1240)

- **Endpoint:** `fal-ai/flux-lora-fill` (fal queue; submit + status + result polling)
- **Mask channel:** ✅ **First-class.** Binary RGBA mask via `image_url` + `mask_url`. White=regenerate,
  black=preserve. This is the property the staging editor's mask-painting UX was designed around.
- **Latency:** Queue-based, ~2s submit + variable queue + ~7–12s generation (per `docs/spikes/233-qwen-variant-spike.md`).
  StagingStudio's `useInpaintRuns` polls every few seconds and renders a `<Run>` per status.
- **Price:** $0.035 / megapixel (fal.ai). A 2048×1536 staged room = ~3.1 MP ≈ $0.11/image.
- **Compensation hacks in this repo (FLUX-specific):**
  - `mask-dilation.ts` — isotropic (DEFAULT_MASK_EXPANSION_RADIUS=15px) and anisotropic
    (`dilateMaskGridDirectional`, k=2 vertical bias for floor shadows, #234)
  - `FRAMING_CONTEXT` suffix in `src/lib/prompts.ts:buildInpaintPrompt`
  - Negative prompt "walls, windows, trim, doors, molding, structural columns…" in `NEGATIVE_PROMPT`
  - `guidance: 7.5, num_inference_steps: 28` in `buildFalFillPayload`
- **Latent fit for staging:** **High.** Already production-validated; architecture preservation is the
  reason it was chosen. Removed in #1240 because (a) the queue+poll lifecycle is heavier than the
  editor needs and (b) Alibaba's per-image pricing is more predictable than per-megapixel.

### 3.2 FLUX 3 Image (Black Forest Labs, Oct 1)

- **Endpoint:** BFL native API; **not yet** confirmed on fal.ai's queue as of 2026-10-13. If BFL
  follows its previous release pattern, a `fal-ai/flux-3-image` endpoint should appear within days;
  treat that as **provisional** until verified.
- **Mask channel:** ✅ **First-class.** Two input modes per BFL docs: (a) prompt-only edit, or
  (b) JSON `{"bbox": [x1, y1, x2, y2]}` array for region-locked edits. Untouched pixels are
  **numerically locked** — the wire format returns a deterministic base64/URL for unmasked regions
  rather than a regenerated-but-similar copy. This is the property the issue highlights.
- **Latency:** Synchronous (BFL native); typical 5–10s for a 1024×1024 edit. Queue time if served via
  fal will be added on top.
- **Price:** **Unverified** at the time of writing. BFL's pricing history: FLUX.1 Pro $0.05/MP,
  FLUX.1 Fill $0.035/MP. Estimate for FLUX 3: $0.05–$0.10/MP — directional, not benchmarked.
- **Fit for staging:** **Promising but unverified.** The pixel-lock property would *retire* the
  `mask-dilation.ts` compensation if BFL's mask semantics match FLUX.1 Fill's white=regenerate
  convention. Needs a one-shot probe against `fal-ai/flux-3-image` (if/when listed) with a known
  before/after fixture to verify the boundary behavior under our dilation conventions.

### 3.3 Seedream 5.0 Flash (ByteDance, Oct 1, BytePlus)

- **Endpoint:** BytePlus Model Studio `seedream-5.0-flash`; also surfaced on fal as
  `fal-ai/seedream-5-flash` (verify before wiring). Native BytePlus API uses a multimodal-generation
  surface similar in shape to DashScope's.
- **Mask channel:** ⚠️ **Partial — coordinate/box-based, not binary-mask.** ByteDance's spec exposes
  a **layer decomposition** path: the model splits the image into a base + up to 16 editable
  layers; edits are coordinate- or box-targeted against those layers. There is no documented
  `mask_url` parameter; the editor's hand-painted RGBA masks would need to be converted to a
  bounding region + a per-layer mask before submission. **Incompatible without a converter.**
- **Latency:** Synchronous, ~3–6s for a 1024×1024 frame; faster than FLUX.1 Fill's queue path.
- **Price:** ~$0.018/image on BytePlus (per the issue body). For comparison: Alibaba's
  $0.04/image at 20 images/day × 30 days = $24/mo per user; Seedream at the same volume = ~$11/mo.
- **Fit for staging:** **Compromised by mask shape.** The editor's mask UX is a free-form brush
  with a per-pixel RGBA buffer (`useMaskBuffer`, `useMaskPainting`). Routing that through a
  layer-decomposition layer is feasible but adds an entire `mask-to-box` stage that does not exist
  today. Unless the editor is refactored to emit box regions (a separate product change, #1263
  owns that area), Seedream cannot be a drop-in.

### 3.4 Gemini Nano Banana 2.1 (Google, Oct 6)

- **Endpoint:** `gemini-3.1-flash-image` via `interactions.create` (Google Gemini API).
- **Mask channel:** ❌ **None.** `interactions.create` exposes text-and-image-to-image; **no native
  mask parameter.** This was the disqualifier for Nano Banana 2 in `docs/spikes/235-vendor-investigation.md`
  and the disposition is unchanged for 2.1: editing is text-guided only.
- **Latency:** Fast (Flash-tier); synchronous, ~2–4s typical.
- **Price:** $0.0336 / 1K output tokens (~$0.0168 per batch, per issue body). At the 1024×1024
  output scale most editors use, that's ~$0.0168/image — competitive on cost.
- **Fit for staging:** **Disqualified for replace step.** Without a mask channel the model cannot
  be told *where* to insert a sofa set; the editor would lose the binary-mask contract the entire
  inpaint UX depends on. The 2.1 update may improve image quality but does not change the API
  surface, so the verdict is unchanged.

### 3.5 GPT-Image-2.5 Sunburst (OpenAI, Sept 8)

- **Endpoint:** OpenAI Responses API, `gpt-image-2.5-sunburst` (the mask-compatible tier; `flare`
  is fast, non-mask).
- **Mask channel:** ⚠️ **Prompt-guided, not pixel-locked.** Per the OpenAI docs and
  `docs/spikes/235-vendor-investigation.md`: "Masking with GPT Image is **entirely prompt-based**.
  The model uses the mask as guidance, but may **not follow its exact shape with complete precision**."
  For staging where the masked region is a TV niche, a console-table footprint, or a rug outline,
  prompt-based masking is disqualifying because the model "decides" where edits apply.
- **Latency:** Synchronous; ~5–15s for a 1024×1024 edit at `medium` quality.
- **Price:** ~$0.00588/image at `medium` quality, 30 USD / million output tokens; input image
  tokens billed separately. Range ~$0.02–$0.05/room photo.
- **Integration cost:** **Highest of the candidates.** Mask must be uploaded as a `file_id` via
  `openai.files.create({ purpose: "vision" })` — three API calls per inpaint request (image upload,
  mask upload, edit) vs. one for fal or one for DashScope. `OPENAI_API_KEY` is already present in
  the project for gpt-4o-mini copy work (`src/lib/ai.ts`), so no new env var.
- **gpt-image-1 deprecation:** **Oct 23, 2026.** A migration to 2.5 is required for OpenAI image
  edits regardless of this bake-off. That is a separate piece of work — the copy surface does not
  use image edits, so this is informational, not blocking.
- **Fit for staging:** **Not ready for replace.** Same disposition as `docs/spikes/235-vendor-investigation.md`:
  imprecise mask fidelity + heaviest integration cost + the unmasked-region behavior is
  undertested. Reconsider if OpenAI publishes explicit (non-prompt-based) mask support.

### 3.6 Hunyuan Image 3.5 Preview (Tencent, Sept 22)

- **Endpoint:** Tencent Cloud Hunyuan API; not listed on fal as of 2026-10-13.
- **Mask channel:** ⚠️ **Partial — multi-turn editing up to 4K.** Spec is text-and-region; the wire
  shape is closer to Seedream's coordinate/box model than to FLUX.1 Fill's binary-mask model. **No
  documented `mask_url` parameter.**
- **Latency:** Synchronous, ~5–10s typical; multi-turn chain adds latency linearly.
- **Price:** **Unverified** ("too new for verified pricing — second pass" per the issue body).
- **Fit for staging:** **Out of scope this pass.** The issue explicitly defers Hunyuan to a second
  pass because pricing is unverified and the mask semantics are coordinate-based, not binary.

---

## 4. Results table

Scoring per the issue's method: vacant staging (empty room → insert sofa), occupied consultation
(replace existing furniture), and repeat-edit stability (two sequential edits, check drift in
unchanged regions). All scores are **directional**, sourced from public docs and prior
investigations; they are not benchmark numbers.

| Model | (a) vacant fidelity | (b) occupied fidelity | (c) repeat-edit drift | (d) price / image | (e) latency |
|---|---|---|---|---|---|
| **FLUX.1 Fill (fal)** — incumbent | ✅ Architecture-preserved (proven) | ✅ Architecture-preserved (proven) | ⚠️ Mild drift in unedited regions across runs (the reason for `mask-dilation.ts` + FRAMING_CONTEXT) | ~$0.11 (3.1MP @ $0.035/MP) | Queue, ~10–15s end-to-end |
| **FLUX 3 Image (BFL)** | ✅ Numerically locked unmasked regions | ✅ Numerically locked unmasked regions | ✅ **No drift** (pixel-locked outside the bbox) | ~$0.05–0.10 (unverified) | Sync, ~5–10s |
| **Seedream 5.0 Flash** | ⚠️ Layer-decomposition; needs box-converter | ⚠️ Layer-decomposition; needs box-converter | ✅ Stable within layers (per spec) | ~$0.018 | Sync, ~3–6s |
| **Nano Banana 2.1** | ❌ No mask channel | ❌ No mask channel | N/A | ~$0.0168 | Sync, ~2–4s |
| **GPT-Image-2.5 Sunburst** | ⚠️ Prompt-guided mask; off-by-mask-region risk | ⚠️ Prompt-guided mask; off-by-mask-region risk | ⚠️ Drift not characterized; mask not pixel-locked | ~$0.02–0.05 | Sync, ~5–15s |
| **Hunyuan Image 3.5 Preview** | ⚠️ Coordinate/box only; no binary-mask | ⚠️ Coordinate/box only; no binary-mask | Unverified | Unverified | Sync, ~5–10s |

Legend: ✅ strong, ⚠️ compromise / risk, ❌ disqualifier, N/A not applicable.

The four sub-scores (a, b, c) are the **fidelity** axis the staging editor is graded on. (d) and (e)
are operational axes the bake-off explicitly calls out. Nano Banana 2.1 is the cheapest model in
(d) but is disqualified on the fidelity axis — its low price reflects the absence of mask control.

---

## 5. Recommendation

### Top 3 (ranked, no flip implied)

1. **FLUX 3 Image (BFL) — hold for a one-shot probe, conditional on fal listing.**
   The pixel-locked unmasked-region property is exactly the staging editor's safety contract. If
   `fal-ai/flux-3-image` is listed on fal by the time of follow-up, the probe should:
   (a) confirm the mask/bbox input is a first-class parameter,
   (b) submit one fixture from each of the three case sets (vacant / occupied / repeat-edit),
   (c) measure pixel-diff outside the masked region vs. FLUX.1 Fill's masked-region boundary,
   (d) record fal's reported price from the response envelope.
   The probe is a separate ticket — not in this PR.

2. **FLUX.1 Fill (fal) — keep as documented fallback for the Alibaba path.**
   Even though the fal adapter was deleted in #1240, FLUX.1 Fill remains the most-documented
   mask-precise inpaint model. If Alibaba's Qwen-Image-2.1-pro degrades (provider outage,
   quality regression, or a banned prompt regime), FLUX.1 Fill is the lowest-friction recovery
   rail: same `FAL_KEY`, same `fal-ai/*` namespace, the previously-deleted adapter can be
   restored from git history at the cost of a one-day integration. This is a **continuity**
   recommendation, not a flip.

3. **Seedream 5.0 Flash — defer until the editor emits box regions.**
   The price is compelling (~$0.018/image is roughly half of DashScope's per-image rate), and the
   latency is fast. But the mask-shape mismatch means adopting it requires the editor to emit
   box regions instead of RGBA masks — which is a product change owned by **#1263 (canvas /
   mask-paint refactor)**, not this issue. Re-rank after #1263 lands.

### Explicitly NOT recommended this pass

- **Nano Banana 2.1** — disqualified by the absence of a mask channel. The 2.1 update improves
  image quality but does not change the API surface; the verdict from
  `docs/spikes/235-vendor-investigation.md` is unchanged.
- **GPT-Image-2.5 Sunburst** — disqualified by prompt-based masking for a precision replace task.
  The deprecation of gpt-image-1 (Oct 23) does not change this: the copy surface in `src/lib/ai.ts`
  does not call image edits, so the deprecation is informational for this repo.
- **Hunyuan Image 3.5 Preview** — out of scope per the issue's own scoping note ("second pass").

### Sign-off guard

> **No provider flip happens without Alex's sign-off.** This bake-off ranks; it does not wire.
> Any follow-up probe (FLUX 3 Image) is a separate ticket filed under the issue or a child issue.

---

## 6. Evidence sources

- Issue #1240 body — bake-off scope, model list, method, $50 API budget, sign-off guard
- `src/lib/inference.ts` — provider-agnostic `InferenceClient`; current production provider is Alibaba
- `src/lib/alibaba-adapter.ts` — DashScope wire format; one round-trip, image+prompt only, no mask
- `docs/spikes/233-qwen-variant-spike.md` — Qwen-Edit-2511 mask-support verdict; FLUX compensating hacks
- `docs/spikes/235-vendor-investigation.md` — GPT Image 2.5 / Nano Banana 2 verdicts (carry-forward)
- `docs/vendor-investigation/235-gpt-image-vs-nano-banana-vs-fal.md` — pricing scorecard and "stay on fal" recommendation
- `docs/vendor-investigation/235-gpt-image-vs-nano-banana-vs-fal.md` (scorecard §3.3) — $0.035/MP FLUX.1 Fill, $0.05/MP FLUX.1 Pro, GPT Image 2.5 $0.19/img precedent
- `src/lib/mask-dilation.ts` — FLUX-specific compensation for off-by-mask-region artifacts
- `src/lib/prompts.ts:buildFalFillPayload` — FLUX `guidance: 7.5, num_inference_steps: 28`
- `next.config.ts` — image allowlist (no change required for any candidate; all upload to Supabase Storage)

---

## 7. Follow-up actions (separate tickets, not this PR)

| Action | Owner | Ticket |
|---|---|---|
| One-shot FLUX 3 Image probe (if listed on fal) — verify pixel-lock under our mask conventions | (unassigned) | file as child of #1240 |
| Restore fal adapter from git history as documented recovery path | (unassigned) | file if/when Alibaba outage history grows |
| Re-rank Seedream after #1263 box-region editor lands | (unassigned) | follow-up to #1263 |
| GPT-Image-2.5 Sunburst revisit when/if OpenAI publishes non-prompt-based mask | (unassigned) | external trigger |
| Nano Banana revisit when/if Google adds a mask parameter to `interactions.create` | (unassigned) | external trigger |
| Hunyuan Image 3.5 second pass once verified pricing lands | (unassigned) | follow-up to #1240 |