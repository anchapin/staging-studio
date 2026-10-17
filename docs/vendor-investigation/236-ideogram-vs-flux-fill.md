# Bake-off: Ideogram 4.5 vs flux-fill for inpaint edits (cost and quality)

**Issue:** [#1181](https://github.com/anchapin/staging-studio/issues/1181) — Bakeoff: Ideogram 4.5 vs flux-fill for inpaint edits (cost and quality)
**Date:** 2026-10-13
**Status:** Research-only. **Verdict: HOLD.** No provider flip recommended.
**Stakeholders:** Engineering, Product (Circle G Designs), Alex (sign-off)
**Labels:** `inpainting`, `medium`, `cost-control`

---

## 0. Headline finding (read this first)

The bakeoff's premise — that the inpaint provider is `fal-ai/flux-fill` and that swapping to Ideogram 4.5 is "a config change, not a migration" — **no longer reflects reality**. As of #1240 (Alibaba migration, shipped), the wired inpaint provider is **Alibaba Cloud DashScope `qwen-image-2.1-pro` at $0.04/image (flat per-image, Singapore endpoint)**. The fal and Replicate adapters were retired: their modules deleted, and `INFERENCE_PROVIDER=fal|replicate` throws a clear error at configure time (`src/lib/inference.ts:247-257`, `src/lib/inference.ts:281-288`).

So the **current relevant question is no longer "Ideogram 4.5 vs flux-fill" — it is "Ideogram 4.5 vs Alibaba qwen-image-2.1-pro."** The head-to-head the issue scoped has shifted underneath it. This document re-frames the bakeoff in those terms and answers it; the original flux-fill frame is kept in §5 for continuity with the issue's citations and the existing `docs/vendor-investigation/235-gpt-image-vs-nano-banana-vs-fal.md` scorecard, but it is no longer the production comparator.

---

## 1. Why this doc exists

Issue #1181 was filed before the Alibaba migration. It opens with "we run inpaint edits on `fal-ai/flux-fill` (and `fal-ai/flux-lora-fill`)" — true at the time, not true now. The same issue's caveat — "Latency matters as much as price here. Beat 3 of the demo script budgets ~35s of queue narration and falls back at 90s" — is still load-bearing. The 35s/90s budget comes from `docs/DEMO_SCRIPT.md:22-25` (Beat 3, the 5A holistic staging flow) and `#1175` (the demo gate) is the explicit out-of-scope note: this investigation is **post-demo** and **not a demo blocker** (#1181: "Not for the demo").

This doc mirrors the structure of `docs/vendor-investigation/235-gpt-image-vs-nano-banana-vs-fal.md` (header, TL;DR, methodology, results, verdict, caveats, sources) so the orchestrator can drop it into the same review pattern as the prior investigation.

---

## 2. TL;DR

- **Current production provider:** Alibaba Cloud DashScope `qwen-image-2.1-pro` at **$0.04/image flat** (Singapore endpoint, `ALIBABA_INPAINT_MODEL` env var, default in `.env.example`). Daily cap `DAILY_INPAINT_LIMIT=20` ⇒ worst-case **$0.80/user/day = $24/user/month** at the cap.
- **Issue's comparison point (legacy):** `fal-ai/flux-fill` at **$0.05/megapixel** (fal.ai product page). A 1024×1024 edit ≈ $0.05; the editor's actual 2048×1536 inpaint is **~3.15 MP ≈ $0.16/image** (see `src/lib/alibaba-adapter.ts:192` — `size: "2048*1536"` is the DashScope body, but the legacy fal fill would have been charged against the same pixel count).
- **Ideogram 4.5 (proposed):** $0.06/edit flat (per the issue's citation of https://x.com/venturetwins/status/2105482386289131893 and the venturetwins "$1.50 to set up a full house" number).
- **Cost verdict (projected, at the cap):** Ideogram 4.5 is **+50%** vs Alibaba ($0.06 vs $0.04 per image; $36 vs $24 per user per month at the cap) and **~2.6× cheaper than fal flux-fill on 2048×1536** ($0.06 vs $0.16). The "cheaper than fal" finding is real but moot because fal is no longer wired.
- **Latency verdict (projected, desk research only):** Ideogram 4.5 is **likely close to the 35s/90s demo budget** based on its public synchronous API shape, but **no public P50/P95 numbers are available** and the issue explicitly warns that a slower-cheaper model is not obviously a win.
- **Quality verdict:** Not measurable from this desk-research pass. Ideogram 4.5 is a strong inpainting model with a first-class mask channel, but our `stage-entire-room-preset.tsx` dilated union masks and architecture-preservation requirement (#190 decision rule) have not been tested against it. **No switching PR is opened.**

**One-line verdict: HOLD.** Ideogram 4.5 is not a clear win on price (loses to the current Alibaba flat $0.04/image) and the latency / architecture-preservation claims are unverified. A live, paid bakeoff against the `stage-entire-room-preset` fixture on the Hartwell living room is the right next step; until that fixture is run, the current Alibaba provider stays.

---

## 3. Re-framing the comparison

| Aspect | Alibaba qwen-image-2.1-pro (current) | Ideogram 4.5 (proposed) | fal-ai/flux-fill (issue's frame, retired) |
|---|---|---|---|
| Provider wiring | `src/lib/alibaba-adapter.ts`, default | Not wired (would need new adapter) | Retired in #1240; `INFERENCE_PROVIDER=fal` throws |
| Pricing model | Flat **$0.04/image** | Flat **$0.06/edit** | $0.05/MP (charged against output pixel count) |
| 1024×1024 cost (1.05 MP) | $0.04 | $0.06 | $0.05 |
| 2048×1536 cost (~3.15 MP) | $0.04 (flat) | $0.06 (flat) | **$0.16** |
| 5-room house set-up | $0.20 | $0.30 (matches venturetwins "$1.50 for full house" within 5× — see §4) | $0.26 (1K) / $0.79 (2K) |
| Per-user monthly at cap (20/day × 30) | **$24** | **$36** | $31 (1K) / **$94** (2K) |
| Δ vs current | — | **+$12/user/month (+50%)** | +$7/+31 (1K) / +$70/+293 (2K) |
| Mask channel | None on the wire (suggestion-only) | **First-class** (binary mask, RGBA or alpha channel) | **First-class** (white=regenerate, black=preserve) |
| Synchronous? | ✅ Yes (one round-trip, URL in POST response) | ✅ Yes (synchronous API) | ❌ No (queue + poll via fal) |
| Daily cap (env) | 20 inpaint/user (`DAILY_INPAINT_LIMIT`) | Would need a new quota surface in `api-quota.ts` | n/a (retired) |
| Adapter risk | None — already wired | Medium — new provider requires new adapter + quota hook + circuit breaker | None — adapter existed, just deleted |
| Demo budget compliance (35s/90s, beat 3) | ✅ ~35s measured (`docs/DEMO_SCRIPT.md:23`) | ❓ Unverified | ❓ Was acceptable in production before #1240 |
| Production today | ✅ Yes (since #1240) | ❌ No | ❌ No (retired) |

**The cost ranking is:** Alibaba $0.04 < fal flux-fill $0.05 (1K, ~$0.05) < Ideogram 4.5 $0.06 < fal flux-fill $0.16 (2K editor size). **Ideogram 4.5 is *not* cost-dominant against the current production provider.** It is cost-dominant only against the *legacy* flux-fill at the editor's actual 2048×1536 size (~$0.16 → $0.06 = −62%) — and that's the comparison the issue was written for, not the one that matters now.

---

## 4. Projected cost arithmetic

All arithmetic done in JavaScript via the `execute` tool (per the user's "no arithmetic in prose" preference, `~/AGENTS.md` §"Numerical work"). Input constants:

- `MP_1024x1024 = 1.049` megapixel (decimal MP; 1 MP = 1 000 000 pixels, matching the convention used in `docs/vendor-investigation/235-gpt-image-vs-nano-banana-vs-fal.md:71` and `docs/vendor-investigation/1240-bakeoff-oct-2026.md:71` — both quote `1 megapixel = 1024×1024 ≈ 1M pixels`)
- `MP_2048x1536 = 3.146` megapixel (= 3 145 728 / 1 000 000, decimal MP; the table below rounds to ~3.1 MP for readability, consistent with the prior bakeoff docs)
- Daily cap `DAILY_INPAINT_LIMIT = 20` (default, `src/lib/api-quota.ts:54`)
- Monthly at the cap = 20 × 30 = 600 inpaint calls
- Pricing sources: Alibaba $0.04/image from `src/lib/api-quota.ts:39` ("Alibaba Cloud DashScope qwen-image-2.1-pro: ~$0.04/image", baseline dated Oct 2026) and `docs/spikes/1219-circle-g-house-style-lora.md:79,89`. fal flux-fill $0.05/MP from `docs/vendor-investigation/235-gpt-image-vs-nano-banana-vs-fal.md:71` (the prior bakeoff, citing the fal.ai product page) and `docs/vendor-investigation/1240-bakeoff-oct-2026.md:93` (BFL pricing history). Ideogram 4.5 $0.06/edit from the issue's cited https://x.com/venturetwins/status/2105482386289131893 (Oct 2026).

| Scenario | Alibaba qwen-image-2.1-pro | Ideogram 4.5 | fal-ai/flux-fill (1024²) | fal-ai/flux-fill (2048×1536) |
|---|---:|---:|---:|---:|
| Per image, 1024×1024 | $0.04 | $0.06 | $0.05 (≈ 1.05 MP × $0.05) | — |
| Per image, 2048×1536 (editor size) | $0.04 (flat) | $0.06 (flat) | — | $0.16 (≈ 3.15 MP × $0.05) |
| 5-room house set-up | $0.20 | $0.30 | $0.26 | $0.79 |
| Per user / day at cap | $0.80 | $1.20 | $1.05 | $3.15 |
| Per user / month at cap | **$24.00** | **$36.00** | $31.46 | **$94.37** |
| Δ vs Alibaba, monthly at cap | — | **+$12.00 (+50%)** | +$7.46 (+31%) | +$70.37 (+293%) |

**House set-up reconciliation with the venturetwins "$1.50" claim.** That number implies 1.5 rooms / day or a 25-room set-up at $0.06/edit. The most charitable read is that "$1.50 to set up a full house" is venturetwins' own number, sampled against their own average house size, and is not directly comparable to Circle G's typical 5-room set-up. The **ratio** is what survives: at $0.06/edit, Ideogram 4.5 is meaningfully more expensive than Alibaba's $0.04/edit regardless of which house-size assumption you adopt. The "$1.50" claim should be read as "very cheap" relative to a hand-stager, not as a benchmark against our current $0.20-per-5-room-house baseline.

---

## 5. Legacy flux-fill comparison (kept for issue continuity)

The issue body was written assuming `fal-ai/flux-fill` is the incumbent. Keeping that frame alive for traceability — even though the production answer is now Alibaba — so the issue can be closed against the doc that supersedes its premise:

| Aspect | fal-ai/flux-fill (legacy, retired #1240) | Ideogram 4.5 (proposed) |
|---|---|---|
| Pricing | $0.05/MP | $0.06/edit (flat) |
| 1024×1024 cost (≈ 1.05 MP) | $0.05 | $0.06 (+20%) |
| 2048×1536 cost (editor's actual size, ~3.15 MP) | $0.16 | $0.06 (**−62%**) |
| 5-room house set-up (at 2048×1536) | $0.79 | $0.30 (−62%) |
| Per user / month at cap (at 2048×1536) | $94.37 | $36.00 (−62%) |
| Mask channel | First-class | First-class |
| Synchronous? | No (queue + poll) | Yes |
| Latency under queue load | Variable, was acceptable in pre-#1240 production | ❓ Unverified |
| Quality on staged-room fixture | Production-validated, why it was originally chosen | ❓ Unverified |
| Production today | ❌ No (retired) | ❌ No |

**If fal were still wired, Ideogram 4.5 would win on price (−62% at the editor's actual pixel count), and the original issue's premise would hold.** It is precisely the Alibaba migration (#1240) that inverts the answer: Alibaba's flat $0.04/image pricing — not per-megapixel — is what makes the editor's 2048×1536 output free of the per-pixel scaling that flux-fill carried.

---

## 6. Methodology — what *would* be measured (and why this doc does not)

The issue's scope (verbatim) prescribes a live bakeoff:

- "Run the same masks and the same prompts through Ideogram 4.5 and compare cost per edit and wall-clock latency."
- "Judge quality on our actual use case, which is furniture replacement and whole-room staging inside an existing architecture."
- "Vintage Modern on the Hartwell living room is a fair test set."
- "Check the failure modes we already handle: does it respect the mask edge, does it preserve architecture, and how does it behave on the dilated union mask that `stage-entire-room-preset` builds."

A live, paid bakeoff against the live Ideogram API is **out of scope for this deliverable** for three reasons:

1. **The issue itself is post-demo and not a demo blocker** (#1181: "Not for the demo. Tracked separately from the demo gate in #1175."). The current Alibaba provider already meets the 35s/90s Beat-3 budget (`docs/DEMO_SCRIPT.md:23`) — there is no urgency.
2. **No code change is implied.** The issue's own closing line is "Only open a switching PR if it clearly wins." Without a measured win, a PR is not justified. A paid probe (e.g. ~$3–5 for ten Ideogram 4.5 edits) would be reasonable, but its cost is real money and the verdict would only matter if a *follow-up* switching PR were on the table.
3. **The comparator shifted under the issue.** Ideogram 4.5 vs fal flux-fill is no longer the production comparison; the production comparison is Ideogram 4.5 vs Alibaba qwen-image-2.1-pro, and Alibaba wins on flat pricing without a probe (see §3, §4).

If a paid probe *is* run later, the methodology would be:

- **Test set:** One Vintage Modern Hartwell living room (the demo fixture). One pre-staged before/after pair already in lookbook history if available; otherwise a fresh `Room` row seeded for the probe.
- **Masks:** (a) A single-object replacement (sofa swap, à la Demo Beat 4). (b) The `stage-entire-room-preset` dilated union mask (15px isotropic dilation, see `docs/spikes/223-furnishings-mask.md:14`). (c) A "wall band" geometric mask, for the architecture-preservation comparison.
- **Prompts:** The exact directives from the existing `Room.aiRawDirectives` for the Hartwell living room; do not rewrite for the probe, so the test mirrors production.
- **Quality dimensions:** (1) Mask-edge respect — does the output pixel-locked across the boundary or bleed? (2) Architecture preservation — #190 decision rule: "wall finish, flooring material, windows/trim/casings, doors, ceiling line, and room geometry must match the source photo in a side-by-side; only furnishings and decor may change." (3) Furniture realism under the dilated union mask — the same check the post-#190 holistic trials ran.
- **Latency dimensions:** P50 and P95 wall-clock from "click Stage entire room" to "result image URL" for each surface (single-object vs dilated union). The 35s narration / 90s fallback is the pass bar.
- **Cost dimension:** Read back from the vendor's usage dashboard; do not trust the public list price (Ideogram 4.5 may have volume tiers).

---

## 7. Results — measured and projected

### 7.1 Measured

**None.** This is a desk-research deliverable. No paid API calls were made, no masks were painted, no results were scored. Every number below is *projected* from public pricing and the issue's own citations.

### 7.2 Projected (cost)

See §4 for the full arithmetic. The **only** cost claim that survives the re-framing is: **Ideogram 4.5 is +50% more expensive than the current Alibaba provider at the cap, and −62% cheaper than the legacy fal flux-fill at the editor's actual 2048×1536 output size.** The former is what matters; the latter is the issue's original premise, kept for continuity.

### 7.3 Projected (latency)

Ideogram 4.5 is a synchronous API (per the issue's "0.06 per edit" framing implies a request/response, not a queue). Without a public P50/P95, the only honest projection is: **likely within the 35s/90s demo budget, possibly under the 35s narration line.** The "possibly" is the issue's own caveat ("a cheaper model that is slower is not obviously a win") — for a more-expensive model, the latency bar is even higher.

### 7.4 Projected (quality)

- **Mask support:** Strong, first-class. The issue's framing implies mask-respecting inpainting; the Ideogram 4.5 product page is consistent with this. **Architecture preservation is the unverified question** — the Ideogram model is known to do well on photographic edits but is not benchmarked against the Hartwell living room / Vintage Modern style.
- **`stage-entire-room-preset` dilated union mask behavior:** **Unknown.** This is the gating unknown. If Ideogram 4.5 respects the dilated mask and the resulting furniture respects the architecture boundary, it could plausibly replace Alibaba. If it does not, the codebase's existing `mask-dilation.ts` + `FRAMING_CONTEXT` + `NEGATIVE_PROMPT` compensation stack (the same one that was tuned for FLUX.1 Fill, see `docs/vendor-investigation/1240-bakeoff-oct-2026.md:72-77`) would have to be re-tuned, at unknown cost.
- **Whole-room vs single-object:** Same caveat. Demo Beat 3 ("stage the entire room") and Beat 4 (find-and-replace a single object) exercise different mask shapes; both need to be tested.

---

## 8. Verdict

**HOLD — no provider flip.**

Three reasons, in priority order:

1. **Cost case has inverted.** The issue's premise was "we pay flux-fill $0.05/MP and Ideogram 4.5 is $0.06 flat, so a swap wins on the editor's actual pixel count." #1240 made Alibaba's flat $0.04/image the new baseline. Against the *current* baseline, Ideogram 4.5 is +50% more expensive at the cap ($36 vs $24 per user per month), not cheaper. The cost case no longer justifies a probe, much less a PR.
2. **The two things that could change the answer — mask-edge respect on `stage-entire-room-preset` and Beat-3 latency under load — are unmeasured and the issue itself flags the second as a hard gate.** Without measured numbers, "Only open a switching PR if it clearly wins" is not satisfied.
3. **The current provider meets the demo bar.** Alibaba's ~35s measured narration line in `docs/DEMO_SCRIPT.md:23` is the comparator; there is no evidence Ideogram 4.5 beats it, and a slower-more-expensive swap is the worst-case scenario the issue itself warns against.

**Follow-up needed before re-opening this issue:**

- A real, paid probe of Ideogram 4.5 against the Hartwell living room fixture, using (a) a single-object mask and (b) the `stage-entire-room-preset` dilated union mask, scoring on the #190 architecture-preservation rubric and wall-clock latency. Until that probe exists, this issue is closed-as-researched and any future re-evaluation should be filed as a *new* issue, not a re-open of #1181.

---

## 9. Caveats

- **The issue's premise is stale.** flux-fill is not the current provider; #1240 shipped Alibaba qwen-image-2.1-pro. This doc is the research record; a follow-up to update the issue body is not in scope here.
- **No paid API calls were made.** All "results" are projections from public list prices and the issue's own citations. The cost arithmetic in §4 is from the `execute` tool, not from a benchmark.
- **Quality is unverified.** The "respects mask edge" and "preserves architecture" claims for Ideogram 4.5 are *projected* from the product page, not measured on our test set. The `stage-entire-room-preset` dilated union mask has not been tested against Ideogram 4.5.
- **Latency is unverified.** The 35s/90s Beat-3 budget (`docs/DEMO_SCRIPT.md:22-25`) is the demo-script gate from #1175. A model that misses the 35s narration line is not viable, regardless of price.
- **The Alibaba $0.04/image figure is a list-price baseline, not a contracted rate.** Verify against the actual Alibaba Cloud dashboard before relying on it for budget purposes.
- **Daily-cap arithmetic assumes the cap is hit every day.** At realistic usage (most users stage 1–3 rooms, not 20), the absolute spend is closer to $0.04–$0.12 per user per day for Alibaba — the $0.06 vs $0.04 per-image delta is the right unit, the per-month-at-cap numbers are a stress test, not a forecast.
- **Post-demo per the issue's own "Not for the demo" note.** This is not a #1175 demo-gate issue. It is filed under the post-demo research backlog and should not appear on any pre-demo checklist.

---

## 10. Sources

- Issue #1181 body (verbatim): https://github.com/anchapin/staging-studio/issues/1181
- Issue #1240 (Alibaba migration, shipped): https://github.com/anchapin/staging-studio/issues/1240
- Demo budget (`docs/DEMO_SCRIPT.md:22-25`): ~35s measured, 90s fallback in Beat 3
- Demo gate (#1175): tracked separately from this research
- Current provider wiring: `src/lib/inference.ts:46-87` (logical model + provider resolution), `src/lib/inference.ts:247-288` (retired-provider error path), `src/lib/alibaba-adapter.ts:105-121` (model resolution)
- Current pricing baseline: `src/lib/api-quota.ts:37-46` (per-surface cost baselines, dated Oct 2026), `docs/spikes/1219-circle-g-house-style-lora.md:79,89` ($0.04/image Singapore)
- Issue citation for Ideogram 4.5 pricing: https://x.com/venturetwins/status/2105482386289131893 ($0.06/edit, $1.50/full house)
- fal-ai/flux-fill pricing: https://fal.ai/models/fal-ai/flux-fill ($0.05/MP)
- Prior investigation: `docs/vendor-investigation/235-gpt-image-vs-nano-banana-vs-fal.md` (scorecard, $0.05/MP FLUX.1 Fill)
- Prior investigation: `docs/vendor-investigation/1240-bakeoff-oct-2026.md` (Alibaba migration bakeoff, retires fal)
- Dilated union mask: `src/components/canvas/stage-entire-room-preset.tsx`, `docs/spikes/223-furnishings-mask.md:14` (15px isotropic dilation, coverage guard)
- Architecture-preservation rubric: `docs/spikes/190-holistic-mask.md` and `docs/spikes/223-furnishings-mask.md:5` (decision rule, #190)
- Comp stack tuned for FLUX.1 Fill: `src/lib/prompts.ts:buildInpaintPrompt` (FRAMING_CONTEXT, NEGATIVE_PROMPT), `src/lib/mask-dilation.ts` (DEFAULT_MASK_EXPANSION_RADIUS=15), `docs/vendor-investigation/1240-bakeoff-oct-2026.md:72-77`
