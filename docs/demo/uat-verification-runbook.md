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
batched **region** is then one FLUX.1 Fill generation (one prompt, one run,
one billed call). Merged regions fuse nearby instances automatically (within 5
grid px) so one row may represent multiple detected objects.

- [ ] Read the current listed price for `fal-ai/sam-3-1/image` on the fal.ai
      dashboard (Billing → Usage, or the model page's price line) and record it:
      `$________ per detection call`
- [ ] Read the current FLUX.1 Fill price and record it: `$________ per image`
- [ ] Read the GPT-4o-mini vision-label price (one call per billed detection,
      cached with the segment cache): `$________ per labeling call`
- [ ] Worked example for the demo (fill from the numbers above):
      1 detection (`furniture`) + 1 detection (`sofa`) + 1 region FLUX run
      + 1 vision label call = `$________` for the entire find-and-replace beat
- [ ] Confirm the Vercel function log shows one `segment_concept_timing` line per
      detection (billing events are logged only for completed detections) and
      that the count matches what the demo actually ran
- [ ] Confirm exactly one `POST /api/label-instances` call fires per billed
      detection (vision labels are never billed on cache hits)
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
click-to-toggle is trustworthy on Circle G's real listings. Region merges are
driven by proximity (≤5 grid px → same region); merged regions carry the
sum of member scores as their ranking signal.

- [ ] On ≥5 real before-photos, run the `furniture` catch-all plus 2 specific
      concepts each (`sofa`, `artwork`, `lamp`, …)
- [ ] For each toggle, read the `[concept-tool] selection_logged` console event
      (`score` field) and record: photo, concept, instance count, region count,
      score range
- [ ] Healthy: top instances score distinctly above the tail (spread ≥ ~0.15
      between best and worst) and the tinted overlays align with real objects.
      If scores cluster or the tint lands on nothing, mark the photo
      **brush-flow only** and keep it out of the demo
- [ ] Note any photo where SAM 3.1 returns **zero masks** for a reasonable
      concept — that is a valid result (the UI says "no <concept> found — try
      'furniture' or the brush"), but it must not happen on the demo room

## 5. Select-all region-batching logic

Select-all (the "Select all detected" button) walks the proximity graph of
detected instances and groups them into connected components. The cap logic
differs from the old per-object behaviour:

- [ ] **≤5 connected components:** every detected region is selected — the
      button becomes disabled and the notice reads "All N regions selected"
- [ ] **>5 connected components:** the top N regions by member score sum are
      selected; the rest are left unselected and the notice reads
      "Top N regions selected; N regions left out (increase cap or clear to
      refine)"
- [ ] Verify the cap notice is accurate after toggling individual regions
      (the count of selected regions updates in real time)
- [ ] Verify nearby instances (≤5 grid px apart) are pre-merged into one region
      in the batch panel row — one badge, one prompt field, one billed run

## 6. Vision labels

One GPT-4o-mini vision call fires per **billed** detection (never on cache
hits). The label appears in the batch panel row and on the canvas badge.

- [ ] On a fresh detection (uncached), confirm exactly one
      `POST /api/label-instances` request fires (visible in Network tab)
- [ ] On a re-select of a cached concept, confirm **zero** label calls fire
      (cache hit — label is served from the cached detection)
- [ ] Verify the batch panel row label matches the vision concept (e.g.
      "E2E sofa-1" or similar GPT-assigned name); if no label arrived,
      the concept string falls back (e.g. "sofa")
- [ ] Merged regions show a combined label joining unique member labels
      ("sofa and coffee table"); the best known label pre-fills the prompt

## 7. Editor layout — two-pane / tabbed (lg+)

On viewports ≥1366×768 the editor uses a two-pane layout: canvas on the left,
an internally-scrolling 380px panel on the right. Below that it stacks
vertically. Three tabs manage the workflow:

- **Entire room** — visible only when the source image is the original photo
- **Manual paint** — brush + mask drawing
- **Auto detect** — concept chip bar, custom concept input, detected instances

- [ ] Confirm the two-pane layout appears at lg+ and stacked below
- [ ] Confirm the "Entire room" tab is hidden when editing a staged variant
      (only original photos qualify for the preset shortcut)
- [ ] Confirm the batch staging panel sits inside the right panel and its
      "Batch staging N / 5 objects" count reflects **region** count, not raw
      instance count

## 8. Failure-copy checks (trigger each once)

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

## 9. Go / no-go

- [ ] Pricing recorded, demo-beat cost under the agreed ceiling
- [ ] p95 detection latency under the ~30s narration budget
- [ ] Demo room's score spread healthy (or the demo room switched to a healthy one)
- [ ] Select-all cap logic behaves correctly at ≤5 and >5 regions
- [ ] Vision label calls fire exactly once per billed detection and zero on cache hits
- [ ] Two-pane / tabbed layout renders correctly at lg+; stacked below
- [ ] All six failure-copy checks pass

Any unchecked box → run the beat brush-first in the demo and keep find-and-replace
as a stretch reveal, exactly like the >90s variant reveal in the main script.

(End of file - total 164 lines)
