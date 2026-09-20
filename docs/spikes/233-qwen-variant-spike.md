# Spike 233 — Qwen-Image-Edit-2511 variant-slot A/B (fal mask support verification first)

Issue: [#233](https://github.com/anchapin/staging-studio/issues/233). FR W2 initiative.
PRs: this spike doc precedes any code changes. Default path stays `fal-ai/flux-lora-fill` until a verdict is reached.

## Context

FLUX.1 Fill (`fal-ai/flux-lora-fill`) is a 2024-era model with compensating hacks that were layered on iteratively (issues #180, #182, #190, #223, #234). Qwen-Image-Edit-2511 (December 2025, open weights, listed on fal.ai) is a potential replacement that may require fewer compensating hacks.

The find-and-replace initiative (task W2-1) gates a default-path swap on empirical verification.

## Verification gate (do first)

**Mask-support verdict must be established before any default-path change is committed.**

### Qwen-Image-Edit-2511 on fal — current status (as of 2026-09-19)

Codebase search for `qwen` / `Qwen` / `QWEN` returns zero results. The model is not yet referenced in `src/` or `docs/`.

`fal.ai/models` index search for `Qwen-Image-Edit` and `qwen-edit` returned no matches. The model may:
- Not yet be deployed on fal's queue infrastructure
- Be listed under a different identifier (e.g. `fal-ai/qwen-image-edit-2511` or similar)
- Require a different endpoint pattern than the queue-based `fal.queue.submit()` used by the current inpaint route

**Action required**: Probe `fal.ai` API directly or check the fal dashboard for the Qwen-Image-Edit-2511 endpoint identifier and accepted parameters.

### Mask-first-class probe protocol

If a Qwen queue endpoint exists, test whether it accepts a mask as a first-class parameter (same semantics as FLUX: white=regenerate, black=preserve):

1. Submit a minimal inpaint job with a known mask + prompt to the Qwen endpoint.
2. If accepted with `mask_url` parameter: note the parameter name and semantics.
3. If NOT accepted: evaluate the **composite-unmasked-region fallback** — submit the full image with a prompt that describes the unmasked region to preserve, and compare quality.

## What shipped (FLUX.1 Fill compensating hacks)

All in `src/lib/`. No changes to these files are in scope for this spike unless the verdict retires one or more hacks.

### Mask dilation (`mask-dilation.ts`)

FLUX.1 Fill treats unmasked perimeter pixels as structural ground truth. A hand-painted mask stops exactly at the object's visual boundary, so without dilation FLUX preserves bezels, frames, and brackets — leaving a ghost rim around the replacement.

- **Isotropic dilation** (`dilateMaskGrid`): circular kernel, `DEFAULT_MASK_EXPANSION_RADIUS = 15`px, UI tunable 0–25px.
- **Anisotropic dilation** (`dilateMaskGridDirectional`, issue #234): vertical bias `k=2`, downward growth extends to `2×radius` to swallow floor shadow pools. Toggled by the "Include floor shadow" UI option.

### FRAMING_CONTEXT (`prompts.ts`)

```
"Presented as a finished object with its own frame and mounting,
 integrated natural shadows and depth, clean surrounding wall."
```

Without this suffix, FLUX renders replacements (e.g. "a painting") as raw canvas texture pasted onto the wall. With it, replacements render as physical objects with depth integration. Appended to every inpaint prompt via `buildInpaintPrompt(aesthetic, directives)`.

### Negative prompt (`prompts.ts`)

```
NEGATIVE_PROMPT = "walls, windows, trim, doors, molding, structural columns,
 flooring, bezel, monitor frame, TV border, screen casing, electronics, wires,
 cables, black plastic trim, raw canvas texture"
```

Suppression list keeps architecture elements from bleeding into regenerated regions. For holistic/full-room runs (`HOLISTIC_NEGATIVE_PROMPT`), architecture terms are reintroduced and artifact/geometry-drift terms added.

### Payload (`buildFalFillPayload`, `prompts.ts`)

```
image_url, mask_url, prompt, negative_prompt, guidance: 7.5, num_inference_steps: 28
```

## Current call path

```
POST /api/inpaint (route.ts)
  → buildInpaintPrompt(aesthetic, directives)  [+ FRAMING_CONTEXT]
  → buildFalFillPayload({ imageUrl, maskUrl, prompt, negativePrompt })
  → fal.queue.submit("fal-ai/flux-lora-fill", { input: payload })
  → prisma.inpaintRequest.create({ id: request_id, ... })

GET /api/inpaint/[requestId]/status (route.ts)
  → fal.queue.status("fal-ai/flux-lora-fill", { requestId })
  → fal.queue.result("fal-ai/flux-lora-fill", { requestId })
  → upload to Supabase storage
  → prisma.inpaintRequest.update({ status: COMPLETED, resultUrl })
```

Both routes hardcode `FAL_FLUX_FILL_MODEL = "fal-ai/flux-lora-fill"`. A Qwen variant would need a parallel model constant and a routing decision in both submit and status routes.

## Variant-slot A/B harness (what this spike adds)

Variant slots (`VariantSlot = 0 | 1`, `inpaint-source.ts`) exist precisely to support this kind of comparison: two runs against the same source image, different models, results land in separate slots for side-by-side comparison.

The A/B harness needs:

| File | Purpose |
| --- | --- |
| `src/lib/prompts.ts` | `FAL_QWEN_MODEL` constant (once identified) |
| `src/app/api/inpaint/route.ts` | Accept optional `modelOverride` field; route to the appropriate model constant |
| `src/app/api/inpaint/[requestId]/status/route.ts` | Route status/result polling to the correct model |

The harness does NOT change the default model. It only enables an explicit opt-in path for comparison runs.

## 2×2 + shadow axis test matrix

Minimum 3 real firm photos. Same mask + prompt for both models in each cell.

| | FRAMING_CONTEXT on | FRAMING_CONTEXT off |
|---|---|---|
| **FLUX.1 Fill** | A1 | A2 |
| **Qwen-Image-Edit-2511** | B1 | B2 |

Plus shadow axis (≥1 room with hard floor shadow):

| | includeFloorShadow=true | includeFloorShadow=false |
|---|---|---|
| **FLUX.1 Fill** | S-A1 | S-A2 |
| **Qwen-Image-Edit-2511** | S-B1 | S-B2 |

Per cell: side-by-side before/after at full resolution.

## Verdict criteria

1. **Mask support**: Qwen accepts `mask_url` first-class? If not, composite fallback quality acceptable?
2. **FRAMING_CONTEXT necessity**: Does Qwen render physical object depth without the framing suffix? Is the suffix harmful to Qwen output?
3. **Ghost rim**: Does Qwen produce visible rim artifacts at object boundaries without mask dilation?
4. **Architecture fidelity**: Do Qwen generations drift walls/windows/flooring without the negative prompt?
5. **Floor shadow**: Does Qwen handle directional shadow inclusion without anisotropic dilation?

## Retiring FRAMING_CONTEXT

If Qwen renders physical objects without `FRAMING_CONTEXT`, the recommendation is to **retire** it from the FLUX path too (issue #182 work-around no longer needed). Document the decision in the verdict comment on issue #233.

If Qwen still needs it, FRAMING_CONTEXT stays for both models.

## Out of scope for this spike

- Changing the default model (gated on verdict)
- UI changes beyond the A/B harness
- Real fal.ai execution from this document (operator-run only, like #190/#223)
- Cost/latency benchmarking (separate tracking issue if verdict is go)
