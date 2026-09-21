# Vendor Investigation: GPT Image 2.5 vs Nano Banana 2 vs fal incumbents

**Issue:** #235 — Vendor investigation: second generation vendor (GPT Image 2.5 / Nano Banana 2) vs fal
**Status:** Gate issue #232 is **OPEN** (not yet completed). This documentation task proceeds regardless.
**Date:** 2026-09-20
**Stakeholders:** Engineering, Product (Circle G Designs)

---

## Gate Status

> **#232 — [FR W1] UAT/demo session with flag ON; triage stager feedback**
> Status: **OPEN** | Depends on #231 | Unblocks waves 2–3

Issue #232 is an internal UAT session with the stager, not yet completed. This investigation is a
documentation task and is not gated on #232. The scorecard below is produced in full; any
implementation follow-up is subject to #232 go/no-go.

---

## 1. Context

StagingStudio uses AI-powered room inpainting to replace furniture/props in empty-home photography.
The staging editor draws binary masks to define the edit region; the model must preserve room
architecture (walls, flooring, lighting, fixed fixtures) while filling the masked area with
AI-generated furniture. This investigation benchmarks second-generation image edit APIs against the
current fal incumbents (FLUX.1 Fill, Qwen-Edit-2511).

**Critical requirement for home staging:** Architecture preservation. Mask boundaries must be
respected; the model must not "bleed" into unmasked areas or distort surrounding room structure.

---

## 2. Vendors Benchmarked

| Vendor | Model | Provider | Stage |
|---|---|---|---|
| OpenAI | GPT Image 2.5 Sunburst / Flare | OpenAI API | 2nd-gen |
| Google | Nano Banana 2 | Vertex AI / Gemini API | 2nd-gen |
| fal.ai | FLUX.1 Fill | fal.ai | Incumbent |
| fal.ai | Qwen-Edit-2511 | fal.ai | Incumbent |

---

## 3. Scorecard

### 3.1 Mask Support

| Vendor | Mask / Inpainting Support | Evidence | Verdict |
|---|---|---|---|
| **GPT Image 2.5** | Prompt-based guidance; mask boundaries not reliably respected | Community report (Aug 2025) on OpenAI forum: "masking with GPT Image is entirely prompt-based — the model uses the mask as guidance but may not follow its boundaries." AI Gateway independently confirmed to silently ignore the mask parameter. | **⚠️ Weak — insufficient for architectural precision** |
| **Nano Banana 2** | Semantic / conversational masking; Visual Reasoning approach to inpainting | Google AI docs: "Inpainting (semantic masking) — define a mask to edit a specific part of an image while leaving the rest untouched." X @GoogleAI demo (Sep 2025) shows mask-based inpainting. Higgsfield AI review (Dec 2025): "Surgical AI editing for flawless images. Use masking for object removal, text rewrite, and precise lighting." | **✅ Strong — native semantic masking** |
| **FLUX.1 Fill** | Native binary mask inpainting; explicit mask channel support | fal.ai product page: "Fill focuses on single-mask inpainting with straightforward prompt-based fills." Currently in production on StagingStudio. | **✅ Proven — production-validated** |
| **Qwen-Edit-2511** | Mask / LoRA support via fal | fal.ai listing: "Qwen Image Editing 2511 model with LoRA support." HuggingFace community LoRAs available for multi-angle camera control. | **✅ Good — LoRA-enhanced masks** |

### 3.2 Architecture Preservation

| Vendor | Architecture Preservation | Evidence | Verdict |
|---|---|---|---|
| **GPT Image 2.5** | Unclear; likely prompt-dependent; no explicit room-structure reasoning | No documentation or benchmarks on room/architecture consistency. Prompt-based approach is inherently variable. | **❓ Unknown — high risk** |
| **Nano Banana 2** | Visual Reasoning approach (vs texture-matching); real-time web search powers world knowledge for contextual accuracy | Google Cloud blog (Feb 2026): "Nano Banana 2 is powered by real-time information and images from web search." Higgsfield AI: "Nano Banana Pro Inpaint: Surgical AI editing for flawless images." WPP case study: "reducing editing time from hours to seconds" with "high fidelity product representation." | **✅ Strong — Visual Reasoning + web knowledge** |
| **FLUX.1 Fill** | High when mask is clean; room structure preserved within mask boundary | Production-validated on StagingStudio; no architecture-distortion reports. | **✅ Solid — proven for home staging** |
| **Qwen-Edit-2511** | Qwen's model has strong spatial reasoning; LoRA can be trained for room-style consistency | HuggingFace: first multi-angle camera control LoRA for Qwen-Edit-2511 with "96 precise camera poses." | **✅ Good — spatial reasoning + style LoRA** |

### 3.3 $/Image Cost

| Vendor | Pricing | Calculation | $/image (1K×1K) |
|---|---|---|---|
| **GPT Image 2.5** | $40 / 1M output tokens | ~0.19 / image (high quality, 1024×1024) | **$0.19** (high quality) |
| **Nano Banana 2** | Not publicly listed; enterprise contact sales | Vertex AI / Gemini API — no public per-image pricing as of 2026-09-20 | **TBD — enterprise only** |
| **FLUX.1 Fill** | $0.05 / megapixel | 1 megapixel = 1024×1024 ≈ 1M pixels | **$0.05** |
| **Qwen-Edit-2511** | $0.035 / megapixel | Same calculation | **$0.035** |

**Cost ranking (cheapest first):** Qwen-Edit-2511 ($0.035) < FLUX.1 Fill ($0.05) < GPT Image 2.5 ($0.19)

GPT Image 2.5 is **3.6–5.4× more expensive** than fal incumbents. Nano Banana 2 pricing is unknown but likely comparable to or above GPT Image 2.5 given enterprise positioning.

