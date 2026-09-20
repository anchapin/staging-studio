# SAM Latency Measurement Protocol

**Refs #220** — Post-demo measurement task

---

## What #202 instrumentation provides

Three distinct timing events are available for measuring SAM first-click latency:

### 1. `segment_prewarm_timing` — client console event

**Emitted by:** `use-segment-prewarm.ts` (line 140–146)

**What it measures:** The editor-open pre-warm fetch — the `furniture` catch-all
concept detection that fires automatically when the mask editor's image has loaded.

```
[segment-timing] {"event":"segment_prewarm_timing","ms":1842,"ok":true,"imageUrl":"..."}
```

| Field | Meaning |
|-------|---------|
| `ms` | Pre-warm request duration, click → response |
| `ok` | Whether fal returned a valid result |
| `imageUrl` | Which source image was being warmed |

**Significance:** This is the warm-up cost. It runs once per (image, concept) pair per
editor session and cannot be cached server-side — `fal-ai/sam-3-1/image` re-encodes
the image inside each billed call, so nothing about the warm is reusable across users.

---

### 2. `segment_server_timing` — server log event

**Emitted by:** `/api/segment/route.ts` (lines 132–139 warm path, lines 164–171 cold path)

**What it measures:** Route-level latency split between our overhead and the provider.

```
{"event":"segment_server_timing","totalMs":2104,"falMs":1847,"warm":false,"roomId":"..."}
{"event":"segment_server_timing","totalMs":143,"falMs":null,"warm":true,"roomId":"..."}
```

| Field | Meaning |
|-------|---------|
| `totalMs` | Handler start → response, all inclusive |
| `falMs` | Duration of `fal.subscribe` call (null on warm ping — zero provider cost) |
| `warm` | `true` = pre-warm ping (no fal call made), `false` = real cold click |

**Significance:** `totalMs − falMs` = our per-request overhead (auth, room lookup,
Fal API handshake). `falMs` is the irreducible provider latency. A warm ping's
`falMs: null` confirms zero fal cost.

> **Note for `/api/segment/furnishings`:** That route does **not** emit
> `segment_server_timing` — it emits `segment_concept_timing` instead (route.ts line 196–204).
> The structure differs: `{ event, source, concept, instanceCount, ms }`. Use
> `source: "network"` vs absence of a cache event to distinguish cold vs warm.

---

### 3. `segment_timing` — client console event (gap)

**Defined in:** `src/lib/segment-timing.ts` (line 31)

**Current status:** The event type and `buildSegmentTimingEvent` are defined but the
event is **not currently emitted by any client code**. The click-to-result path
was refactored during #228's concept-detection migration, and the client-side
click timer was not wired up.

**To close the gap**, add to the concept click handler in `inpaint-editor.tsx`
(around `handleInstanceToggle`, line 800):

```typescript
// Around line 859, after the toggle is applied:
const clickedAt = performance.now();
// ... existing toggle logic ...
// When result arrives (cache hit is synchronous; network uses conceptSegments):
// emitSegmentTiming(buildSegmentTimingEvent({ ms: performance.now() - clickedAt, source: 'cache'|'network', prewarmed: conceptSegments.status === 'warm', imageUrl }))
```

The `prewarmed` field should reflect whether `conceptSegments.status === 'warm'`
at click time (i.e., whether the auto-fire pre-warm had resolved before the click).

---

## How to measure cold vs warm first-click latency

### Prerequisites

- Live operator session with a real FAL_KEY
- `npm run dev` against a real Supabase project (or the e2e Docker stack with a
  mocked fal client that records timing)
- Browser DevTools console open (filter to `[segment-timing]`)
- Server log tail running (`npm run dev` output or Vercel log drain)

### Step 1: Cold first click

1. Open a project room and navigate to the mask editor.
2. **Before the pre-warm completes**, click on a detected instance.
   - The `segment_prewarm_timing` event will not yet have appeared.
   - If the click fires before the pre-warm response, the `handleInstanceToggle`
     will see `conceptSegments.status === 'warming'` (not yet `'warm'`).
