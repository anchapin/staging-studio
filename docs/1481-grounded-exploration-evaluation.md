# Grounded Exploration for Open-Ended Image Editing (arXiv:2610.33810) — evaluation for staging-studio

**Issue:** [#1481](https://github.com/anchapin/staging-studio/issues/1481) — "Evaluate grounded exploration for diverse staging variants (demo quality)."
**Paper:** *Grounded Exploration for Open-Ended Image Editing*, arXiv:2610.33810v1 (cs.CV), submitted 24 Oct 2026, Jieyu Zhou, Mehdi Ben Ayed, Shubham Gupta, Zhenyu Tan, Jiajing Xu, Dmitry Kislyuk, Eric Tzeng, Christopher J. MacLellan, Charles Rosenberg — Georgia Institute of Technology + Pinterest; VLM4RWD workshop; CC BY-NC-SA 4.0.
**Date:** 2026-10-28
**Status:** Desk evaluation only — **no code, config, workflow or demo change lands from this issue.** No GPU job, no weight download, no paid image API call was made, and **no rendered prototype is claimed anywhere in this document**.
**House style:** follows `docs/1480-inversion-free-single-evaluation-evaluation.md` (#1480), `docs/one-step-editing-evaluation.md` (#1444), `docs/lenserase-removal-evaluation.md` (#1445), `docs/1446-abacus-dcr-sam-qk-edit-evaluation.md`.

---

## 0. TL;DR — verdict: **ADAPT** (prompt-level only; next step in §6)

- **What the paper is.** A **two-stage, inference-time prompting method** for *open-ended* image editing. Stage 1 emits K natural-language **spatial edit scopes** (which region may change, how far the change may extend, what is preserved elsewhere). Stage 2 emits one concrete, executable edit instruction per scope. All K plans are rendered by the same image-editing model. It is **not** a model, **not** a training method, and **not** a mask-based or diffusion-level technique (paper §2, §3.2).
- **Paper-reported headline.** Over 300 open-ended tasks, region-level exploration reaches mean semantic dispersion **0.532** vs **0.427** for "Prompted Diversity" (**+24.6 %**) and groundedness **3.90** vs **3.33** (**+17.1 %**), with **Valid@8 6.05** vs 5.33 and **Distinct Realizations@8 5.65** vs 5.20 (Abstract; Table 1).
- **The ablation that decides our call.** The paper's own §3.3 says **Stage 2 drives the diversity** ("Realization only" already reaches Direction Coverage **4.17** and Distinct Realizations **5.63** — *higher* direction coverage than the full region-level pipeline's 4.00), while **Stage 1 buys grounding** (groundedness 3.73 → 3.90, Valid@8 5.83 → 6.05). The paper's "High-level exploration" variant (abstract semantic directions instead of regions) was **indistinguishable from no scaffold at all** (3.70 / 3.77 / 5.80 / 4.16 / 5.63 / 0.504 vs 3.77 / 3.73 / 5.83 / 4.17 / 5.63 / 0.504). **So the paper does not support "explore directions, then render them" as its headline mechanism** — it supports *"one diversity-constrained instruction set, plus a grounding scaffold that is best expressed spatially."*
- **Repo fit (details in §3).** We already have the *grounding* half in place and paid for: architecture-first holistic directives + negative prompt (`src/lib/holistic-prompt.ts`, `src/lib/holistic-preset.ts`), region-scoped UI scopes (`src/components/edit-room/StagePanel.tsx:117-120`), two A/B variant slots (`src/lib/room-variant-service.ts`), an advisory inpaint quality gate (`src/lib/inpaint-quality-gate.ts`) and a browser-side scene-conservation measure (`src/lib/edit-conservation-measure.ts`). We do **not** have the *exploration* half: nothing in the repo generates multiple alternative edit intents for one room — the only second variant is `src/lib/try-another-layout.ts`, which deliberately keeps the same style and varies only the arrangement.
- **The hard blocker for a literal adoption.** The active inpaint provider is **instruction-mode with no mask on the wire** (`src/lib/prompts.ts:443-455` builds `{image_url, prompt}` only; `bake-off/drift-results.md`: "The mask rectangle the staging editor paints cannot be communicated to them on the wire"). The paper's Stage-1 *preservation boundary* is therefore not something we can enforce with masks today — only with prompt wording plus advisory gates.
- **Call: ADAPT.** Adopt the paper's **instruction-space exploration** idea — generate a small set (K = 3–4) of mutually distinct, feasibility-scoped edit *plans* in text before rendering, and render each plan independently — but adapt it in three ways: (a) express Stage 1 as **scope + direction + preservation boundary in one plan** (the paper's high-level-only Stage 1 was a no-op, so a spatial-only scaffold would not deliver the demo value we want); (b) implement it as **prompt/JSON plumbing over the existing OpenAI + inpaint path, with no new model, no new weights, no mask-dependent behaviour**; (c) keep it **demo-scale** (3–4 candidates for 1–2 rooms, pre-generated ahead of the demo), because 3–4 sequential renders at the measured **32.1–38.0 s** each (`bake-off/RESULTS.md`) do not fit the demo's **≤90 s** live-result rule (`docs/DEMO_SCRIPT.md`, beat 3).
- **What was NOT done:** no GPU run, no weight download, no paid API call, no rendered variant, no pipeline change. Every number below is either quoted from the paper (with location), measured by this repo (with file), or labelled an assumption.

