# UAT Verification Runbook — Find & Replace (SAM 3.1 concept pass)

The operator checklist that gates the find-and-replace beat (issue #231) — run it
**before** the UAT session and keep it open **during** it. Where the [rehearsal
runbook](./rehearsal-runbook.md) drills the demo choreography, this runbook
verifies the concept tool's **cost, latency, selection quality, and failure
copy** against the production deploy.

Production URL: `https://staging-studio-kappa.vercel.app` (exact, no trailing slash).
The browser specs in `tests/e2e/specs/concept-flow.spec.ts` pin the mechanics
hermetically; this runbook checks the things only the **live** provider can tell you.

---

## 1. Pre-session checklist

- [ ] `bash scripts/rehearsal-drill.sh` passes against the deploy (see §6 of the rehearsal runbook)
- [ ] `npm run e2e` green locally — the concept spec proves auto-fire → chip switch → toggle → pre-filled prompts → batch dispatch end to end
- [ ] Demo project's Living Room has a current before-photo (the detection runs on whatever is the source image)
- [ ] DevTools console open (or a saved HAR) so the `[concept-tool]` events are visible during the session

## 2. sam-3-1 per-call pricing (cost per session)

The concept tool is billed **once per (image, concept) detection** — chip clicks,
instance toggles, and repeat selections are free after the first call. Each
batched object is then a separate FLUX.1 Fill generation.

- [ ] Read the current listed price for `fal-ai/sam-3-1/image` on the fal.ai
      dashboard (Billing → Usage, or the model page's price line) and record it:
      `$________ per detection call`
- [ ] Read the current FLUX.1 Fill price and record it: `$________ per image`
- [ ] Worked example for the demo (fill from the numbers above):
      1 detection (`furniture`) + 1 detection (`sofa`) + 1 per-object FLUX run
      = `$________` for the entire find-and-replace beat
- [ ] Confirm the Vercel function log shows one `segment_concept_timing` line per
      detection (billing events are logged only for completed detections) and
      that the count matches what the demo actually ran
- [ ] Sanity-check the daily quota knobs (`/api/segment/furnishings` returns 429
      with "You've reached today's limit for this action." once exhausted) — the
      demo must stay comfortably under the limit

## 3. p50 / p95 detection latency

The UI blocks on the detection (the editor auto-fires it on open), so latency is
the number Lauren feels.

- [ ] Open ≥5 rooms across ≥3 real projects; note each detection's wall time.
      Two sources of truth:
      - the `segment_concept_timing` server log line (`ms` field), and
      - DevTools → Network → `POST /api/segment/furnishings` (time to first byte +
        body download)
- [ ] Compute **p50 = ______ s** and **p95 = ______ s** over the samples
- [ ] Confirm p95 is comfortably under the route's 90s detection timeout — above
      ~30s the "already detected on editor open" narration collapses; if p95
      drifts past that, lead with the brush flow and treat detection as a bonus
- [ ] Cross-check the client's `segment_prewarm_timing` console event (`ok: true`)
      — a mismatch vs. the server line points at response-transfer overhead
      (mask re-encoding), not provider time

## 4. Score spread on real firm photos

Instance quality is score-ranked (index 0 = highest). The numbers decide whether
click-to-toggle is trustworthy on Circle G's real listings.

- [ ] On ≥5 real before-photos, run the `furniture` catch-all plus 2 specific
      concepts each (`sofa`, `artwork`, `lamp`, …)
- [ ] For each toggle, read the `[concept-tool] selection_logged` console event
      (`score` field) and record: photo, concept, instance count, score range
- [ ] Healthy: top instances score distinctly above the tail (spread ≥ ~0.15
      between best and worst) and the tinted overlays align with real objects.
      If scores cluster or the tint lands on nothing, mark the photo
      **brush-flow only** and keep it out of the demo
- [ ] Note any photo where SAM 3.1 returns **zero masks** for a reasonable
      concept — that is a valid result (the UI says "no <concept> found — try
      'furniture' or the brush"), but it must not happen on the demo room

## 5. Failure-copy checks (trigger each once)

Every failure must surface actionable copy, never a dead end. Trigger each and
compare against the expected strings.

| # | How to trigger | Expected copy |
| - | -------------- | ------------- |
| 1 | Type `Sofa, and chairs!` into Custom concept → Detect | "Use a single lowercase word or short phrase — 1–30 characters, lowercase letters, spaces, and hyphens only (no commas, numbers, or sentences). Try \"sofa\" or \"wall art\"." (client-side, no call fired) |
| 2 | Pick a concept nothing matches (e.g. `unicorn`) on a real photo | "no unicorn found — try 'furniture' or the brush" |
| 3 | Same empty result on the catch-all | "no furniture found — try another concept or the brush" |
| 4 | Simulate a provider failure (or catch a 500 in the wild) | "Couldn't detect \"<concept>\" — try again, another concept, or the brush." |
| 5 | Detection exceeding the timeout budget | "The furnishings detection service is taking too long to respond. Please try again." |
| 6 | Exhaust the daily detection quota | "You've reached today's limit for this action. Please try again tomorrow. Your usage resets shortly after midnight (server time)." |

- [ ] Check #1 fires **without** a network call (count the requests in DevTools)
- [ ] Check #4 leaves the canvas and any pending mask untouched (a failed
      detection never clobbers a staged variant)
- [ ] All six strings read as-is; any drift is a copy regression — file it

## 6. Go / no-go

- [ ] Pricing recorded, demo-beat cost under the agreed ceiling
- [ ] p95 detection latency under the ~30s narration budget
- [ ] Demo room's score spread healthy (or the demo room switched to a healthy one)
- [ ] All six failure-copy checks pass

Any unchecked box → run the beat brush-first in the demo and keep find-and-replace
as a stretch reveal, exactly like the >90s variant reveal in the main script.
