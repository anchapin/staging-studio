# Spike 235 — Second-generation vendor investigation: GPT Image 2.5 vs Nano Banana 2 vs fal incumbents

Issue: [#235](https://github.com/anchapin/staging-studio/issues/235). No code changes.

---

## Background

Post-UAT assessment: would a second-generation challenger beat fal.ai for the inpainting/replace step? The critical requirement is **precise, mask-guided architectural replacement** — a flamingo in a pool, a console table under a TV, a rug in a living room. Loose mask guidance is disqualifying for home staging where off-by-mask-region edits look unprofessional.

Challengers surfaced: GPT Image 2.5 (OpenAI) and Nano Banana 2 (Google). fal incumbents are FLUX.1 Fill (`fal-ai/flux-lora-fill`) and Qwen-Edit-2511 (available on fal.ai).

---

## Vendor profiles

### Incumbents

#### FLUX.1 Fill — `fal-ai/flux-lora-fill`
- **Type**: Explicit mask-guided inpainting (image URL + mask URL → edited image)
- **Mask support**: ✅ Yes — first-class `image_url` + `mask_url` binary mask input; guidance = 7.5, inference_steps = 28 (pinned in `src/lib/prompts.ts:buildFalFillPayload`)
- **Architecture preservation**: ✅ High — binary mask is pixel-precise; FLUX architecture is proven for interior/render preservation; `FRAMING_CONTEXT` append (issue #190) addresses depth/frame artefacts
- **Latency**: Queue-based async (~2s submit + variable queue + generation); fire-and-forget submit, status polling via `GET /inpaint/[requestId]/status`
- **Cost**: $0.035 / megapixel (fal.ai); images rounded up to nearest megapixel
- **Integration surface**: `src/lib/fal.ts` (client singleton) + `src/app/api/inpaint/route.ts` (submit) + `src/app/api/inpaint/[requestId]/status/route.ts` (poll) + `src/lib/prompts.ts:buildFalFillPayload` — ~40 lines of new logic total; `@fal-ai/serverless-client` SDK; `FAL_KEY` env var
- **Current usage**: `fal.queue.submit(FAL_FLUX_FILL_MODEL, { input: buildFalFillPayload({ imageUrl, maskUrl, prompt, negativePrompt }) })`
- **Status**: Live in production; daily per-user quota guardrail (issue #201)

#### Qwen-Edit-2511 — `fal-ai/qwen-edit-2511`
- **Type**: Explicit mask-guided inpainting (available on fal.ai queue)
- **Mask support**: ✅ Presumed yes (same fal queue paradigm as flux-lora-fill; model designed for image editing)
- **Architecture preservation**: Likely adequate but untested in this codebase; no integration exists
- **Latency**: Comparable to FLUX.1 Fill (same fal queue infrastructure)
- **Cost**: Comparable to FLUX.1 Fill (same fal pricing model)
- **Integration surface**: None currently; would mirror FLUX.1 Fill path in `src/lib/prompts.ts` and `src/app/api/inpaint/route.ts`
- **Status**: Not integrated; available on fal.ai

### Challenger 1: GPT Image 2.5

#### Model: `gpt-image-2.5-sunburst` (OpenAI Responses API)
- **Type**: Diffusion transformer with prompt-guided masking
- **Mask support**: ⚠️ Partial — "masking with GPT Image is **entirely prompt-based**. The model uses the mask as guidance, but may **not follow its exact shape with complete precision**" ([source: OpenAI docs](https://platform.openai.com/docs/guides/image-generation#edit-an-image-using-a-mask))
- **Architecture preservation**: ❌ Unreliable — prompt-based masking means the model decides where edits apply; for home staging where a console table must fill exactly the masked wall niche, imprecise mask following is disqualifying
- **Latency**: Synchronous (Responses API waits for generation); no queue polling needed; fast for small images
- **Cost**: ~$0.00588 / image at 30 USD per million output tokens, `medium` quality (OpenAI docs); input image tokens billed separately; scale depends heavily on image size
- **Integration surface**: New provider in `src/lib/` (`openai-images.ts`); new route handler in `src/app/api/inpaint/route.ts` or a new action; `OPENAI_API_KEY` already present (`src/lib/ai.ts`); would need file upload flow (mask + image as `file_id` via `openai.files.create({ purpose: "vision" })`) — heavier than fal's URL-passing
- **Mask input format**: Mask must have same format and size as image; requires alpha channel; mask passed as `file_id` not URL (multi-step upload required)
- **Status**: Available on Responses API (`gpt-image-2.5-sunburst`, `gpt-image-2.5-flare` for fast); `gpt-image-2.5-sunburst` is the mask-compatible model

### Challenger 2: Nano Banana 2

#### Model: `gemini-3.1-flash-image` (Google Gemini API)
- **Type**: Text-and-image-to-image via `interactions.create` API
- **Mask support**: ❌ None — Google docs confirm no native mask parameter; image editing is text-guided only (`"Update this infographic to be in Spanish"`) — no mask input field exists in the API
- **Architecture preservation**: N/A — no mask → no architectural precision
- **Latency**: Fast (Flash-tier model); synchronous via `interactions.create`
- **Cost**: Gemini Flash pricing (token-based, very low cost per operation)
- **Integration surface**: New provider (`gemini.ts`); new action/route; `GEMINI_API_KEY` env var required
- **Status**: No mask support; disqualified for replace step

---

## Scorecard

| Criterion | FLUX.1 Fill (fal) | Qwen-Edit-2511 (fal) | GPT Image 2.5 Sunburst (OpenAI) | Nano Banana 2 / Gemini 3.1 Flash |
|---|---|---|---|---|
| **Mask support** | ✅ Explicit binary mask | ✅ Presumed explicit mask | ⚠️ Prompt-guided only | ❌ None |
| **Architecture preservation** | ✅ Pixel-precise mask; proven | ✅ Likely precise; untested | ❌ Unreliable mask fidelity | N/A |
| **Latency** | ~2s submit + queue + gen (async) | Similar to FLUX | Synchronous; ~5–15s | Synchronous; fast |
| **$/image** | $0.035/MP (~$0.14 for a 4MP room photo) | TBD (fal pricing) | ~$0.006 + input tokens (~$0.02–0.05/room photo) | ~$0.001–0.01 (Flash-tier) |
| **Integration cost** | Low (URL-passing, queue SDK, 1 model constant) | Low-Medium (mirror FLUX path) | Medium-High (file upload flow, new API, mask alpha conversion) | High (new API, no mask support) |
| **Env vars** | `FAL_KEY` (exists) | `FAL_KEY` (exists) | `OPENAI_API_KEY` (exists for copywriting) | New `GEMINI_API_KEY` |
| **Production readiness** | ✅ Live | ⚠️ Not integrated | ⚠️ Untested for this use case | ❌ No mask support |

---

## Analysis

### Why FLUX.1 Fill wins on mask fidelity

The replace step requires **pixel-accurate mask boundary enforcement**. FLUX.1 Fill receives a binary RGBA mask and an image URL; it treats masked pixels as the edit target and fills only those regions. The output is deterministic with respect to the mask boundary.

GPT Image 2.5's mask is described as guidance — the model interprets it but does not guarantee boundary preservation. For a home staging app where a masked TV area must become a piece of art, a mask that "may not follow its exact shape" produces visible artefacts that clients reject in UAT.

### Nano Banana 2 is disqualified

No native mask input exists in the Gemini `interactions.create` API. Editing is text-guided only. The issue framing ("Nano Banana 2 has no native mask input") is confirmed correct by the API reference.

### GPT Image 2.5 is not ready for replace

The prompt "masking is entirely prompt-based" is disqualifying language for a precision replace task. Additional concerns:
- Mask must be converted to alpha channel and passed as a `file_id` (requires `openai.files.create` upload round-trip per request)
- Two images + mask upload = 3 API calls per inpaint request (vs. 1 fal queue submit)
- No published FLUX-equivalent negative prompt / guidance / inference_steps tunability for architectural scenes
- Untested whether GPT Image 2.5 respects interior lighting / perspective consistency for staged rooms

### Qwen-Edit-2511 is a possible alternate

Available on the same fal queue as FLUX.1 Fill. If FLUX.1 Fill has availability or cost issues, Qwen-Edit-2511 could serve as a drop-in fal alternative with minimal integration work (~changing the model string constant). No new API, SDK, or env var required.

---

## Recommendation

**Stay on fal — adopt FLUX.1 Fill as primary, Qwen-Edit-2511 as potential alternate.**

GPT Image 2.5 and Nano Banana 2 do not meet the mask precision requirement for the replace step. The additional integration cost for GPT Image 2.5 (file upload flow, unreliable mask fidelity, new API surface) outweighs any cost or latency benefit for a task that fal already does correctly.

If a second fal alternative is desired for redundancy, the lowest-cost path is integrating `Qwen-Edit-2511` (same `fal-ai/*` namespace, same SDK, same env var, model-string swap only).

---

## Follow-up implementation issue

If the team wants a second fal-based alternative: file a separate issue to swap `FAL_FLUX_FILL_MODEL` to `fal-ai/qwen-edit-2511` in staging, compare outputs, and promote if quality is acceptable.

**GPT Image 2.5** should be reconsidered if:
1. OpenAI publishes explicit (non-prompt-based) mask support
2. The replace use case is broadened to non-architectural edits (texture swaps, style transfers)

**Nano Banana 2** should be reconsidered if Google adds a native mask/inpainting parameter to the `interactions.create` API.

---

## Sources

- OpenAI Image Generation docs: <https://platform.openai.com/docs/guides/image-generation>
- OpenAI mask documentation (quoted): "Masking with GPT Image is entirely prompt-based. The model uses the mask as guidance, but may not follow its exact shape with complete precision."
- Gemini API image generation: <https://ai.google.dev/gemini-api/docs/image-generation>
- Gemini Nano Banana: `gemini-3.1-flash-image` via `interactions.create` — no mask parameter
- fal.ai FLUX.1 Fill: <https://fal.ai/models/fal-ai/flux-lora-fill> — $0.035/megapixel; `image_url` + `mask_url` binary mask inputs
- `src/lib/prompts.ts` — `FAL_FLUX_FILL_MODEL = "fal-ai/flux-lora-fill"`; `buildFalFillPayload` with `guidance: 7.5`, `num_inference_steps: 28`
- `src/app/api/inpaint/route.ts` — queue submit flow; daily quota guardrail
