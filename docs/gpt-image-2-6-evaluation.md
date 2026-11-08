# GPT-Image-2.6 Flare / Sunburst evaluation (issue #1502)

Run date: 2026-11-07 · Spike only — no production or demo-path changes made or proposed by this doc's verdict.
Incumbent: Alibaba Cloud DashScope Qwen-Image-2.1-Pro (`qwen-image-2.1-pro`, Singapore workspace, instruction mode, $0.04/image flat).
Challengers: OpenAI `gpt-image-2.6-flare` and `gpt-image-2.6-sunburst` via `POST /v1/images/edits`.
Total spend for this evaluation: **$0.81** (18 paid runs).

## Verdict

**NO-GO for the masked inpaint/edit step** — the step staging-studio's pipeline actually is.
**Niche GO candidate (separate decision, not this issue):** unmasked whole-room work (first-pass staging drafts, defurnish) is fast, cheap, and visually strong on both 2.6 tiers.

## Why 2.6 was tried at all

GPT Image 2.5 was disqualified in earlier evaluations because local edits were prompt-steered only. The 2.6 API accepts a real `mask` parameter and a `markup` overlay, which reopened the question. This spike tested whether mask *acceptance* means mask *fidelity*. It does not.

## Method

Same cases, prompts, and masks as the October #1240 bake-off (`bake-off/befores/`: `vacant-insert`, `occupied-replace`, `repeat-stability`; one shared center-rectangle mask, 30.2% of frame), plus three tasks from the #1502 brief: unmasked **defurnish** of the occupied room, a **markup-guided** occupied-replace, and a **round-2** chained edit on the repeat-stability output ("add a potted plant in the center"). One diagnostic re-run of occupied-replace used an explicit "fill the entire masked area" prompt at high quality / default complexity.

- OpenAI masked runs: `quality=medium`, `complexity=low` (OpenAI's recommended edit settings), mask as transparent=edit PNG at source dimensions.
- Qwen runs: production parameters (`prompt_extend=true`, `seed=42`, `size=2048*1536`), instruction mode (no mask on the wire — that is how production calls it).
- Scoring: per-pixel mean absolute difference vs. source, split inside/outside the mask (outputs resized to source size first), plus visual inspection of every output. Pixel diff is a blunt instrument — it counts global re-render/resampling as "change" — so where pixel scores and visual inspection disagree, the doc says so.

## Headline finding: the black void

With the bake-off's standard local prompts, **every masked 2.6 run returned a black rectangle over most of the mask region**, with the requested object generated only as a sliver at the region's bottom edge:

- Flare and Sunburst, occupied-replace and repeat-stability alike.
- Round 2 inherited the void as if it were image content and added the requested plant in front of it.
- This is **not** a 2.6 regression and **not** a mask-encoding error: the October GPT-Image-2.5 output still on disk (`bake-off/outputs/gpt-image-2-5__occupied-replace__29195ms.png`, produced with a different mask encoding — white-RGB preserve — and a different transport) has the identical black rectangle.
- The diagnostic re-run (explicit fill instruction, high quality) eliminated the void — by re-rendering the **whole room**: new artwork, new side tables, new foreground objects that exist in no source photo. The mask functions as soft guidance for a full-image generator, not as an inpainting boundary. That matches independent API documentation describing the 2.6 mask as "guidance rather than a hard boundary."

A masked edit that either voids the region or restyles the room fails this project's decisive requirement — mask-precise architectural editing that leaves the rest of the listing photo alone — regardless of generation quality elsewhere.

## Results table

Latency is wall-clock per run. OpenAI cost is computed from each response's `usage` block at $5/$8/$30 per 1M text-in/image-in/image-out tokens. "Outside Δ" = mean abs pixel diff outside the mask (lower = better preservation); "Inside Δ" = same inside the mask (should be high when an edit lands).

| Model | Task | Latency | Cost | Outside Δ | Inside Δ | Visual verdict |
|---|---|---|---|---|---|---|
| Flare | vacant-insert (masked) | 13.1s | $0.0459 | 32.0 | 61.6 | Strong full staging; ignored mask as boundary (by design of the task, mostly harmless here) |
| Flare | occupied-replace (masked) | 14.6s | $0.0458 | 17.9 | 170.8 | **Black void** over mask region; loveseat sliver at bottom |
| Flare | repeat-stability (masked) | 11.9s | $0.0458 | 7.4 | 180.5 | **Black void**; tiny table at region edge |
| Flare | occupied-replace (markup) | 14.3s | $0.0466 | 20.0 | 25.7 | Near-replica of source; requested replacement barely applied |
| Flare | defurnish (unmasked) | 11.3s | $0.0459 | — | — | Clean empty room, architecture intact |
| Flare | repeat round-2 (masked) | 12.2s | $0.0464 | 5.7 | 4.6 | Void carried through from round 1 |
| Flare | occupied-replace (fill prompt, high q) | 13.5s | $0.0526 | 19.4 | 51.8 | No void, but whole-room restyle; invented furniture outside the mask |
| Sunburst | vacant-insert (masked) | 17.9s | $0.0459 | 37.4 | 62.9 | Strong full staging, comparable to Flare |
| Sunburst | occupied-replace (masked) | 17.3s | $0.0458 | 19.1 | 170.8 | **Black void**, same failure as Flare |
| Sunburst | repeat-stability (masked) | 18.1s | $0.0458 | 7.5 | 177.2 | **Black void**, same failure as Flare |
| Sunburst | occupied-replace (markup) | 20.5s | $0.0466 | 19.1 | 23.1 | Near-replica; edit barely applied |
| Sunburst | defurnish (unmasked) | 14.4s | $0.0459 | — | — | Clean empty room, architecture intact |
| Sunburst | repeat round-2 (masked) | 15.0s | $0.0464 | 6.2 | 10.0 | Plant added — in front of round 1's void |
| Qwen-2.1-Pro | vacant-insert | 47.1s | $0.04 | 45.9 | 51.0 | Full staging (pixel Δ inflated by 2048×1536 re-render; visually coherent) |
| Qwen-2.1-Pro | occupied-replace | 28.7s | $0.04 | 36.8 | 35.4 | Room faithfully preserved, **no void** — but under-delivers: sofa essentially unchanged, decor swapped |
| Qwen-2.1-Pro | repeat-stability | 28.5s | $0.04 | 34.3 | 45.0 | Lamp + side table added as asked, room preserved — plus a hallucinated cat on the sofa back |
| Qwen-2.1-Pro | defurnish | 26.9s | $0.04 | — | — | Usable empty room |
| Qwen-2.1-Pro | repeat round-2 | 30.2s | $0.04 | 13.6 | 12.8 | Stable second round, no void pathology |

Reading the Qwen pixel scores honestly: Qwen's outside Δ (~34–46) is *worse on paper* than the 2.6 masked runs' (~7–19) — and that comparison is meaningless, because the 2.6 runs' low outside Δ is exactly what a model that copies the outside and voids the inside produces. Visual inspection is decisive here: Qwen returns a complete, usable photograph on every local-edit task; GPT-Image-2.6 returns a black rectangle. Neither model is a true mask-fill inpainter (Qwen's known weakness is under-editing and occasional hallucinated details — see the cat); Qwen's failure mode is a mediocre edit, GPT-Image-2.6's is an unusable one.

