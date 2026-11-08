# GPT-Image-2.6 Flare / Sunburst evaluation (issue #1502)

Run date: 2026-11-07 · Spike only — no production or demo-path changes made or proposed by this doc.
Incumbent: Alibaba Cloud DashScope Qwen-Image-2.1-Pro (`qwen-image-2.1-pro`, Singapore workspace, instruction mode, $0.04/image flat).
Challengers: OpenAI `gpt-image-2.6-flare` and `gpt-image-2.6-sunburst` via `POST /v1/images/edits`.
Total spend for this evaluation: **$1.36** (32 paid runs, including the mask-encoding diagnostics in the appendix).

> **Correction notice (2026-11-07, same day):** the first version of this doc reported a No-go based on a black-void artifact in every masked run. That artifact was caused by the *mask file encoding used in this spike*, not by the models — see "The mask-encoding trap" below. The masked runs were re-executed with the working encoding and the verdict below is based on the corrected runs. The cat in the repeat-stability case, described as a Qwen hallucination in the first version, is present in the source photograph; that claim is withdrawn.

## Verdict

**Passes the #1502 bar — conditional GO candidate for a follow-up integration spike; not a production swap on this evidence alone.**

With the correct mask encoding, GPT-Image-2.6's masked edits land in the marked region and preserve the rest of the photo *better* than the Qwen incumbent on every scored case (outside-mask mean Δ 6.8–23.1 vs. Qwen's 34.3–36.8), at 2–3× lower latency for Flare and ~15% higher per-edit cost ($0.046 vs. $0.04). What keeps this from being an outright swap recommendation:

