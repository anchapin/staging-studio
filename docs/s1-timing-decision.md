# S1 timing decision — rule, gate, and how to produce the numbers

Issue: anchapin/staging-studio#1494 — *offline S1 timing-log parser + decision doc*.

**Scope of this document.** It records the 2026-11-02 decision rule verbatim, the
release + traffic gate that must be satisfied before the rule can even be
evaluated, and the exact command that turns raw runtime-log lines into the
numbers the rule needs. It does **not** decide anything: no S1 conversion
happens here, no instrumentation is added or removed here, and no threshold
other than the ones quoted below is introduced.

---

## 1. The decision rule (2026-11-02, verbatim)

> convert S1 only if real measurement shows median per-call latency >=25ms over
> >=100 real confirm batches plus a burst check; remove instrumentation in the
> same change that decides; <10ms → do not convert. Timing is on develop only,
> NOT deployed to production.

Nothing else is a threshold. In particular there is no p95 threshold, no
oversize-rate threshold and no burst budget in the rule itself — anything of
that kind in this document is flagged as a **proposal for Alex to confirm**
(§5) and must not be treated as decided.

### 1.1 What the rule maps to in parser output

| Rule element | Parser output field |
| --- | --- |
| "median per-call latency" | `per_call_median_ms` (median over all flattened `durations_ms`) |
| ">=100 real confirm batches" | `batches` (usable batches, i.e. records carrying at least one per-call duration) |
| "plus a burst check" | `batch_size_stats`, `batches_size_ge_20`, `total_p95_ms`, `total_max_ms` (see §5) |
| "<10ms → do not convert" | verdict `DO-NOT-CONVERT (median <10ms)` |

The parser prints exactly one verdict line, one of:

- `INSUFFICIENT (<100 batches)` — fewer than 100 usable batches; the rule
  cannot be evaluated yet. **This is the expected verdict for any small run.**
- `CONVERT-CANDIDATE (median >=25ms + burst check needed)` — the numeric half
  of the rule is satisfied; the burst check is still outstanding.
- `DO-NOT-CONVERT (median <10ms)` — the rule says do not convert.
- `IN-BETWEEN (10–25ms — Alex decision, default do not convert)` — the rule
  does not cover this band; Alex decides, default is do not convert.

---

## 2. Release + traffic gate

Before any number in §1 may be used:

1. **Release gate.** The measurement must come from a build that is on
   `develop` and released through the normal `develop → main` release flow.
   The timing instrumentation is **develop-only and is NOT deployed to
   production**; no production traffic may be used, and no production log
   surface may be queried for this.
2. **Traffic gate.** The measurement must cover **at least 100 real confirm
   batches** — real users' confirm uploads, not load tests, not synthetic
   fixtures, not a replay. Fewer than 100 usable batches is `INSUFFICIENT`
   and the decision is deferred, whatever the median says.
3. **Same-change rule.** When the decision is made, the instrumentation is
   removed **in the same change that decides** (i.e. the change that converts
   S1 removes the `s1_size_check_timing` logging, and the change that decides
   "do not convert" removes it too). The instrumentation is not left in place
   as permanent logging, and the storage-size loop stays sequential until the
   decision is made.

The instrumentation being measured lives in `src/app/actions/room-batch.ts`
(`s1_size_check_timing`, one `console.info` JSON line per batch). **Do not
change that emitter as part of this issue** — this issue only builds the
parser and this document.

---

## 3. Producing the numbers

The parser is `scripts/s1-timing-parser.ts` (repo convention for one-shot CLI
scripts: `#!/usr/bin/env tsx` shebang + `npx tsx scripts/<file>`; `scripts/`
already holds both `.mts` and `.ts` CLI scripts — this one is `.ts`, like
`scripts/export-usage.ts`, so that the repo's own `tsc --noEmit` run and the
tautology sanity guard in `tests/test-sanity.test.ts` can see it).

```bash
# from the repo root
npx tsx scripts/s1-timing-parser.ts path/to/real-runtime.log
cat path/to/real-runtime.log | npx tsx scripts/s1-timing-parser.ts --stdin
```

The script is entirely offline: it reads a local file or stdin and writes a
summary to stdout. It has no network access, no credentials, no log-vendor
SDK, and it does not assume any particular log envelope — a line may be a
bare `console.info` JSON payload, a timestamped prefix plus payload, or a
wrapper object that carries the console line as a JSON-encoded string. All
three shapes are accepted.

### 3.1 Output fields