## Cost / latency notes

- At these settings Flare and Sunburst bill **identically** (~$0.046/edit at medium quality): same token counts, differing only in latency (Flare 11–15s, Sunburst 14–21s vs. Qwen 27–47s) — and neither showed a quality edge over the other on any task in this set. OpenAI's "Sunburst = greater consistency across edits" claim could not be evaluated as designed, because round 1's void poisoned round 2 for both tiers equally.
- The October third-party warning that 2.6 low/medium edits bill more output tokens than 2.5 did not bite here: every masked edit billed exactly 1,132 output tokens, defurnish/markup the same or marginally more.
- Qwen stays cheaper per edit ($0.04 flat) and slower; 2.6 is ~15% pricier and 2–3× faster.

## Markup

The new `markup` parameter (transparent overlay with a red rectangle over the target area) produced the weakest edits of the run: near-replicas of the source with the requested sofa replacement barely applied (inside Δ ≈ 23–26, vs. 171 for masked runs — the change is mostly *not happening*). Not a substitute for a mask on this evidence.

## Recommendation

1. **Close #1502 as No-go for the inpaint/edit step.** Qwen-Image-2.1-Pro remains the production model. Revisit only if OpenAI ships a true mask-fill mode (hard boundary) — the trigger is a masked local edit that fills the region *and only* the region on these same bake-off cases.
2. If whole-room draft generation is ever wanted as a *separate* feature (first-pass staging concepts, defurnish previews), Flare at ~$0.046 and ~13s is the best draft engine measured in this repo to date — that is a product decision for a new issue, not an integration implied by this one.
3. Process note for future bake-offs: the October #1240 GPT-Image-2.5 outputs contained the same black-void artifact and the results table scored latency/price only, so it went unrecorded. Any future bake-off scoring should include a visual pass over every output before the table is believed.

## Reproduction

Cases/prompts/masks: `bake-off/befores/` + `bake-off/*.json` in this repo. Runs were executed 2026-11-07 against the live APIs at the parameters listed under Method; per-run usage blocks, latencies, and pixel scores were recorded at run time and are summarized in the table above. Output images are retained with the evaluation working files (not committed — ~50MB of PNGs).
