# Spike 278 — CLIP labeling latency measurement on firm hardware (< 3s acceptance criterion)

Issue: [#278](https://github.com/anchapin/staging-studio/issues/278). Acceptance criterion from #237: **all instances labeled < ~3s on the firm's machines** (documented measurement).

This is a **hands-on operator run** — it cannot be measured from this desk. The stager must execute the protocol below and report back the numbers.

---

## Background

The #237 spike (commit `caa496f`, now in `develop`) proved transformers.js CLIP runs in-browser:
- Per-instance: ~80–200ms (WebGPU) / ~300–800ms (WASM) on developer hardware
- 10-instance batch: ~400ms (WebGPU) / ~1.2s (WASM)
- Both well under the 3s acceptance criterion in isolation

The acceptance criterion requires measurement on the **firm's actual hardware** under **realistic conditions** (production build, representative room photo, all instances).

---

## What to measure

The time from when **CLIP labels first appear in the batch panel** to when **all instances are labeled** — i.e., the end-to-end CLIP classification latency for the full instance batch in a representative room photo.

---

## Operator run protocol

### Prerequisites

1. Deploy `develop` branch (or `feat/issue-277-clip-production` once PR #279 is merged) to a publicly reachable URL the stager uses
2. The stager opens a **representative room photo** in the editor
3. The stager has a room with a realistic number of detected instances (not an empty room)

### Steps

1. **Open browser DevTools → Network tab** (or Performance tab)
2. **Select the `furniture` concept** to trigger detection and populate the batch panel
3. **Open the Batch staging panel** (if not already visible)
4. **Note the time** when the batch panel first renders instances with the concept string as label (e.g., "furniture")
5. **Note the time** when all CLIP labels have replaced the concept strings in the batch panel rows
6. **The difference** = total CLIP labeling latency

Alternatively, use the browser console to filter for `[concept-tool]` events — each instance toggle logs when a label arrives.

### Measure both paths

**WebGPU path** (fast): Most modern laptops with a GPU will use WebGPU. The browser console will show `backend: webgpu` in any CLIP result logs (if surfaced).

**WASM fallback** (slow): To force WASM, the stager can disable WebGPU in `chrome://flags/#enable-unsafe-webgpu` or test on a browser/machine known not to support WebGPU.

### Record per run

| Field | What to record |
|---|---|
| Machine | OS + browser + version |
| Instance count | Number of detected instances in the photo |
| WebGPU or WASM | Which backend was used |
| First label appears | Approximate time (ms or s) |
| All labels complete | Approximate time (ms or s) |
| Total latency | All labels complete − first appears |
| Under 3s? | Yes / No |

---

## Decision rule

If **all instances labeled < 3s on firm hardware** → acceptance criterion **PASSED**.

If > 3s → the CLIP integration may need optimization (e.g., q4 quantization, smaller model, or per-chunk batching) before shipping to production.

---

## Report back

Reply in issue #278 with:
1. The table above for your machine
2. The browser console output or DevTools screenshot showing the timing
3. Any errors or degradation observed (WASM fallback behavior, silent failures, etc.)
