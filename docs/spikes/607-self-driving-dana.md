# Spike 607 — Self-driving Dana: Laya as per-step driver

Issue: [#607](https://github.com/anchapin/staging-studio/issues/607)

## Status

**RESEARCH — PREREQUISITES NOT MET.** This spike is gated on the triage fine-tuning experiment establishing the labeled dataset pipeline and temperature-fitting discipline. This document is architectural research and tracking; no production code is warranted until go/no-go criteria are satisfied.

---

## Summary of the proposal

Replace the frontier-model per-step driver in Dana sessions with a fine-tuned **Laya** model that:

1. **`next_action`** — classifies which relay op to issue (click, fill, upload, paint, …)
2. **`stuck`** — binary noul call: has the session stopped making progress?
3. **`confusing`** — per-step confusing-ness score, feeding the triage pipeline directly

The frontier model only intervenes on low confidence, `stuck` firing, or the final report write-up.

Motivation: $0 marginal cost per step (~33 ms) vs. frontier model spend makes a multi-persona nightly matrix affordable.

---

## Current Dana driver architecture

### Session loop

The Dana session loop (from `docs/dana-rig/dana-prompt.md`) is:

```
start → loop { snapshot + screenshot → decide ONE action → issue it → narrate }
```

Each iteration is driven by a **frontier LLM** (the coding agent running as Dana). The agent reads the relay response from each op and narrates its reasoning.

### The relay (`docs/dana-rig/driver.js`)

The browser relay exposes ~20 ops over `POST /act` to a headless Playwright Chromium instance. The ops split into:

**Observation ops:**
- `snapshot` — returns `{url, title, text, interactives:[{id,tag,type,role,name,x,y,w,h}]}`
  - `text` is `document.body.innerText` sliced to 7000 chars
  - `interactives` is the a11y tree: buttons, links, inputs, textareas, selects, canvases, and elements with ARIA roles, each annotated with `data-ux-id`
  - No screenshot data — purely textual/accessibility representation
- `screenshot` — saves a PNG under `$UX_PROTO_SHOT_DIR/` and returns `{path}`

**Action ops (~12 core):**
- Navigation: `start {url}`, `goto {url}`, `url`
- Pointer: `click {id}`, `clickText {text}`, `fill {id,text}`, `type {id,text}`, `press {id,key}`, `check {id}`, `select {id,value}`
- Upload: `upload {clickId,path}`
- Paint: `paint {id,strokes}` — polylines in bbox fractions
- Utility: `bbox {id}`, `wait {ms}`, `waitForText {text,timeout?}`, `waitForGone {text,timeout?}`, `eval {code}`, `close`

### Current driver state representation

The `dana-prompt.md` runner instructions say:

> `POST /act {"op":"snapshot"}` + `{"op":"screenshot"}` (the relay saves a PNG and returns its path — **read that file to SEE the page**)

This confirms the **current Dana driver reads screenshots** to make decisions. The runner prompt passes `__SCREENSHOT_NOTE__` instructing the agent to read PNG files at paths returned by `screenshot`.

The `snapshot` op provides the a11y tree (text + interactive elements), but the agent additionally reads the screenshot to see the visual layout.

---

## Go/No-Go: screenshot dependency analysis

**No-go criterion from the issue:**
> if traces show the current driver was reading *screenshots* rather than the a11y tree — Laya is text-only, so that's a state-representation gap, not a model gap. Don't fine-tune your way around missing inputs.

**Finding: The current driver IS screenshot-dependent.** Evidence:

1. `dana-prompt.md` runner instructions explicitly direct the agent to read PNG files returned by `screenshot`
2. `nightly.sh` substitutes `__SCREENSHOT_NOTE__` with instructions to read screenshot files
3. TheDana persona brief has no instruction to limit to the a11y tree — Dana narrates what she "sees" in screenshots

**Implication:** There is a **state-representation gap**. Laya, as a text-only model, cannot see screenshots. The gap cannot be closed by fine-tuning. Possible paths to close it:

1. **Modify the driver prompt** to make the agent screenshot-averse — only read screenshots on explicit confusion, defaulting to a11y-only decisions. This is a prompt/instruction change, not a model change. The resulting Dana traces would then be text-only (snapshot-based) and usable for Laya fine-tuning.
2. **Build a visual overlay model** (separate from Laya) that reads screenshots and produces a textual state description that Laya can consume. This is more complex.
3. **Abandon** the fine-tuning approach for the per-step driver and keep the frontier model.

**Recommended next step before any fine-tuning work:** Audit the existing Dana traces (if any are archived) or run 3–5 hermetic trials with a **screenshot-shy** Dana prompt variant to determine what fraction of steps genuinely require screenshot reading vs. can be driven from the a11y tree alone.

---

## Laya per-step driver design

### Primitives

| Primitive | Type | Description |
|-----------|------|-------------|
| `next_action` | choice over ~12 ops | Which relay op to issue. Options: `click`, `clickText`, `fill`, `type`, `press`, `check`, `select`, `upload`, `paint`, `waitForText`, `waitForGone`, `done` (session complete) |
| `action_args` | dict | Parameters for the chosen op, e.g. `{id: "u5"}` or `{text: "Upload"}` |
| `stuck` | noul (YES/NO) | Has the session stopped making progress? |
| `confusing` | score 0–1 | Per-step confusing-ness rating. Feeds triage pipeline. |

### Integration with frontier model (fallback)

```
loop:
  laya_output = Laya.next_action(snapshot)  # snapshot only — no screenshot
  if laya_output.confidence < threshold or laya_output.stuck == YES:
    frontier_output = Frontier.next_action(snapshot + screenshot)  # full modal
    emit frontier_output
  else:
    emit laya_output

  if done:
    Frontier.write_report()  # only frontier model writes the final report
```

### Training data requirements

Every Dana trace (snapshot → action pair) is a labeled step. A trace looks like:

```
{snapshot: {url, title, text, interactives}, action: {op, args, narrate}}
```

Dana walkthrough reports (`dana-walkthrough-report.md`) contain the friction lists and step narratives that provide the `confusing` signal.

**Trace archive:** There is currently no structured trace archive. The `nightly.sh` saves dated reports to `$DANA_REPORTS/`, but these are the post-hoc narrated reports, not the step-by-step snapshot→action pairs. To build the training corpus:

1. Instrument `nightly.sh` or the Dana runner to log each step as JSONL: `{snapshot, action, narrate, step_index}`
2. Store traces alongside the reports in `$DANA_REPORTS/traces/`
3. Parse `dana-walkthrough-report.md` friction lists to derive per-step `confusing` labels

---

## Go/No-Go criteria

From issue #607:

**Go:** ≥ 4/5 hermetic trials reach a staged result at ≤ 1.5× the generative driver's step count.

**No-go:** Traces show the current driver was reading screenshots rather than the a11y tree — Laya is text-only.

### What needs to be measured

1. **Step count ratio**: Laya-driver step count ÷ current frontier-driver step count across 5 hermetic trials
2. **Success rate**: # trials reaching staged result / 5 trials
3. **Screenshot dependency audit**: For each step in a sample trace, did the agent reference the screenshot? If >20% of steps required screenshot reading to succeed, the text-only Laya will fail.

### Verification protocol

1. Run 5 hermetic Dana trials with **current driver** (frontier model, screenshot-reading enabled). Record step counts and success/failure.
2. Run 5 hermetic Dana trials with **screenshot-shy variant** (frontier model, screenshot reading only on explicit confusion). Record step counts and success/failure.
3. If screenshot-shy ≥ 4/5 success AND step count ratio ≤ 1.5× → go signal.
4. If screenshot dependency > 20% → no-go, document state-representation gap.

---

## Prerequisite: triage fine-tuning experiment

The issue states: "After the triage fine-tuning experiment (the labeled dataset and temperature-fitting discipline it establishes are prerequisites)."

The triage pipeline in `docs/dana-rig/triage.js` uses TypeSafe (Jev) for:
- Severity classification per finding
- Category classification per finding
- Cross-run dedup via noul (same-issue detection)

The shared investment is:
1. **Labeled dataset pipeline** — Dana friction list → finding extraction → classification → JSONL export
2. **Temperature-fitting discipline** — determining the right sampling temperature for each primitive (low temp for `stuck`/noul binary decisions, higher for `next_action` choice, calibrated for `confusing` scores)
3. **Evaluation harness** — hermetic trial runner with step count + success metrics

Before fine-tuning Laya for Dana, the triage fine-tuning experiment should produce this infrastructure so it can be reused.

---

## Research tracking

| Question | Status | Notes |
|---------|--------|-------|
| Q1: Does current driver read screenshots? | **YES — no-go signal** | Confirmed via dana-prompt.md runner instructions |
| Q2: Can Dana succeed on a11y tree alone? | **UNKNOWN** | Requires screenshot-shy variant trial |
| Q3: Step count ratio (Laya vs frontier) | **UNKNOWN** | Requires baseline measurement + Laya fine-tuned model |
| Q4: Training corpus size for Laya | **UNKNOWN** | No structured trace archive exists |
| Q5: Temperature settings for Laya primitives | **UNKNOWN** | Prerequisites: triage fine-tuning discipline |

---

## Files created or modified by this spike

None yet — this document is the spike output.

---

## Next steps (in priority order)

- [ ] **S0:** Resolve screenshot dependency. Modify Dana runner prompt to make screenshots opt-in (only on explicit confusion). Run 3 screenshot-shy trials to determine if a11y-only driving is viable.
- [ ] **S1:** Instrument `nightly.sh` to log step-by-step snapshot→action pairs to JSONL in `$DANA_REPORTS/traces/`.
- [ ] **S2:** Establish baseline step counts with current (screenshot-reading) driver across 5 trials.
- [ ] **S3:** Complete triage fine-tuning experiment to establish shared dataset pipeline and temperature discipline.
- [ ] **S4:** Fine-tune Laya on snapshot→action corpus with `next_action` / `stuck` / `confusing` primitives.
- [ ] **S5:** Run 5 hermetic Laya-driver trials, measure go/no-go criteria.