- The mask is still **guidance, not a hard boundary** (OpenAI's own guide says so verbatim). Preservation is generative re-rendering, not pixel-exactness: in one of six corrected runs the requested object landed partially outside the marked region, and output resolution is capped at 1536×1024 from a 2000×1333 source (Qwen returns 2048×1536).
- All test masks were one shared center rectangle. Production masks are freehand/segmentation shapes; the encoding trap below also has to be handled correctly in the client.
- A production decision needs the follow-up spike listed under Recommendation.

## The mask-encoding trap (the finding that matters most for integration)

GPT Image's `mask` parameter does **not** behave like a classic inpainting mask, and the two encodings a reasonable engineer would build both silently produce garbage:

1. **Alpha-channel encodings void the output.** If the mask PNG varies the alpha channel — whether "transparent = edit" (the convention the API reference text describes) or the alpha produced by the guide's own `putalpha(grayscale)` recipe — the returned image is black wherever mask alpha is 0 and visible wherever alpha is 255. The model generates the correct scene; the endpoint composites the mask alpha into the result and flattens transparency to black. Verified across: both 2.6 tiers, the Image API (multipart and JSON transports), the Responses API `input_image_mask` route, PNG and JPEG sources, and low/default complexity. Inverting the alpha moves the black region to the complement — the mechanism, not the polarity, is the problem. October's #1240 GPT-Image-2.5 bake-off output on disk has the identical artifact, produced with an alpha-varying mask; that bake-off scored latency/price only, so it went unrecorded.
2. **The working encoding is an opaque RGB guidance image:** alpha = 255 everywhere, edit region painted **black**, keep region **white**. With this file the same prompts produce complete, correctly-placed edits (results table below). This matches the guide's actual description of the feature: "Masking with GPT Image is entirely prompt-based. The model uses the mask as guidance."

Anyone integrating GPT Image masks into this repo must encode masks the second way — and the pipeline's existing fal-style masks (white = edit, used with alpha semantics elsewhere) must not be passed through an alpha conversion.

## Method

Same cases, prompts, and mask geometry as the October #1240 bake-off (`bake-off/befores/`: `vacant-insert`, `occupied-replace`, `repeat-stability`; one shared center-rectangle mask, 30.2% of frame), plus three tasks from the #1502 brief: unmasked **defurnish** of the occupied room, a **markup-guided** occupied-replace, and a **round-2** chained edit on the repeat-stability output ("add a potted plant in the center").

- OpenAI masked runs (corrected set): PNG source (same format as mask, per the guide's mask requirements), opaque-RGB mask (black = edit), `quality=medium`, `complexity` omitted (defaults to high). Earlier diagnostic sets varied one variable at a time — format, complexity, transport, API surface, alpha polarity — and are summarized in the appendix.
- Qwen runs: production parameters (`prompt_extend=true`, `seed=42`, `size=2048*1536`), instruction mode (no mask on the wire — that is how production calls it).
- Scoring: per-pixel mean absolute difference vs. source, split inside/outside the mask (outputs resized to source size first), plus visual inspection of every output. Pixel diff counts global re-render/resampling as "change," so where scores and inspection disagree, the doc says so.

## Results (corrected masked runs)

Latency is wall-clock per run. OpenAI cost is computed from each response's `usage` block at $5/$8/$30 per 1M text-in/image-in/image-out tokens. "Outside Δ" = mean abs pixel diff outside the mask (lower = better preservation); "Inside Δ" = same inside the mask (should be meaningfully high when an edit lands).

| Model | Task | Latency | Cost | Outside Δ | Inside Δ | Visual verdict |
|---|---|---|---|---|---|---|
| Flare | vacant-insert (masked) | 18.4s | $0.0459 | 40.1 | 59.0 | Strong full staging (high Δ expected — the task fills the room) |
| Flare | occupied-replace (masked) | 16.0s | $0.0458 | 19.6 | 23.6 | Loveseat + oak table in the marked region; room faithfully preserved |
| Flare | repeat-stability (masked) | 14.1s | $0.0458 | 6.8 | 11.1 | Side table added center; floor lamp landed at the region's left edge, partially outside it — guidance, not a boundary |
| Flare | repeat round-2 (masked) | 12.9s | $0.0464 | 5.2 | 5.8 | Stable second round on round-1 output |
| Sunburst | vacant-insert (masked) | 37.9s | $0.0459 | 43.2 | 54.8 | Strong full staging, comparable to Flare |
| Sunburst | occupied-replace (masked) | 35.5s | $0.0458 | 23.1 | 22.1 | Loveseat + oak table in region; room preserved |
| Sunburst | repeat-stability (masked) | 28.6s | $0.0458 | 6.8 | 13.7 | Lamp + side table in region; room preserved |
| Sunburst | repeat round-2 (masked) | 29.7s | $0.0464 | 3.6 | 9.1 | Plant added center; round-1 edit retained; best consistency of the set |
| Qwen-2.1-Pro | vacant-insert | 47.1s | $0.04 | 45.9 | 51.0 | Full staging (pixel Δ inflated by 2048×1536 re-render; visually coherent) |
| Qwen-2.1-Pro | occupied-replace | 28.7s | $0.04 | 36.8 | 35.4 | Room preserved but under-delivers: sofa essentially unchanged, decor swapped |
| Qwen-2.1-Pro | repeat-stability | 28.5s | $0.04 | 34.3 | 45.0 | Lamp + side table added as asked, room re-rendered globally |
| Qwen-2.1-Pro | defurnish | 26.9s | $0.04 | — | — | Usable empty room |
| Qwen-2.1-Pro | repeat round-2 | 30.2s | $0.04 | 13.6 | 12.8 | Stable second round |

Unmasked and markup runs (encoding-independent, unchanged from the first version):

| Model | Task | Latency | Cost | Visual verdict |
|---|---|---|---|---|
| Flare | defurnish | 11.3s | $0.0459 | Clean empty room, architecture intact |
| Sunburst | defurnish | 14.4s | $0.0459 | Clean empty room, architecture intact |
| Flare | occupied-replace (markup) | 14.3s | $0.0466 | Near-replica of source; requested replacement barely applied |
| Sunburst | occupied-replace (markup) | 20.5s | $0.0466 | Near-replica; edit barely applied |

Reading the table honestly: the corrected 2.6 runs beat Qwen on outside-mask preservation by 1.6–5× while actually performing the requested replacement Qwen ducked (occupied-replace). Flare at low complexity (appendix diagnostics) runs 11–15s at the same $0.046 cost; at default complexity Sunburst's latency (29–38s) approaches Qwen's, buying visibly better round-2 consistency. Neither tier showed a decisive quality edge on single edits.

## Markup

The new `markup` parameter (transparent overlay with a red rectangle over the target area) produced the weakest edits of the evaluation: near-replicas of the source with the requested sofa replacement barely applied. Not a substitute for a mask on this evidence.

## Appendix: how the void was isolated

One-variable-at-a-time diagnostics on occupied-replace (all produced the black void unless noted): JPEG source + alpha mask + `complexity=low` (original spike runs, both tiers) · PNG source + alpha mask + default complexity · inverted alpha mask (void moved to the mask's complement — the key tell) · Responses API with `input_image_mask` file upload, exactly per the guide's example (43.5s incl. mainline model; same void) · docs-recipe `putalpha` mask (content visible only inside the region, black outside) · **opaque-RGB mask (black = edit): works** · explicit "fill the entire masked area" prompt with an alpha mask: void disappears but the whole room is restyled — consistent with the mask being a prompt-guidance input whose alpha channel should not be varied.

## Recommendation

1. **#1502's question is answered: yes, 2.6 clears the bar the issue set** (leakage/geometry no worse than Qwen — in fact better on these cases). Close #1502 with this doc.
2. **Before any production change**, run a small integration spike: (a) production-shaped masks (segmentation/freehand, incl. the defurnish/furnish flows' real mask shapes) encoded as opaque-RGB; (b) output-resolution handling — 1536×1024 max from the Image API vs. the app's current 2048×1536 Qwen outputs; (c) boundary discipline — how often objects land outside the marked region on production-like prompts, and whether client-side compositing of the edit region over the source (the pipeline already composites for other providers) is needed to guarantee outside-region pixel fidelity for listing photos.
3. Process note for future bake-offs: score visually, not just by latency/price — the October void and this spike's first-pass error both came from trusting the table over the images.

## Reproduction

Cases/prompts/masks: `bake-off/befores/` + `bake-off/*.json` in this repo. Runs were executed 2026-11-07 against the live APIs at the parameters listed under Method; per-run usage blocks, latencies, and pixel scores were recorded at run time and are summarized above. The corrected masked runs used masks encoded as opaque RGB (edit region black RGB 0, keep region white RGB 255, alpha 255 everywhere) at source dimensions, with PNG sources. Output images are retained with the evaluation working files (not committed — ~50MB of PNGs).
