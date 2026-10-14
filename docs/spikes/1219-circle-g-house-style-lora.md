# Spike 1219 — DATA-GATED: Circle G house-style LoRA on Qwen-Image (brewery-ai)

Issue: [#1219](https://github.com/anchapin/staging-studio/issues/1219)

## Status

**GATE NOT YET OPEN** — image-rights confirmation is the prerequisite for every other step. Do not start collecting, training, or A/B testing until that gate is closed.

This spike is documentation-only. No production code, training run, or serving-path change is committed as part of this spike.

---

## NOT IMPLEMENTED

Issue #1219 is **NOT IMPLEMENTED**. It will not be implemented until the gate criteria are satisfied.

---

## Gate criteria (must ALL be true before implementation)

| Gate | Issue | Criterion | Current state |
|------|-------|-----------|---------------|
| 1 | #1219 | Image rights: Circle G owns or licenses every photo used for training, in writing | **NOT MET** — no rights audit has been performed on any finished-stagings corpus |
| 2 | #1219 | Training corpus: ~100–200 captioned finished Circle G rooms collected, captioned (room type, style, palette), and ready for upload to brewery-ai | **NOT MET** — no corpus exists; rights gate (Gate 1) blocks collection |
| 3 | #1219 | Cost estimate: written training-cost estimate (rental GPU × estimated hours) reviewed and approved before renting | **NOT MET** — no estimate exists yet |

All three checkboxes above are **unchecked** in the issue body. The gate is closed.

---

## Why

Lookbook renders run through general-purpose generation and inpaint models (see #1181 for the model bake-off that picked Alibaba Cloud DashScope `qwen-image-2.1-pro` for inpainting). The Circle G look has to be carried by prompts and per-room directives on every call. A small style LoRA trained on Circle G's own finished stagings could make the house style the default, lifting "looks like Circle G" from a per-prompt discipline to a model property.

[brewery-ai](https://github.com/empero-org/brewery-ai) trains Qwen-Image 2.1 LoRAs from a captioned image set plus a trigger word. It renders preview images at every checkpoint with fixed seeds, keeps each checkpoint, and ships a local side-by-side gallery for choosing the best one. Its own Y2K demo used 160 captioned photos and picked the step-500 checkpoint from the previews — the same scale this spike targets.

---

## Spike plan

### 1. Image rights (Gate 1)

- Pull every finished-stagings photo under consideration and tag it with its provenance: Circle G portfolio shoot, MLS-listing photo, vendor-supplied, third-party magazine, client-supplied, etc.
- For each non-Circle-G source, confirm in writing that Circle G has a license to use the photo for internal model fine-tuning. A vendor's "use on our website" clause is not training-rights; require an explicit fine-tune / derivative-model clause or owner-signed release.
- Photos without confirmed rights are out of the corpus, period. The issue's "spike" step 1 is the entire gate for steps 2–4; rights come first, training comes after.

### 2. Dataset collection (Gate 2)

- Target: **100–200 captioned finished Circle G staged rooms**. Use the Y2K demo's 160-photo scale as a calibration point — smaller is risky for style coverage, larger is wasted effort at this corpus quality.
- Caption schema (one row per photo):
  - `photo_id` — opaque id, no PII
  - `room_type` — living / bedroom / kitchen / dining / bathroom / office / other
  - `style` — short style phrase (`modern-farmhouse`, `transitional`, `coastal-calm`, etc.; pull from the existing staging-aesthetics vocabulary where it fits)
  - `palette` — 3–6 dominant colors, lowercase hex or named
  - `trigger_word` — `circleg` on every row (single-word trigger; matches brewery-ai convention)
  - `rights_status` — reference to the Gate 1 audit row
- Photo prep: discard duplicates, near-duplicates, and photos already used as in-progress shots in the live lookbook corpus (the A/B set below must not overlap the training set).
- Storage: outside the repo. The training corpus is firm-owned imagery; it does not belong in `src/`, in Supabase Storage, or in any committed directory. Keep it on a Circle-G-controlled drive; the spike only documents provenance and caption schema.

### 3. Training cost estimate (Gate 3)

- brewery-ai trains Qwen-Image 2.1 LoRAs on rented GPU. Before renting anything, write the estimate:
  - GPU choice (typical: A100 40/80GB or H100; pick what brewery-ai's recipes recommend for Qwen-Image 2.1)
  - Estimated hours per the brewery-ai recipe at this corpus size (100–200 captioned photos; the 160-photo Y2K demo is the closest published reference)
  - $/hour at the rental provider
  - Estimated total = hours × $/hour × safety margin (≥1.5× to cover re-runs from captioning fixes and trigger-word experiments)
- Surface the estimate in the issue before spending. The gate stays closed until the estimate is reviewed and approved.

### 4. Train one LoRA

- Run brewery-ai's training recipe against the Gate 2 corpus with the trigger word `circleg`.
- brewery-ai renders previews at every checkpoint with fixed seeds and keeps each checkpoint, so A/B selection happens **after** training, not as a hyperparameter sweep.
- Pick the best checkpoint from the local side-by-side gallery. Record the chosen step number and the preview image filenames.

### 5. Blind A/B vs current pipeline

- Inputs: **10 empty-room photos**, held out from the training corpus. None of the 10 may appear in training or in any pre-training LoRA test.
- For each input, generate two outputs:
  - **A (current):** the existing inpaint/generation path — Alibaba Cloud DashScope `qwen-image-2.1-pro` ($0.04/image, Singapore endpoint, workspace `llm-x83c15vnd001kxij`) — using the same per-room directives the editor would issue for a real lookbook render.
  - **B (LoRA):** the trained LoRA on Qwen-Image 2.1 served through whichever path step 6 selects, with the trigger word `circleg` prepended to the directive.
- A/B is **blind**: shuffle A and B outputs per room, label them with opaque ids, and have the firm operator (or Alex, in the firm-operator's absence) rank each pair on house-style fidelity. Record scores per room, then unblind.

### 6. Serving path check

The training is no use if the LoRA cannot be served in production. Three candidate paths:

| Path | Status today | LoRA feasibility |
|------|--------------|------------------|
| **Alibaba Cloud DashScope** (current production inpaint provider since #1240; `qwen-image-2.1-pro` at $0.04/image, Singapore endpoint) | Live | Need to confirm DashScope accepts a custom LoRA weight on Qwen-Image 2.1 inpainting. If yes, drop-in via the existing `src/lib/alibaba-adapter.ts` and a new `ALIBABA_INPAINT_LORA_URL` env. If no, this path fails for LoRA. |
| **fal.ai** (retired for production inpaint after #1240; `fal` is still in the `INFERENCE_PROVIDER` parser but throws at configure time) | Retired | Could revive if fal hosts a Qwen-Image LoRA endpoint, but it is not the production inpaint path; this is a fallback only. |
| **Replicate** (retired for production inpaint after #1240; same `INFERENCE_PROVIDER` parser behavior) | Retired | Replicate is documented to host Qwen-Image derivative models; the `#1200` replicate probe exists but is for FLUX.1 Fill, not Qwen. Would need a new probe and a fresh adapter. |

A LoRA is only worth shipping if it can ride the Alibaba path (the current production path). fal and Replicate are escape hatches, not the primary plan.

### 7. Recorded go/no-go

The done-when bar from the issue body: **"A recorded go/no-go with the A/B images, training cost and serving cost."** That artifact must include:

- The 10 A/B image pairs (5 inputs × 2 paths, or 10 inputs × 2 paths — pin the exact count in the artifact)
- Blind-rank scores from the firm operator
- Training cost: GPU × hours × $/hour, recorded against the rental invoice
- Serving cost: $/image at the chosen path, recorded against the provider's published price
- A single-sentence recommendation: **GO** (wire the LoRA into `src/lib/alibaba-adapter.ts` and ship behind the trigger word) or **NO-GO** (fall back to prompts; record why)

---

## Open questions

1. **DashScope LoRA support.** Step 6's biggest unknown. If DashScope does not accept a custom LoRA weight on Qwen-Image 2.1 inpainting, the spike needs a serving-path detour (fal or Replicate) — and a serving-path detour means reviving a retired provider, which is a bigger change than the LoRA itself.
2. **Trigger-word ergonomics.** `circleg` is the candidate. brewery-ai supports any token, but a token that does not collide with the model's vocabulary produces a cleaner trigger. A short list of 2–3 alternates (`cgstyle`, `circleGstaging`) is worth evaluating in step 4's previews.
3. **Caption coverage at 100–200 photos.** Will 160 photos cover the firm's full room-type × style × palette matrix, or do we need to weight by underrepresented cells? Worth checking the Gate 2 caption distribution before training, not after.
4. **Retention of the trained LoRA weights.** Where do they live? They cannot ride Supabase Storage at multi-GB weight sizes without a quota review. The spike does not need to answer this, but the GO path needs to.
5. **Interaction with the existing directives pipeline.** A LoRA-conditioned render still needs the room-specific directive (focal-piece changes, mask-guided edits). Confirm brewery-ai's LoRA conditioning combines cleanly with masked inpainting, not just text-to-image.

---

## Relationship to other issues

| Issue | Relationship |
|-------|--------------|
| [#1181](https://github.com/anchapin/staging-studio/issues/1181) — model bake-off that picked the current production path | Pre-requisite: the LoRA must serve on the path #1181 picked, or the spike ends in NO-GO on serving cost |
| [#1240](https://github.com/anchapin/staging-studio/issues/1240) — Alibaba migration for inpaint | Pre-requisite: LoRA on Alibaba depends on the DashScope adapter that #1240 shipped |
| [#240](https://github.com/anchapin/staging-studio/issues/240) — fine-tuned staging-taxonomy classifier | Sister data-gated spike. Same gate discipline (rights/corpus first, training after). |

---

## Files to be created when gate opens

When the gate criteria above are satisfied, the following files are expected:

| # | What |
|---|------|
| 1 | Image-rights audit log (outside the repo, firm-controlled) — Gate 1 |
| 2 | Captioned corpus (outside the repo) — Gate 2 |
| 3 | Written cost estimate in the issue — Gate 3 |
| 4 | brewery-ai training run on the rented GPU |
| 5 | Blind A/B image pairs (10 inputs × 2 paths) |
| 6 | Recorded go/no-go artifact in this spike doc |
| 7 | If GO: `src/lib/alibaba-adapter.ts` accepts a LoRA weight via a new env; if NO-GO: this spike closes without code changes |

---

## Spike conclusion (this turn)

**Gate is closed.** All three criteria (image rights, captioned corpus, training-cost estimate) are unmet. The plan above is what closes each gate and what the recorded go/no-go artifact must contain.

Recommend:
1. **Stop here.** Do not collect, do not train, do not A/B test. The image-rights audit (Gate 1) is the entire blocker; corpus collection (Gate 2) and the cost estimate (Gate 3) follow once rights are in writing.
2. When the firm-operator can produce the rights audit, run the rest of this spike's plan in order — rights → corpus → estimate → train → A/B → serving check → go/no-go.
3. A NO-GO on serving path (DashScope refuses the LoRA weight, fal/Replicate cost is unacceptable) closes the spike without code changes. The recorded artifact is the deliverable either way.