### 3.4 Latency

| Vendor | Latency | Evidence | Verdict |
|---|---|---|---|
| **GPT Image 2.5** | Not publicly benchmarked | No SLA or P50/P95 data available | **❓ Unknown** |
| **Nano Banana 2** | "Lightning-fast" / "Pro-level at Flash speed" | Google blog: "delivers Pro-level image generation and editing at the speed you expect from Flash." Figma / Notion / Whering testimonials all cite fast iteration. No explicit latency numbers. | **✅ Likely fast — but unverified** |
| **FLUX.1 Fill** | Not publicly benchmarked | Current inpainting pipeline on StagingStudio has acceptable UX latency (~10–20s typical) | **✅ Known — in production** |
| **Qwen-Edit-2511** | Not publicly benchmarked | fal.ai queue model; latency depends on queue depth | **✅ Acceptable if queue managed** |

### 3.5 Integration Cost

| Vendor | Integration Overhead | Notes |
|---|---|---|
| **GPT Image 2.5** | Low — same OpenAI SDK as existing `aiModel` (gpt-4o-mini) | `src/lib/ai.ts` already configured; add image model to `@ai-sdk/openai`. No new providers. |
| **Nano Banana 2** | Medium — new Google Cloud / Vertex AI SDK required | No existing Google Cloud integration in codebase (`src/lib/` has no Google SDK). Requires `GOOGLE_AI_API_KEY` / Vertex AI service account. New auth patterns. |
| **FLUX.1 Fill** | None — already integrated | `src/lib/fal.ts` + `src/app/api/inpaint/route.ts` already wired. |
| **Qwen-Edit-2511** | None — same fal.ai provider | Add model name to existing fal client. |

---

## 4. Summary Matrix

| Criterion | GPT Image 2.5 | Nano Banana 2 | FLUX.1 Fill | Qwen-Edit-2511 |
|---|:---:|:---:|:---:|:---:|
| **Mask support** | ⚠️ Weak | ✅ Strong | ✅ Proven | ✅ Good |
| **Architecture preservation** | ❓ Unknown | ✅ Strong | ✅ Solid | ✅ Good |
| **$/image (1K×1K)** | $0.19 | TBD | $0.05 | $0.035 |
| **Latency** | ❓ Unknown | ✅ Likely fast | ✅ Known | ✅ Acceptable |
| **Integration cost** | Low | Medium | None | None |
| **Production ready for staging** | ❌ No (mask) | ⚠️ Unverified (price) | ✅ Yes | ✅ Yes |

---

## 5. Recommendation

### Primary Recommendation: **Stay on fal (adopt-as-alternate for Qwen-Edit-2511)**

**Rationale:**

1. **Mask reliability is the gating factor.** Home staging requires surgical mask adherence — a model that ignores mask boundaries is architecturally unsafe regardless of cost or speed. GPT Image 2.5's reported prompt-based masking is disqualifying for production room edits.

2. **fal incumbents are cost-dominant.** Qwen-Edit-2511 at $0.035/MP is 5.4× cheaper than GPT Image 2.5 at $0.19/img. FLUX.1 Fill at $0.05/MP is 3.8× cheaper. At StagingStudio's volume, price differences of this magnitude outweigh marginal quality gains.

3. **Nano Banana 2 is a watchlist candidate, not an adoption candidate today.** No public per-image pricing exists (enterprise-only), no independent benchmarks for room-architecture preservation, and there is no existing Google Cloud integration in the codebase. Revisit when pricing is public and a mask-accuracy benchmark against staging room photos is available.

4. **GPT Image 2.5 is not recommended for home staging.** Mask handling issues, 3.6–5.4× higher cost, no latency SLA, and no existing integration advantage combine to a clear reject for this use case.

### Actionable next steps if Nano Banana 2 pricing becomes public:
- Request a Vertex AI eval account
- Run a mask-accuracy benchmark using StagingStudio's existing room photo test set
- Compare masked output against FLUX.1 Fill baseline before any migration consideration

---

## 6. Follow-Up

No implementation issue is filed at this time. Recommendation is **stay on fal**. If Nano Banana 2
becomes price-transparent and benchmarks well on mask accuracy, a follow-up issue should be filed
with this template:
- Vendor: Nano Banana 2 (Vertex AI)
- Trigger: public per-image pricing + mask-accuracy benchmark vs FLUX.1 Fill
- Effort: new Google Cloud SDK integration + A/B testing pipeline

---

## 7. Sources

- OpenAI GPT Image 2.5: https://developers.openai.com/docs/images-api-overview
- GPT Image mask issue: https://community.openai.com (Aug 2025)
- AI Gateway mask issue: https://github.com (Apr 2026)
- GPT Image pricing: https://www.cursor-ide.com, https://www.aifreeapi.com, https://openai.com (Apr 2025 announcement)
- Nano Banana 2 blog: https://cloud.google.com/blog/products/ai-machine-learning/bringing-nano-banana-2-to-enterprise (Feb 2026)
- Nano Banana 2 mask docs: https://ai.google.dev/gemini-api/docs/image-generation
- Nano Banana 2 inpaint review: https://higgsfield.ai/blog/Top-Editing-Tool-in-2025-Nano-Banana-Pro-Inpaint (Dec 2025)
- Nano Banana 2 Google AI Studio: https://aistudio.google.com/models/nano-banana
- FLUX.1 Fill: https://fal.ai (flux-lora-fill product page)
- Qwen-Edit-2511: https://fal.ai (Qwen Image Edit 2511 product page)
- fal.ai FLUX LoRA training: https://fal.ai (FLUX LoRA Fast training)
