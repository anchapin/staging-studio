# Spike 223 — furnishings-union mask vs wall-band baseline (operator run protocol)

Issue: [#223](https://github.com/anchapin/staging-studio/issues/223) (Problem 1). PRs #224 (Problem 2) and #225 (Problem 1) shipped the code; this doc is the **operator-executed empirical comparison** the issue's acceptance criteria require, run #190-style (see `190-holistic-mask.md` — same discipline, new matrix).

Decision rule (unchanged from #190): **architecture fidelity outranks magic** — wall finish, flooring material, windows/trim/casings, doors, ceiling line, and room geometry must match the source photo in a side-by-side; only furnishings and decor may change.

## What shipped (already on this branch)

| Piece | File | Notes |
| --- | --- | --- |
| Detection lib (pure, 1:1 tests) | `src/lib/furnishing-detection.ts` | `fal-ai/sam-3-1/image`, prompt `"furniture"`, payload builder, response parser, 0.5% coverage guard. |
| Detection route | `src/app/api/segment/furnishings/route.ts` | Auth + room-ownership checked; re-encodes fal mask URLs to data URLs (mirrors `/api/segment`). |
| Hardened prompt | `src/lib/holistic-prompt.ts` | a2 directives gain declutter + "exactly as photographed / do not repaint, refinish, or alter any architecture"; `HOLISTIC_NEGATIVE_PROMPT` reintroduces the single-object architecture terms (they sit outside the mask now). |
| Detection-driven preset | `src/components/canvas/stage-entire-room-preset.tsx` | Cutout→white conversion → union → 15px dilation → coverage guard → run. Fails visibly (no geometric fallback). |
| Preset UX (from #224) | `inpaint-editor.tsx` | Renamed **"Restage furnishings"**, moved below the Apply Inpainting row, marked optional. |

## Verified endpoint contract (probe, 2026-09-18)

- `prompt: "furniture"` → **9 per-object masks** (scores 0.50–0.94) on the probe living room.
- Multi-term comma lists (`"furniture, sofa, rug, …"`) → **0 masks**; sentence prompts → 1 weak mask. **Single bare concept only.**
- Each mask is an RGBA **alpha-cutout PNG at source pixel dims** (transparent bg, opaque photo-colored object pixels).
- fal cannot fetch some hosts (Wikimedia blocked in the probe); production Supabase URLs are fine.
- Cost/latency per preset run: 1 SAM 3.1 detection call (~cents, seconds) + the FLUX.1 Fill run.

## Operator run protocol (4–5 real fal runs)

Prep: dev env with real `FAL_KEY`; `npm run dev`; sign in; open the **porters-mill** project → Living Room (before photo = `porters-mill-living-wide-13.jpg`) → **Edit staging**.

1. Preset runs need no directives — the template supplies them. Keep **Edit from = Original photo** for every run.
2. Run the matrix below, one run per row. Between runs, wait for the result to land (variant slot), then **Download/save both before & after at full res** for the side-by-side sheet.
3. Variant-slot tip (from #190): keep landing results in the *empty* slot so each run's before image is the original photo; download-and-clear between runs if the selection rotates.
4. The preset fires a detection pass first ("Detecting furnishings…"). If it errors with **"No furnishings were detected"** or **"Too little of the photo was detected"**, that IS a result — record it (screenshot) instead of re-running blindly.
5. The wall-band baseline rows use the collapsed **"Holistic staging spike (#190) — internal testing only"** panel at the bottom of the editor: set its Mask strategy select to `Wall band` and the wording select to `a2`.

### Run matrix

| # | Path | Mask | Prompt | Isolates |
| --- | --- | --- | --- | --- |
| 1 | One-click **Restage furnishings** preset | furnishings-union (detected + dilated) | a2 (hardened) + project aesthetic | The shipped combo. |
| 2 | #190 spike panel | `wall-band` | a2 (hardened) — same directives | **Mask knob**: geometric band vs detection union, same words. |
| 3 | One-click preset (edit project's staging aesthetic to a 2nd style first) | furnishings-union | a2 + other aesthetic | Aesthetic/prompt robustness across briefs. |
| 4 (opt) | One-click preset on a different room photo (e.g. porters-mill bedroom/kitchen) | furnishings-union | a2 | Generalization beyond one room type. |
| 5 (opt) | Repeat the best performer once | — | — | Consistency check (detection is deterministic per photo; FLUX is not). |

### Record after each run, per row

- **"Same room?" verdict** (yes / drifted / no): check wall finish & color, flooring material, window mullions & casings, trim, doors, ceiling line, baseboards, room geometry — side-by-side against the before.
- **Furnishings verdict**: which objects replaced / added / removed; clutter cleared; anything visibly NOT restaged that should have been (likely a detection miss — e.g. wall art, plants).
- **TV verdict** (if present): removed cleanly, bezel/stand/cord residue, wall behind clean.
- **Artifacts**: ghost rims around replaced objects, floating furniture, shadow direction, mask seams.
- The after URL + the variant slot it landed in.

## Decision + flip points

Post the verdict table as a comment on issue #223 with the side-by-side sheet attached (**go/no-go**), same as #190. Failure-mode → single flip point:

| Failure observed | Turn this knob (one constant each) |
| --- | --- |
| Detection misses decor (artwork/plants/TV un-restaged) | `FURNISHING_DETECTION_PROMPT` in `furnishing-detection.ts` (e.g. a second concept call — remember: bare single concepts, no comma lists). |
| Ghost rims / cut-off shadows at object edges | Dilation radius in `stage-entire-room-preset.tsx` (currently `DEFAULT_MASK_EXPANSION_RADIUS`, 15px). |
| Fill hallucinates architecture inside masked holes | `HOLISTIC_NEGATIVE_PROMPT` / a2 wording in `holistic-prompt.ts`. |
| Run 1 drifts architecture where run 2 doesn't | That's a mask regression — the union is leaking; capture the posted mask (browser devtools → POST /api/inpaint body) and attach it to the issue. |

Any constant flips land as a small follow-up PR with the verdict comment linked.

## Out of scope here

Code changes during the operator run (record, don't patch, mid-spike), Problem 2 verification (covered by #224's tests), e2e/mocked behavior (already pinned in `tests/e2e/specs/mask-paint.spec.ts`).
