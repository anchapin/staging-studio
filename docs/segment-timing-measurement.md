# SAM Latency Measurement Protocol

**Ref:** #220 — Post-demo cold vs warm first-click measurement

---

## What #202 instrumentation provides

Three timing events exist in the codebase for measuring SAM first-click latency.

### 1. `segment_prewarm_timing` — client console event ✅

**Emitted by:** `src/components/canvas/use-segment-prewarm.ts` lines 146–152 (ok) and 168–174 (failure)

**What it measures:** The editor-open (or concept-chip-switch) auto-fire — the `furniture` catch-all concept detection that runs automatically when the mask editor's image has loaded.

```
[segment-timing] {"event":"segment_prewarm_timing","ms":1842,"ok":true,"imageUrl":"..."}
```

| Field | Meaning |
|-------|---------|
| `ms` | Pre-warm request duration, click → response |
| `ok` | Whether the detection returned a valid result |
| `imageUrl` | Which source image was being warmed |

**Significance:** This is the warm-up cost. It runs once per (image, concept) pair per editor session. The fal-ai/sam-3-1/image re-encodes the image inside every billed call, so nothing about the warm is reusable across users.

---

### 2. `segment_concept_timing` — server log event ✅

**Emitted by:** `src/app/api/segment/furnishings/route.ts` lines 196–204

**What it measures:** Route-level latency for the furnishings detection call.

```
{"event":"segment_concept_timing","source":"network","concept":"furniture","instanceCount":4,"ms":2104}
```

| Field | Meaning |
|-------|---------|
| `source` | `"network"` = real call; absence of a cache event = cache hit |
| `concept` | The concept searched |
| `instanceCount` | Number of instances detected |
| `ms` | Wall-clock time from handler entry to response |

> **Note:** There is no `segment_server_timing` event. The furnishings route
> emits `segment_concept_timing` instead. Do not look for `segment_server_timing`
> in the codebase — it was planned but never implemented.

---

### 3. `segment_timing` — client console event ❌ (gap)

**Defined in:** `src/lib/segment-timing.ts` line 31

The event type and `buildSegmentTimingEvent` builder are defined but **no client code currently emits this event**. The click-to-result path was refactored during the concept-detection migration and the client-side click timer was not wired up.

**To close the gap**, add to the concept click handler in `src/components/canvas/inpaint-editor.tsx` around `handleInstanceToggle`:

```typescript
// After toggle is applied:
const clickedAt = performance.now();
// ... existing toggle logic ...
// When result arrives (cache hit = synchronous; network = conceptSegments):
// emitSegmentTiming(buildSegmentTimingEvent({
//   ms: performance.now() - clickedAt,
//   source: 'cache' | 'network',
//   prewarmed: conceptSegments.status === 'warm',
//   imageUrl
// }))
```

---

## How to measure cold vs warm first-click latency

### Prerequisites

- Live operator session with a real `FAL_KEY`
- `npm run dev` against a real Supabase project
- Browser DevTools console open (filter to `[segment-timing]`)
- Server log tail running (`npm run dev` output or Vercel log drain)

### Step 1: Cold first click

1. Open a project room and navigate to the mask editor.
2. **Before the pre-warm completes**, click on a detected instance.
   - The `segment_prewarm_timing` event will not yet have appeared.
   - If the click fires before the pre-warm response, `conceptSegments.status` will be `'warming'` (not yet `'warm'`).
3. Record:
   - `segment_prewarm_timing ms` (when it fires) — pre-warm baseline
   - `segment_concept_timing ms` — first click round-trip
   - `segment_concept_timing instanceCount`

### Step 2: Warm first click (pre-warm already done)

1. Refresh the editor or open a new room.
2. **Wait for** `[segment-timing] {"event":"segment_prewarm_timing" ...}` in the console.
3. Then click on an instance.
4. Record:
   - `segment_timing prewarmed: true` (once gap is closed — currently unavailable)
   - `segment_concept_timing ms` for the click
   - `segment_concept_timing instanceCount`

### Step 3: Cache hit (LRU segment cache)

1. After any warm click, **switch to a different concept chip** (e.g., "sofa" → "lighting").
2. Click on an instance — this is a cache miss (network call), no different from cold.
3. **Switch back** to the original chip — the `SegmentCache` (`src/lib/segment-cache.ts`) serves the result synchronously with zero network.
4. Record: `segment_concept_timing` is **absent** on cache hit (no server call is made). The `source: "network"` field will only appear on cache misses.

### Step 4: Pre-warmed route (warm ping without click)

1. Open the editor and let the pre-warm complete.
2. Look for `segment_prewarm_timing ok: true` in the console.
3. This confirms the pre-warm fetch went through auth + room-lookup + fal call and returned the concept instances.

---

## Expected numbers (ballpark — requires live measurement)

| Path | `segment_concept_timing ms` | Notes |
|------|-----------------------------|-------|
| Cold click (no pre-warm) | ~2,000–3,500 ms | Full round-trip, image re-encode on fal |
| Warm click (pre-warm done) | ~1,800–3,000 ms | Same fal call; pre-warm doesn't eliminate provider latency |
| Pre-warm ping | ~1,500–3,000 ms | Same fal call, same cost; pre-warm is the call itself |
| Cache hit (SegmentCache) | ~0 ms server | Synchronous in-process; no `segment_concept_timing` emitted |

> **Key observation:** The fal-ai/sam-3-1/image re-encodes the image inside every
> billed call. The pre-warm does **not** reduce provider-side latency. Its value
> is ensuring instances are already on screen when the user reaches for a tool.

---

## Does the pre-warm surface stay?

**Yes — recommend keeping it.** Reasoning:

1. **Perceived first-click improvement:** When pre-warm completes before the user clicks, they get immediate on-screen instances. Without pre-warm, they wait for the detection call on first click.

2. **Irreducible fal latency:** fal-ai/sam-3-1/image re-encodes the image inside every billed call. There is no embedding input/output exposed that would allow pre-computing server-side. This is a Fal infrastructure constraint.

3. **Cache covers repeat visits:** The `SegmentCache` (LRU, 8 entries, 8 MiB) means concept re-selections within a session are free (zero network). Cross-session, the pre-warm amortises the first-click cost.

4. **Alternative worth revisiting:** If Fal exposes an embedding endpoint for SAM, a server-side embedding cache keyed on `(imageUrl, concept)` could replace the current pre-warm with a zero-cost ping. Track as a future Fal improvement.

---

## Instrumentation gap summary

| Event | Status | File |
|-------|--------|------|
| `segment_prewarm_timing` | ✅ Emitted | `use-segment-prewarm.ts:146,168` |
| `segment_concept_timing` | ✅ Emitted | `furnishings/route.ts:196` |
| `segment_timing` (client click) | ❌ Not wired | `inpaint-editor.tsx` (gap) |
| `segment_server_timing` | ❌ Does not exist | Planned but never implemented |

The missing `segment_timing` client emission should be closed to get end-to-end click-to-result numbers from the browser side. The server-side `segment_concept_timing` already provides the cold vs warm verdict.