---

## 1. Scope, method and evidence rules

**Issue #1481 asks** for a desk evaluation of arXiv:2610.33810 against staging-studio's demo flow, on (a) what "grounded exploration" actually is, (b) how feasibility is enforced, (c) code/weights availability, (d) fit with today's one-fill-per-room demo, (e) an explicit adopt/adapt/skip call.

**Evidence rules applied (same as the sibling docs):**

1. Every claim about **this repo** cites a file in this worktree (and a line number where it matters). Every claim about **the paper** cites the arXiv id plus the paper's own section/table/appendix and is labelled **paper-reported**.
2. Paper numbers are quoted **with their context** (backend, judge, task set, K). Where the paper publishes nothing (price, code release, input resolution), the cell says **not published** rather than estimating.
3. The paper text was read from the **arXiv HTML render** (`https://arxiv.org/html/2610.33810v1`, fetched 2026-10-28) plus the abstract page (`https://arxiv.org/abs/2610.33810`, fetched the same day). No second-hand summaries were used.
4. Repo-measured numbers (price, latency, drift) come from our own committed artefacts (`bake-off/RESULTS.md`, `bake-off/drift-results.md`) and outrank any paper claim.
5. **Nothing was benchmarked, rendered, or executed.** No paid endpoint was called; no model was run for this document.

**Limits of this pass.**

- The paper's evaluation set is an **internal Pinterest employee-testing set of 300 open-ended tasks** (paper §3). We have no comparable internal set, so the paper's absolute numbers are **not** directly transferable to staging-studio.
- The paper's judge is **GPT-5.5** with a set-level rubric (paper §3.1). We have no equivalent judge in-repo; our equivalents are the advisory gates in §3.4. Any claim that our product would reproduce the paper's numbers would be unfounded and is not made here.
- The paper evaluates **K = 8** candidates; our demo-scale target is 3–4 (§4).

---

## 2. The paper in detail (paper-reported)

### 2.1 Problem

Open-ended requests ("decorate this room", "ideas to make my bedroom feel cozier") admit many valid realizations (paper §1). Repeated sampling from the same image model stays concentrated around one interpretation; explicitly prompting for diversity raises variation but produces *superficial* differences and ungrounded edits (paper §1, §4). The paper frames the problem as **grounded exploration**: broaden semantic coverage while staying inside the edits supported by the source image and the request (paper §1, §4).

### 2.2 Method (paper §2)

- **Stage 1 — Exploring spatial edit scopes.** Generate K distinct *spatial* scopes as natural language. Each scope names the **primary editable region**, the **permitted extent of change**, and a **preservation boundary** for the rest of the image. Stage 1 explicitly does **not** choose style, material or object replacement — it decides *where* and *how much* (paper §2; prompt in Appendix B.2: "These are WHERE and EXTENT choices, not choices of style, material, object, palette, or treatment").
- **Stage 2 — Realizing concrete edits.** One self-contained edit plan per scope, naming the objects/materials/treatments to change while respecting that scope's editable region and preservation boundary. The K plans go to the same image-editing model and are executed independently (paper §2; prompt in Appendix B.1, which requires each instruction to "preserve source geometry and spatial relationships" and "preserve unrelated content and explicit constraints").
- **Feasibility** is therefore enforced **in text, twice**: Stage 1's scope constrains the region, and Stage 2's plan must respect it. There is no mask, no spatial conditioning tensor, no verifier model in the loop.

