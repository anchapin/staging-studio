# Spike 605 — Research: Laya fine-tuning experiment for Dana finding triage

Issue: [#605](https://github.com/anchapin/staging-studio/issues/605)

## Status

**RESEARCH SPIKE — documentation only.** This is a research spike that documents the experiment protocol. No production code is committed as part of this spike.

---

## NOT IMPLEMENTED

Issue #605 is a **research spike only**. No implementation is warranted until the experiment completes and go/no-go gates are evaluated.

---

## Background

PR #602 (commit `17663dc`, issue #599) merged a Dana finding triage + cross-run dedup script (`docs/dana-rig/triage.js`). The script uses the TypeSafe/Jev typed-decision API to classify findings by severity (0–3) and category (broken / confusing_copy / missing_feedback / workflow_friction / visual_polish), and to deduplicate new findings against a stored baseline via a noul (same-issue?) question.

**The generative API cost problem:** Each triage call to TypeSafe/Jev costs money per inference. The nightly Dana run produces a growing list of labeled findings — but exploiting those labels via the API means paying for every classification and dedup call.

**The Laya opportunity:** [Laya](https://laya.github.io) (ConvAI Innovations' open self-hostable decision-model family, Apache 2.0) runs at ~33 ms GPU inference with zero marginal cost once hosted. It provides typed choice/score/noul primitives — the same primitives triage.js uses — at a fraction of the cost.

### What Laya is and isn't

Laya's published benchmarks (verified against their own evaluation page):

| Benchmark | Score | Note |
|-----------|-------|------|
| Base zero-shot typed-decision accuracy | **0.362** vs 0.318 random | "a fast base to specialise, not a zero-shot decision engine" |
| Calibration (ECE) | 0.466 (uncalibrated) → **0.081** (per-question-type temperature refit) | needs per-type temperature tuning |
| Headline decision accuracy | **0.766** | this is a **fine-tuned** checkpoint |
| English checkpoint context limit | **512 tokens** | findings must be extracted per-item, not fed whole reports |

**The key insight from Laya's own documentation:** the 0.766 headline is a **fine-tuned** result. The base zero-shot model is only slightly above random. This is not a criticism — it means the model specializes well with fine-tuning. The question is whether we have enough labeled data to fine-tune effectively for this domain.

**We do.** Alex's triage labels grow for free with every nightly run. Each Dana walkthrough produces labeled findings (severity + category, confirmed by Alex's judgment in the triage output). The baseline cache (`.triage-baseline.json` written by `triage.js --store-baseline`) accumulates these labels across runs.

---

## Relationship to other issues

| Issue | Relationship | Blocking? |
|-------|-------------|-----------|
| [#606](https://github.com/anchapin/staging-studio/issues/606) — Real-time directive coaching | **Earns the endpoint.** If Laya passes the triage gates, it earns the inference endpoint that coaching needs | Yes — coaching cannot ship without this endpoint |
| [#607](https://github.com/anchapin/staging-studio/issues/607) — Self-driving Dana | **Earns the endpoint.** Same inference endpoint for the real-time coaching + self-driving pipeline | Yes — same endpoint |
| [#602](https://github.com/anchapin/staging-studio/issues/602) — Dana finding triage (merged) | Prerequisites the experiment; triage.js is the data source | No — merged |

Issues #606 and #607 explicitly state: "Do not stand up hosting for this alone — it only ships if the Dana-triage fine-tuning issue earns the inference endpoint first." This experiment is that issue.

---

## Current Dana triage pipeline (PR #602)

### What triage.js does

1. **Extract findings** from a Dana report's `## 3. Ranked Friction List` table (rank, severity, friction text, location, suggestion)
2. **Classify each finding** via TypeSafe/Jev API: severity (0=nit, 1=minor, 2=blocks, 3=broken) and category (broken / confusing_copy / missing_feedback / workflow_friction / visual_polish)
3. **Cross-run dedup** against the stored baseline: for each new finding, uses keyword-overlap pre-filter (top-K candidates) then a noul TypeSafe question ("YES/NO — same underlying issue?")
4. **Guardrails**: only auto-escalates severity ≥ 2 AND confidence ≥ 0.7; everything else lands in a collapsed appendix
5. **Outputs** a triage summary with escalations, new findings, reproduced/changed findings, and full appendix

### Existing labeled findings

The labeled corpus currently consists of:

- **Dana walkthrough report (Run 5, 2026-09-21):** 1 finding — severity=Low/Cosmetic, category=visual_polish (textarea auto-expand in batch-staging-panel)
- **Prior Dana runs:** archived in `$DANA_REPORTS/` (date-named `dana-YYYY-MM-DD.md` files). Each run's findings accumulate in `.triage-baseline.json` after `--store-baseline`
- **Alex's triage labels:** the severity and category labels assigned by TypeSafe in triage.js are stored in the baseline cache; Alex confirms or overrides them when reviewing triage output

**Estimated corpus at time of experiment:** ~12 findings across 2 archived Dana reports (from issue description; exact corpus size to be verified during experiment setup).

---

## The experiment: three baselines

The experiment compares three approaches on the labeled finding corpus:

### Baseline 1 — Zero-shot Laya (sanity check)

Run Laya's base model (no fine-tuning) on the held-out set. **Expect ~random performance (0.362 accuracy vs 0.318 random baseline).** This establishes the floor and verifies the model is indeed not a zero-shot decision engine.

**Protocol:**
1. Split labeled findings 80/20 into train/held-out (stratified by severity)
2. For each held-out finding, prompt Laya with the same question text used in triage.js
3. Measure: Cohen's kappa vs Alex's labels, dedup accuracy, ECE

### Baseline 2 — TF-IDF + Logistic Regression (cheap baseline)

If this clears the gates, use it and skip Laya entirely — no inference endpoint needed.

**Protocol:**
1. Vectorize finding text with TF-IDF (unigrams + bigrams, max 500 features)
2. Train two separate Logistic Regression classifiers: one for severity (ordinal, 4-class), one for category (multinomial, 5-class)
3. Cross-validate (5-fold, stratified) on the full labeled corpus
4. Measure: Cohen's kappa vs Alex's labels, dedup accuracy (pairwise similarity scoring), ECE (calibration curve)

**Why this baseline first:** TF-IDF + LR is fast, interpretable, requires no GPU, and often clears classification gates on small labeled corpora. If it clears kappa ≥ 0.6, the conversation about Laya ends — we use the LR baseline.

### Baseline 3 — One-shot fine-tuned Laya

Fine-tune Laya on the accumulated labeled corpus, then evaluate on held-out set.

**Protocol:**
1. **Fine-tuning setup:** Use Laya's fine-tuning API (or self-host via Ollama / LM Studio). Fine-tune on the 80% train split of labeled findings.
2. **Per-type temperature refit:** Per Laya's calibration guidance (ECE 0.466 → 0.081 with refit), tune temperature separately for severity and category question types.
3. **Context management:** Laya's English checkpoint has a 512-token context limit. Findings must be extracted **per-item** (one finding per inference call), not fed as a batch. This is already how triage.js works — no change needed.
4. **Evaluate on held-out 20%:** Cohen's kappa, dedup accuracy, ECE

**If round 1 kappa < 0.45:** One additional fine-tuning round permitted. If after two rounds kappa still < 0.45, stop — the generative triage in triage.js stays.

---

## Go / No-go gates

All three must be met for Laya to pass:

| Gate | Criterion | Threshold |
|------|-----------|-----------|
| Severity classification | Cohen's kappa (held-out) | ≥ 0.6 |
| Dedup accuracy | Pairwise dedup accuracy (held-out) | ≥ 80% |
| Post-refit calibration | ECE (per question type, after temperature refit) | ≤ 0.15 |

**Go:** all three gates cleared → proceed to endpoint hosting design (tracked in #606 / #607)
**No-go / stop:** two fine-tuning rounds don't move kappa past 0.45 → park it; generative triage in triage.js stays; no endpoint deployed

**No-go is not a failure.** Generative triage via TypeSafe/Jev is working. The experiment answered the question "could Laya be cheaper?" with "not yet on this corpus size." Revisit when the corpus is larger.

---

## Held-out evaluation methodology

### Severity + Category classification

1. **Split:** 80% train / 20% held-out, stratified by severity level
2. **Train classifiers** on the 80% split (for TF-IDF+LR) or fine-tune Laya on the 80% split
3. **Evaluate on held-out 20%**:
   - Cohen's kappa (severity): compare predicted severity vs Alex's label
   - Cohen's kappa (category): compare predicted category vs Alex's label
   - Report both; primary gate uses severity kappa
4. **ECE (Expected Calibration Error):** bin predictions by confidence, compute |avg confidence − accuracy| per bin, average across bins

### Dedup accuracy

1. **Build pairwise dedup test set:** From the held-out findings + baseline, create all pairs of semantically similar finding pairs (keyword-overlap pre-filter) and label each pair as same-issue / different-issue
2. **Run dedup** on the test set using the fine-tuned Laya noul question
3. **Accuracy:** % of pairs correctly classified as same/different

### Temperature refit protocol

Per Laya's calibration guidance, run a temperature sweep on the training split:
1. Try temperatures: [0.1, 0.3, 0.5, 0.7, 1.0]
2. For each temperature, compute ECE on 5-fold cross-validation of the training split
3. Select temperature with lowest ECE per question type (severity / category / noul)
4. Report post-refit ECE on held-out set

---

## Experiment setup checklist

- [ ] Verify exact labeled finding count from Dana report archives (~$DANA_REPORTS/)
- [ ] Export labeled findings corpus from `.triage-baseline.json` and any archived Dana reports
- [ ] Implement TF-IDF + LR baseline (Python or Node.js inline script in `docs/dana-rig/`)
- [ ] Set up Laya inference (Ollama or LM Studio with Laya checkpoint, or Laya hosted API if available)
- [ ] Run Baseline 1: zero-shot Laya on held-out set
- [ ] Run Baseline 2: TF-IDF + LR cross-validation
- [ ] Evaluate gates — if LR clears kappa ≥ 0.6, document result and stop (LR is the winner)
- [ ] Run Baseline 3: fine-tune Laya on 80% split, evaluate on held-out
- [ ] If kappa < 0.45 after round 1, run round 2 fine-tuning
- [ ] Apply temperature refit, compute post-refit ECE
- [ ] Document final metrics against all three gates

---

## Files created by this spike

| File | Purpose |
|------|---------|
| `docs/spikes/605-laya-finetuning.md` | This spike document |
| `docs/dana-rig/experiment/` | Experiment scripts and data (if any) |

---

## References

- [Laya model documentation](https://laya.github.io) — ConvAI Innovations, Apache 2.0
- [PR #602 — Dana finding triage + dedup](https://github.com/anchapin/staging-studio/pull/602)
- `docs/dana-rig/triage.js` — current generative triage script
- `docs/spikes/606-directive-coaching-laya.md` — coaching issue (earns endpoint from this experiment)
- `docs/spikes/240-classifier-spike.md` — prior data-gated spike for reference (similar structure)