```
s1_size_check_timing summary
lines_scanned: 11          # lines read from the input
event_lines: 9             # lines that carried the s1_size_check_timing marker
ignored_lines: 2           # lines that were not event lines (other events, blanks)
malformed_lines_skipped: 2 # event lines that could not be parsed -> skipped, never fatal
batches: 6                 # n: usable batches (records with >=1 per-call duration)
records_without_samples: 1 # parsed records with an empty durations_ms array
per_call_samples: 14
per_call_median_ms: 10.000
per_call_p95_ms: 30.000
per_call_max_ms: 30.000
total_median_ms: 40.000    # median of the per-batch total_ms
total_p95_ms: 40.000
total_max_ms: 40.000
batch_size_histogram:      # batch-size distribution
  1: 1
  2: 3
  ...
batch_size_stats:          # per batch size: count, median total, max total
  size=2: count=3 median_total_ms=40.000 max_total_ms=40.000
batches_size_ge_20: 0     # batches at or above the burst-check batch size (20)
oversized_count: 1         # batches that hit the oversized path (oversizedIndex != null)
oversized_rate: 0.1667
verdict: INSUFFICIENT (<100 batches)
```

Definitions used by the parser (so that two runs are comparable):

- **median** — average of the two middle values for an even count, the middle
  value for an odd count.
- **p95** — nearest rank: the value at index `ceil(0.95 * n) - 1` of the
  ascending list.
- **per-call latency** — the `durations_ms` entries the emitter recorded for
  the sequential `storage.list()` calls in the size-check loop; they are
  flattened across batches before the median/p95 are taken.
- **oversized** — a batch where the emitter recorded a non-null
  `oversizedIndex`, i.e. an object over `MAX_ROOM_PHOTO_BYTES` was found (the
  batch is then rejected). `oversized_rate` is `oversized_count / batches`.
- **malformed** — an event line whose payload could not be parsed into a
  record (broken JSON, `durations_ms` not an array of numbers, ...). Such
  lines are **skipped and counted**; they never crash the run.

### 3.2 Synthetic fixtures

`tests/fixtures/s1-timing/` holds synthetic fixtures (success lines, an
oversized line, an empty `durations_ms` line, malformed payloads, a
JSON-encoded envelope, prefixed lines) together with the expected parser
output for each, and `tests/s1-timing-parser.test.ts` diffs the script's
stdout against the committed expected output.

> **The fixtures are synthetic. They prove that the parser is correct and
> that the arithmetic is reproducible. They prove nothing whatsoever about
> real latency.** No number in this document, and no number produced by
> running the parser against a fixture, may be used to decide whether S1
> converts. The decision may only be based on real measurement, obtained
> after the release + traffic gate in §2.

---

## 4. At decision time (the mechanical step this issue enables)

1. Collect the real `s1_size_check_timing` lines from the develop-only
   runtime log surface, for **>= 100 real confirm batches**.
2. Run the parser over them:
   `npx tsx scripts/s1-timing-parser.ts <log>`
3. Read the verdict line:
   - `INSUFFICIENT (<100 batches)` → collect more real batches; do not decide.
   - `DO-NOT-CONVERT (median <10ms)` → do not convert S1.
   - `IN-BETWEEN (10–25ms — Alex decision, default do not convert)` → Alex
     decides; default is do not convert.
   - `CONVERT-CANDIDATE (median >=25ms + burst check needed)` → run the burst
     check (§5); if it also passes, convert S1 (parallelize the size-check
     loop) **and remove the instrumentation in the same change**.
4. Whatever the outcome, the change that decides removes the
   `s1_size_check_timing` instrumentation from
   `src/app/actions/room-batch.ts` (and its explanatory comment).

---

## 5. Burst check (proposal — thresholds NOT part of the 2026-11-02 rule)

The rule requires "plus a burst check" but does not define it. The following
is a **proposal for Alex to confirm before it is used**; it is not a decided
threshold and it must not be applied silently:

> **Proposed burst check.** Take the batches at the largest batch size seen in
> real traffic (the parser reports `batches_size_ge_20` and the per-size
> `batch_size_stats`, so a 20-item batch is directly observable). A
> 20-item batch at the observed median per-call latency costs roughly
> `20 × per_call_median_ms` of sequential wall-clock time inside one request.
> The proposal is that the burst check passes when
> `total_p95_ms` for the largest observed batch size stays under **1000 ms**
> (i.e. ~50 ms per item at a 20-item batch) and the worst observed batch
> (`total_max_ms`) stays under **2000 ms**.

Alex owns both numbers (1000 ms / 2000 ms) and the choice of the batch size
used for the check (20 is a proposal drawn from the "20-item batch" case, not
from the rule). If Alex picks different numbers, only this section and the
proposal constants change — the parser itself only reports measurements and
never applies a burst threshold.

---

## 6. Out of scope for this issue

- fetching real logs, or any Vercel/Sentry/log-vendor integration or SDK;
- the S1 conversion itself, S2 instrumentation, dashboards;
- any change to the emitter in `src/app/actions/room-batch.ts`;
- any threshold beyond the 2026-11-02 decision rule.