### 2.3 Experimental setup (paper §3.1–3.2)

- 300 open-ended tasks from an internal Pinterest employee-testing set; **K = 8** candidates per request; set-level evaluation.
- Judge: **GPT-5.5**, given source image, original request and the 8 candidates. Metrics: **Instruction Following** and **Groundedness** (1–5), **Valid@8**, plus two extra judge calls for **Direction Coverage@8** (distinct *high-level* directions; differences only in colour/material/texture/accessory stay in the same direction), **Distinct Realizations@8** (clusters of concrete realizations) and **Semantic Dispersion** (mean pairwise separation over the 28 candidate pairs).
- Instruction-space methods use **Qwen3.6-35B-A3B** to write instructions and a fixed renderer **Qwen-Image-Edit-2509**. Image-sampling baselines vary only the seed on **Qwen-Image-Edit-2509**, **gemini-2.5-flash-image** and **FLUX.2-klein-4B**.

### 2.4 Results (paper Table 1, §3.3) — the numbers that matter to us

| Method | Instruction Following ↑ | Groundedness ↑ | Valid@8 ↑ | Direction Coverage@8 ↑ | Distinct Realizations@8 ↑ | Dispersion ↑ |
|---|---|---|---|---|---|---|
| Region-level exploration (ours) | 3.74 | 3.90 | 6.05 | 4.00 | 5.65 | 0.532 |
| High-level exploration | 3.70 | 3.77 | 5.80 | 4.16 | 5.63 | 0.504 |
| Realization only (Stage 2, no scaffold) | 3.77 | 3.73 | 5.83 | 4.17 | 5.63 | 0.504 |
| Prompted Diversity | 3.57 | 3.33 | 5.33 | 3.66 | 5.20 | 0.427 |
| Naive instruction sampling | 3.31 | 3.38 | 4.78 | 2.90 | 4.42 | 0.319 |
| Qwen (seed-only sampling) | 2.98 | 3.26 | 4.04 | 2.46 | 3.63 | 0.242 |
| Gemini (seed-only sampling) | 3.93 | 3.45 | 5.74 | 2.18 | 4.56 | 0.424 |
| Flux (seed-only sampling) | 3.77 | 3.95 | 5.71 | 1.49 | 2.85 | 0.300 |

Read-outs that change our plan:

1. **Diversity comes from instruction space, not from image stochasticity.** Seed-only sampling on the same Qwen backend covers 2.46 directions; naive instruction sampling 2.90; a single Stage-2 call 4.17 (paper §3.3). Our pipeline already renders with a fixed model — so the lever is *what we ask for*, not how many times we re-roll. (Paper-reported; we have not tested it here.)
2. **Stage 1 is a grounding device, not a diversity device.** "Realization only" beats the full region-level pipeline on Direction Coverage (4.17 vs 4.00) and ties on Distinct Realizations (5.63 vs 5.65), while region-level Stage 1 wins on Groundedness (3.90 vs 3.73) and Valid@8 (6.05 vs 5.83) (paper §3.3).
3. **A purely semantic Stage 1 does nothing.** "High-level exploration" is within noise of "Realization only" on every metric (paper §3.3). A scaffold must be *spatially* grounded to be worth its tokens — this is directly relevant, because our hoped-for "explore what could be staged" framing is a **semantic** scaffold, which the paper shows is a no-op.
4. **Backends fail in opposite ways.** Gemini scored highest on instruction-following (3.93) but the paper reports frequent **structural hallucinations** (walls, openings, geometry, viewpoint changes); FLUX scored highest on groundedness (3.95) yet collapsed 5.71 valid outputs into 2.85 distinct realizations across 1.49 directions (paper §3.3; Figure 2). "Strong single outputs" ≠ "useful sets" — exactly the risk our demo would take.

### 2.5 Cost / latency: **not published**

