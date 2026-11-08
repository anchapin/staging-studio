# GPT-Image-2.6 integration spike (issue #1504)

Run date: 2026-11-07 · Follow-up to the #1502 evaluation (`docs/gpt-image-2-6-evaluation.md`). Spike only — no production or demo-path changes.
Total spend: **~$0.42** (9 paid runs).

## Questions and answers

**Q1. Do Flare/Sunburst respect production-shaped (object-silhouette) masks? — Yes, better than the rectangle.**
Hand-drawn silhouette masks approximating SAM segment output (sofa+table silhouette, 13.6% of frame; wall-art silhouette, 6.8%; bench silhouette, 12.5%), encoded as opaque RGB (black = edit, alpha 255 — the encoding the #1502 correction established):

| Model | Case | Latency | Outside Δ (mean / %chg) | Inside Δ | Result |
|---|---|---|---|---|---|
| Flare | sofa replace | 12.2s | 13.1 / 16.5% | 69.9 | Loveseat + round oak table in silhouette; rest of room faithful |
| Flare | art replace | 11.8s | 7.7 / 8.2% | 36.3 | B/W coastal photo in the *same frame*; room visually untouched |
| Flare | bench removal | 13.7s | 5.3 / 5.5% | 58.0 | Bench gone, carpet and sofa base clean |
| Sunburst | sofa replace | 31.4s | 15.5 / 20.6% | 67.4 | Same edit, comparable quality |
| Sunburst | art replace | 28.0s | 8.2 / 8.4% | 39.5 | Same edit |
| Sunburst | bench removal | 28.0s | 7.5 / 11.7% | 63.3 | Bench gone; slightly more outside drift than Flare |
| Qwen (prod config) | sofa replace | 29.2s | 28.1 / 40.9% | 80.2 | Edit lands but whole frame re-rendered (no mask consumed, per production design) |
| Qwen (prod config) | art replace | 27.3s | 35.0 / 46.3% | 45.8 | Whole frame re-rendered for a 6.8%-of-frame change |

Tighter masks → less outside change (monotonic across both #1502's rectangle and these silhouettes). Small-region precision (the art case) is where a mask-consuming provider most outclasses the instruction-only incumbent: ~4.5× less outside change.

**Q2. Is 1536×1024 a hard output cap? — No.**
`size: "2048x1536"` on the edits endpoint is honored exactly (output verified 2048×1536, matching production Qwen's output size). Cost rises to ~$0.067/edit (1,835 output tokens vs. 1,132) and latency stays ~14.5s on Flare — but outside-mask preservation *worsens* (outside Δ 28.7 vs. 13.1 for the same case at 1536×1024): at the larger canvas the model re-renders more aggressively. Resolution parity is available; it trades against fidelity. An integration could request 1536×1024 and upscale, or accept the 2048 trade-off — a product call, now with numbers.

**Q3. Boundary discipline and compositing — compositing works only if the seam falls on background.**
Raw outputs need no compositing to be usable (Q1 table). As a fidelity guarantee for listing photos, compositing the model output inside the feathered mask over the source gives exactly 0.0 mean change outside the feather band — but a visible ghost/doubling appears where an *object crosses the mask boundary*, because the model's re-render is geometrically drifted by a few pixels relative to the source (upscaled 1536→2000 output; sofa edges and table decor don't align). The seam is invisible on flat wall/floor. Production segment masks are whole-object silhouettes whose boundaries mostly lie on background — and dispatch already erodes them ~4px — so a composite-with-whole-object-masks design is viable; a composite over masks that cut through objects is not. This must be a design constraint, not an afterthought.

## Recommendation

**Proceed to an integration design (not yet a swap) for a mask-consuming GPT-Image-2.6 Flare provider**, specifically:

- Flare as the default tier (Sunburst costs 2.3× the latency for no measured quality gain on single edits; keep Sunburst for multi-round work, where #1502 showed better consistency).
- Client encodes the dispatched mask (post-erosion) as opaque RGB, black = edit — never alpha-varying.
- Request 1536×1024 (best fidelity measured); decide the output-size policy with the Q2 numbers.
- Composite the result inside the feathered mask over the source **only when the mask is a whole-object silhouette**; otherwise return the raw model output. Enforce/verify the whole-object property at the segment-dispatch seam.
- Keep Qwen as the fallback provider (it remains the only option that consumes no mask and the cheaper per-edit price at 1536-equivalent work, $0.04 vs. $0.046).

Open questions an integration design must still close: behavior on real SAM masks (these silhouettes were hand-drawn polygons on two photos), failure-mode handling for the provider's occasional boundary overshoot (#1502 saw one object land partially outside its rectangle), and the inpaint quality gate's thresholds against the Δ distributions measured here and in #1502.

## Reproduction

Photos/mask geometry from `bake-off/befores/`; silhouette polygons drawn to approximate the sofa+table, wall art, and bench in those photos. OpenAI runs: PNG source, opaque-RGB mask, `quality=medium`, complexity omitted (default), sizes as noted. Qwen runs: production parameters (`prompt_extend=true`, `seed=42`, `size=2048*1536`, instruction mode, no mask — matching `alibaba-adapter`). Composite: model output inside the silhouette feathered 6px over the source, scored outside a 10px dilation band. Output images retained with the spike working files (not committed).