3. Record:
   - `segment_prewarm_timing ms` (when it fires) — this is the pre-warm baseline
   - First click round-trip (once the gap is closed: `segment_timing ms`)
   - Server `totalMs` and `falMs` from `segment_server_timing`

### Step 2: Warm first click (pre-warm already done)

1. Refresh the editor or open a new room.
2. **Wait for** `[segment-timing] {"event":"segment_prewarm_timing" ...}` in the console.
3. Then click on an instance.
4. Record:
   - `segment_timing prewarmed: true` (once gap is closed)
   - Server `segment_server_timing warm: false` (not a warm ping — a real click)
   - `totalMs` and `falMs`

### Step 3: Cache hit (LRU segment cache)

1. After any warm click, **switch to a different concept chip** (e.g., "sofa" → "lighting").
2. Click on an instance — this is a cache miss (network call), no different from cold.
3. **Switch back** to the original chip — the `SegmentCache` (`src/lib/segment-cache.ts`)
   serves the result synchronously with zero network.
4. Record: instant response (~0ms), `source: "cache"` in `segment_timing`.

### Step 4: Pre-warmed route (warm ping without click)

1. Open the editor and let the pre-warm complete.
2. Look for `segment_server_timing warm: true` in the server log.
3. This confirms the pre-warm ping went through the full auth + room-lookup chain
   but returned `falMs: null` (no fal call, zero provider cost).

---

## Expected numbers (ballpark — requires live measurement)

| Path | `segment_server_timing totalMs` | `falMs` | Notes |
|------|-------------------------------|---------|-------|
| Cold click (no pre-warm) | ~2,000–3,500 ms | ~1,800–3,000 ms | Full round-trip, image re-encode on fal |
| Warm click (pre-warm done) | ~1,800–3,000 ms | ~1,800–3,000 ms | Same fal call; pre-warm doesn't eliminate provider latency |
| Warm ping (pre-warm only) | ~100–250 ms | `null` | No fal call; just auth + room check |
| Cache hit (SegmentCache) | ~0 ms | N/A | Synchronous; zero network, zero fal |

> **Key observation:** `falMs` is identical for cold and warm clicks — the pre-warm
> does **not** reduce provider-side latency. The pre-warm only eliminates the
> *first-click round-trip delay* for the user. Subsequent clicks either hit the
> cache (instant) or pay full provider latency.

---

## Does the pre-warm surface stay?

**Yes — recommend keeping it.** Reasoning:

1. **Perceived first-click improvement:** Even though `falMs` is unchanged, a warm
   click that follows a completed pre-warm avoids the queue time of the pre-warm
   itself. If the user clicks immediately on editor open, they avoid the full
   pre-warm round-trip (~1–3 s) and only pay the fal call.

2. **Irreducible fal latency:** `fal-ai/sam-3-1/image` re-encodes the image inside
   every billed call. There is no embedding input/output exposed that would allow
   pre-computing and caching the encode server-side. This is a Fal infrastructure
   constraint, not a StagingStudio gap.

3. **Pre-warm cost is zero:** The warm ping makes a fal call with `warm: true`
   and exits before any provider work. `falMs: null` confirms this.

4. **Cache covers repeat visits:** The `SegmentCache` (LRU, 8 entries, 8 MiB) means
   concept re-selections within a session are free. Cross-session, the pre-warm
   amortises the first-click cost.

5. **Alternative worth revisiting:** If Fal exposes an embedding endpoint for SAM,
   the pre-warm could be replaced by a server-side embedding cache keyed on
   `(imageUrl, concept)`. Track as a future Fal improvement.

---

## Instrumentation gap summary

| Event | Status | File |
|--------|--------|------|
| `segment_prewarm_timing` | ✅ Emitted | `use-segment-prewarm.ts:140` |
| `segment_server_timing` (SAM click) | ✅ Emitted | `route.ts:132,164` |
| `segment_concept_timing` (furnishings) | ✅ Emitted | `furnishings/route.ts:196` |
| `segment_timing` (client click timing) | ❌ Not wired | `inpaint-editor.tsx` (gap) |

The missing `segment_timing` client emission should be closed to get end-to-end
click-to-result numbers. The server-side split (`totalMs` vs `falMs`) is already
complete and sufficient for the cold vs warm verdict.