The paper reports **no price, no wall-clock latency, no GPU type, and no token counts** for its two-stage pipeline, and no per-candidate rendering cost (paper §3 as read; nothing on cost appears in the HTML render). Its 300×8-candidate protocol therefore cannot be costed from the paper. Any cost figure for our version must come from **our** bake-off (§3.3).

---

## 3. Repo-fit analysis

### 3.1 What our demo flow actually is today (and where the issue's premise does not match)

- The demo is a **scripted rehearsal against production**, not a gated app. `docs/DEMO_SCRIPT.md` is the canonical beat sheet (12.5 min, driver Alex, client "Lauren Chapin"), and `docs/demo/rehearsal-runbook.md` is the T10 pre-flight/rehearsal gate. There is **no demo-mode flag, demo route, or demo-gated build** anywhere in `src/` — `grep -rn "DEMO_MODE|demo mode|demo-gat" src` returns nothing; the only "demo" hits in `src/` are incidental words in comments (`src/lib/prompts.ts`, `src/lib/project-aesthetic.ts`).
- The demo project is a **seeded project** ("1506 Porters Mill Ter"), and the demo date is **TBD** (`docs/DEMO_SCRIPT.md` header, per #1175).
- Beat 3 is the hero: type the client's words into *Staging directives*, one click, "AI follows HER", with a measured **~35 s** queue wait and a hard rule to show a result within **≤90 s**, else fall back to a **pre-generated** variant (beat 3), then beat 5 shows the **Original / Variant A / Variant B** strip, and beat 7 shows a second room that is "already staged".

**Contradiction #1 (issue premise vs repo):** the issue describes a "demo-gated web app". The repo has no demo gate; the demo is a scripted session with a seeded project, a rehearsal runbook and an on-disk fallback PDF. The relevant lever for "demo quality" is therefore **what is pre-generated and narrated before the session**, not a runtime gate.

**Contradiction #2 (brief vs repo):** the brief points at `src/lib/fal.ts` as "the current inpainting path". **That file does not exist.** Per `src/lib/inference.ts:1-38`, the fal and Replicate adapters were retired in #1240 and their modules deleted; the only wired provider is **Alibaba Cloud DashScope `qwen-image-2.1-pro`** (`src/lib/alibaba-adapter.ts:104-121`). The current inpainting path is `src/app/api/inpaint/route.ts` → `src/lib/inpaint-submit.ts` → `src/lib/inference.ts` → `src/lib/alibaba-adapter.ts`, with prompt/payload construction in `src/lib/prompts.ts`.

**Contradiction #3 (demo script vs code):** beat 3 of `docs/DEMO_SCRIPT.md` says the button is **"Stage entire room"**; the shipped label is **"Restage furnishings"** — `#223` renamed the preset precisely because it restages furnishings and decor, not the whole photo (`src/lib/holistic-preset.ts:30-38`). Any demo-material work that touches beat 3 must use the shipped label.

### 3.2 What we already have that the paper needs

| Paper ingredient | Our equivalent | Citation |
|---|---|---|
| Edit instruction / plan text | `promptDirectives` + `buildInpaintPrompt` | `src/lib/prompts.ts:539-554`; `src/lib/inpaint-submit.ts` |
| Stage-1 *scope* (region + extent) | UI scopes "Whole room / Objects / Paint area" | `src/components/edit-room/StagePanel.tsx:117-120` |
| Preservation boundary | architecture-first holistic directives + holistic negative prompt | `src/lib/holistic-prompt.ts`, `src/lib/holistic-preset.ts:40-46` |
| Region grounding (mask) | brush/flood-fill masks, holistic mask strategies, SAM furnishings union | `src/lib/holistic-mask.ts`, `src/lib/furnishing-detection.ts` |
| Per-room candidates | **2** fixed A/B variant slots | `src/lib/room-variant-service.ts:14-46`; `docs/post-demo-backlog.md` §1 |
| Feasibility check before spend | advisory inpaint quality gate (gpt-4o-mini) | `src/lib/inpaint-quality-gate.ts:1-25` |
| Groundedness measurement | browser-side ABACUS-style scene conservation | `src/lib/edit-conservation.ts:1-27`, `src/lib/edit-conservation-measure.ts:1-25` |
| Spend guard | daily inpaint quota (default **20**/user/day) | `src/lib/api-quota.ts:54` |

### 3.3 What we do **not** have — the gap the paper fills

1. **No alternative-intent generator.** Nothing in the repo produces several *different* staging intents for one room. The only "second idea" surface is `src/lib/try-another-layout.ts`, which by design keeps the same aesthetic and only varies arrangement ("Keep every piece of furniture and decor in the same {aesthetic} style, but arrange them differently…", `src/lib/try-another-layout.ts:33-40`). The paper's contribution maps onto exactly this hole.
2. **No mask enforcement on the active provider.** `buildAlibabaFillPayload` returns `{image_url, prompt}` — **no mask field** (`src/lib/prompts.ts:443-455`), and our own bake-off says it plainly: the current provider is "instruction-mode only (no mask on the wire)" and "the mask rectangle the staging editor paints cannot be communicated to them on the wire" (`bake-off/RESULTS.md`, `bake-off/drift-results.md`). So a Stage-1 *spatial* scope cannot be enforced by mask today; it can only be expressed in text (and checked afterwards by the advisory gates).
3. **Two slots, not a set.** The variant model is a fixed 2-slot A/B (`docs/post-demo-backlog.md` §1: "The system supports exactly 2 variant slots per room"), and `resolveTargetSlot` re-uses slot B by overwriting it (`src/lib/edit-room-scope.ts:38-46`). A 3–4-candidate set needs either pre-generated assets outside the slot model (demo-safe) or the variant-history work that is explicitly deferred as "High" complexity and "Low" priority in `docs/post-demo-backlog.md` §1.
4. **No set-level judge.** The paper's central metrics are set-level (a judge sees all 8 candidates). Our in-repo equivalents are per-image advisory checks (`src/lib/inpaint-quality-gate.ts`) plus a browser-side conservation measure; there is no "are these 4 candidates mutually distinct and jointly grounded?" check.

### 3.4 Cost, latency and quota — what 3–4 diverse directions would cost *here*

Measured by us (`bake-off/RESULTS.md`, run 2026-10-12):

- Current provider `qwen-image-2.1-pro` (Alibaba): **$0.04/image**, **32.1–38.0 s** per edit, 2048×1536 output.
- Incumbent mask-fill `flux-pro-fill` (fal): **$0.05/MP**, **16.7–22.7 s**.
- So a **K = 3–4** candidate set on the active provider ≈ **$0.12–0.16 per room** and **≈ 96–152 s** of rendering if serialised.

Constraint from the demo script: the live result must appear within **≤90 s** (`docs/DEMO_SCRIPT.md`, beat 3). **4 serial renders do not fit a live beat.** The script already has the escape hatch — the fallback is a *pre-generated* variant ("same pipeline, pre-warmed for today"). Therefore any "3–4 directions" demo value must be delivered as **pre-generated material** (e.g. a direction strip shown in beat 3/5) or as a **per-room pre-warm** with the live run kept as one direction.

Quota check: default daily inpaint limit is **20** per user (`src/lib/api-quota.ts:54`). A 2-room demo with 3–4 directions each = 6–8 renders, plus the live run and rehearsal runs — **fits**, but only if rehearsal and demo-day renders are budgeted explicitly.

### 3.5 Which demo rooms/flows would benefit

- **Living Room, beat 3 (the hero).** This is the open-ended case the paper describes: the client says "make this room feel cozier". Today she gets exactly one realisation, chosen by our prompt builder. Showing "3–4 distinct, feasible directions" before/alongside the live run is the strongest demo upgrade — *provided* the framing stays "AI follows HER" (see §4, risk R1).
- **Bedroom, beat 7.** Already staged, so it is a natural place for a *pre-generated* direction strip (no live latency risk, no quota surprise).
- **Batch staging** (`src/lib/room-batch-card-matrix.ts`, `src/lib/multi-select-batch.ts`) is where exploration would be most expensive — one scope set per room scales the render count multiplicatively. Not demo-appropriate.
- **Not** the find-and-replace beat (beat 4): that flow is a targeted object swap, not open-ended.

### 3.6 Narrative / product-fit tension (important)

The demo's beat 3 is explicitly "**AI follows HER**" — the client dictates the look and the AI executes it. The paper's method is the opposite posture: the **system proposes** several directions. Those can coexist only if the UI is framed as *options for her to choose from*, not as the machine inventing a look she didn't ask for. The paper does not study this framing; the judgement is ours, and it is the single biggest demo risk (§4, R1).

---

## 4. Code / weights availability

- **The paper publishes no code.** The arXiv HTML render (`https://arxiv.org/html/2610.33810v1`, read 2026-10-28) contains **no code-release statement and no repository link** — the only "GitHub" occurrences in the rendered text are arXiv's own page furniture ("Report GitHub Issue", "Submit in GitHub"). We therefore **could not verify any public implementation** and make no claim that one exists.
- **There are no weights to obtain.** The method is **inference-time prompting** over off-the-shelf models (Qwen3.6-35B-A3B for instructions, Qwen-Image-Edit-2509 as the fixed renderer, GPT-5.5 as judge; paper §3.2). No training, no checkpoints, no fine-tuning is described. **Nothing needs downloading.**
- **We can still reproduce the method's mechanics without the paper's stack**, because the appendix publishes the condensed prompts (Appendix B.1 "Realization Generation", Appendix B.2 "Region-Level Exploration") — i.e. the *method* is implementable from the paper text, even though the *code* is not available.
- **What we did not verify:** whether the authors released prompts/datasets beyond the appendix; whether Pinterest's internal 300-task set is public (**almost certainly not** — the paper calls it "an internal evaluation set"); any price or latency of their pipeline (**not published**). The paper is CC BY-NC-SA 4.0, so verbatim reuse of the appendix prompt text in a commercial product would need a licence check — we would re-implement the *structure* in our own wording.

---

## 5. Risks and open questions

**Risks**

- **R1 — narrative collision.** Machine-proposed directions undercut the beat-3 "AI follows HER" line; if the strip reads as "the AI decided", the demo weakens. Mitigation: present directions as *options she picks from*, generated from **her** stated aesthetic/directives.
- **R2 — the mask is not on the wire.** Our provider is instruction-mode (`src/lib/prompts.ts:443-455`), so a spatial scope degrades to a sentence. The paper's grounding gain (3.73 → 3.90) may therefore **not** transfer; our grounding must lean on the architecture-first directives and the negative prompt (`src/lib/holistic-prompt.ts`), which is where our architecture-drift fixes already live.
- **R3 — latency.** 3–4 serial renders = 96–152 s vs the ≤90 s live rule. Mitigation: pre-generate; keep one live render.
- **R4 — cost/quota.** $0.12–0.16 per room × rooms × rehearsal runs, against a 20/day default inpaint quota (`src/lib/api-quota.ts:54`). Mitigation: demo-scale K, explicit budget.
- **R5 — slot model.** 2 fixed slots, B overwritten (`src/lib/edit-room-scope.ts:38-46`); a 4-candidate set does not fit without the deferred variant-history work (`docs/post-demo-backlog.md` §1). Mitigation: pre-generated assets / images outside the slot model, or defer.
- **R6 — paper-abstract mismatch.** The issue's premise ("explore what could be staged, then render the variants") matches the paper's **high-level** Stage 1, which the paper itself shows is a **no-op** (§2.4 read-out 3). If we implement the premise literally we would be reproducing the paper's weakest variant. Our adaptation must be *spatially* grounded (region + extent + direction) to earn anything.
- **R7 — set-level quality is unmeasured.** No in-repo set-level judge; our advisory gates are per-image. Mitigation: a human-in-the-loop check at rehearsal (the demo already has a rehearsal runbook), and a cheap deterministic distinctness check on the generated plans (text-level, not image-level).

**Open questions (unanswered by the paper and by this pass)**

1. Does a *combined* Stage 1 (region **and** direction in one plan) beat the paper's separate high-level and region-level scaffolds? The paper does not test it. — *Answerable only by an internal A/B we have not run.*
2. How much of the paper's groundedness gain survives without mask conditioning on the wire? Untested here (and per the hard stops, untestable here).
3. Does diversity survive our *deterministic-ish* re-render path (qwen with seed: 0 mean drift in our bake-off, `bake-off/drift-results.md`)? The paper's baseline story is about seed-only sampling being weak — but our renders are instruction-mode, and prompt-level diversity (not seed-level) is the part we would adopt.
4. What is the right K for a realtor? The paper used K = 8 for a research set-level metric; the demo needs 3–4. No paper evidence for K < 8.

---

## 6. Verdict: **ADAPT**

**Verbatim verdict: ADAPT.**

**What we adapt, precisely.** Take the paper's **instruction-space exploration** — generate a small set of mutually distinct, feasibility-scoped edit *plans* in text, then render each plan independently — and adapt it into a **prompt-only, no-new-model** capability for staging-studio:

1. **One new planning call, existing models.** A K = 3–4 JSON generator using the OpenAI path already wired for the advisory gate (`src/lib/inpaint-quality-gate.ts` uses `aiModel`/`generateObject` from `src/lib/ai.ts`). Output per candidate: `{region, extent, direction, preservationBoundary, editInstruction}` — i.e. the paper's Stage-1 scope **and** Stage-2 instruction merged into one plan, with the direction dimension added (R6).
2. **Our grounding vocabulary, not the paper's.** The plan's `preservationBoundary` is rendered from the existing architecture-first wording and the holistic negative prompt (`src/lib/holistic-prompt.ts`), and the region field is mapped to the editor's existing scopes ("Whole room / Objects / Paint area", `src/components/edit-room/StagePanel.tsx:117-120`). No mask-on-the-wire assumption (R2).
3. **Render each plan independently** through the existing inpaint path (`src/app/api/inpaint/route.ts` → `src/lib/inpaint-submit.ts`), with the existing advisory gates (`src/lib/inpaint-quality-gate.ts`, `src/lib/edit-conservation.ts`) applied per candidate as the feasibility screen the paper gets from the judge.
4. **Demo-scoped delivery only.** Present the set as **pre-generated** direction material for beat 3 / beat 5 (demo latency and quota rules, R3/R4), and do **not** touch the variant-slot model or the lookbook in this issue (R5).

**Concrete next step (the one thing to do next).** Open a follow-up issue that implements **no** UI and **no** pipeline change, but produces the demo material for one room — the Living Room of "1506 Porters Mill Ter":

- **Step 1 (design, no spend):** write the plan schema `{region, extent, direction, preservationBoundary, editInstruction}` and a K = 3 sample set of plans by hand from Lauren's stated brief and the project aesthetic, using the architecture-first wording as the preservation boundary. Review them against the schema for mutual distinctness.
- **Step 2 (one paid run, during rehearsal, not on this VM):** render the 3 plans through the existing inpaint path on the demo account (~$0.12, ~100 s serial), and check each with the advisory inpaint quality gate plus the browser-side scene-conservation measure.
- **Step 3 (demo decision):** if the three renders read as three *distinct, plausible* staging directions and none drifts architecture, promote them to a pre-generated direction strip for beats 3/5; if they collapse into three versions of one direction, **skip** the strip and keep today's single-fill + A/B behaviour (the paper's own "Realization only" result predicts that collapse risk is real: Direction Coverage 4.17 without any scaffold).

**Why not ADOPT:** the paper's literal Stage-1 spatial-scope scaffold is not enforceable on our current provider (no mask on the wire, `src/lib/prompts.ts:443-455`), and its own ablation shows a non-spatial (high-level) Stage 1 adds nothing — so adopting the paper as published would give us either a no-op or an unenforceable scaffold, at 8× the candidate count we can afford.

**Why not SKIP:** the repo has a real hole in exactly this place (one realisation per room, no alternative-intent generator; `src/lib/try-another-layout.ts` varies arrangement only), the paper's strongest and cheapest lever — instruction-space diversity — is implementable from the appendix prompt text alone, needs no weights and no new model, and the demo's own script already anticipates pre-generated variants. The adaptation is small, bounded and demo-scoped.

---

## 7. What was NOT done (per this issue's hard stops)

- **No GPU job, no weight download, no paid image API call** (neither fal.ai nor Alibaba nor anything else) was attempted.
- **No prototype variants were rendered**, and none are claimed: this is a paper evaluation, feasibility was judged from the paper text and the repo's demo flow only.
- **No source code, config, test, schema or existing doc was changed.** The only file added by this issue is this document.
- **No demo content, script or lookbook change** is proposed here; §6 describes follow-up work, it does not do it.
