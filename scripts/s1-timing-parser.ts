#!/usr/bin/env tsx
/**
 * s1-timing-parser.ts (issue #1494)
 *
 * Offline parser for the temporary S1 measurement event that
 * src/app/actions/room-batch.ts emits:
 *
 *   console.info(JSON.stringify({
 *     event: "s1_size_check_timing",
 *     batchSize, checkedCount, durations_ms, total_ms, oversizedIndex,
 *   }))
 *
 * Why this exists: there is no consumer for `s1_size_check_timing` and no
 * documented query path, so at decision time somebody would have to turn raw
 * runtime-log lines into numbers by hand. This script makes that step
 * mechanical (and repeatable) — but ONLY once real logs exist.
 *
 * IMPORTANT (read before using any output of this script):
 *  - The fixtures under tests/fixtures/s1-timing/ are SYNTHETIC. They prove
 *    the parser works; they prove NOTHING about real latency.
 *  - This script never talks to a network service. It only reads a local
 *    file (or stdin).
 *  - The log envelope is NOT assumed. Runtime log surfaces wrap console
 *    lines in different envelopes (or none at all); the parser scans a line
 *    for a JSON object, tolerating arbitrary prefixes, nested objects and
 *    JSON-encoded strings, and never hard-codes one envelope format.
 *
 * Placement note (issue #1494): scripts/ already mixes `.mts` and `.ts`
 * one-shot CLI scripts (bake-off-*.mts, cleanup-orphaned-inpaint-rows.mts,
 * export-usage.ts, export-selection-log.ts), all with the same
 * `#!/usr/bin/env tsx` shebang and the same `npx tsx scripts/<file>` runner.
 * This one is a `.ts` file (like export-usage.ts) so that the parser module
 * can be imported and type-checked by the repo's own test + tsc pipeline.
 *
 * Usage (repo convention for scripts/ is `npx tsx`):
 *
 *     npx tsx scripts/s1-timing-parser.ts path/to/runtime.log
 *     cat runtime.log | npx tsx scripts/s1-timing-parser.ts
 *     npx tsx scripts/s1-timing-parser.ts --stdin   # explicit stdin
 *
 * The verdict thresholds below come from the 2026-11-02 decision rule and
 * nothing else:
 *   - convert S1 only if median per-call latency >= 25ms over >= 100 real
 *     confirm batches, plus a burst check;
 *   - < 10ms -> do not convert;
 *   - 10ms <= median < 25ms -> Alex decides, default is do not convert.
 * See docs/s1-timing-decision.md for the rule verbatim and the gate.
 */

import { readFileSync } from "node:fs";

export const EVENT_NAME = "s1_size_check_timing";

/** Decision-rule constants (2026-11-02). Do not invent new ones here. */
export const MIN_BATCHES = 100;
export const CONVERT_MEDIAN_MS = 25;
export const DO_NOT_CONVERT_MEDIAN_MS = 10;

/** Batch size used by the proposed burst check (see docs/s1-timing-decision.md). */
export const BURST_BATCH_SIZE = 20;

export interface S1TimingRecord {
  batchSize: number;
  durationsMs: number[];
  totalMs: number;
  oversizedIndex: number | null;
}

export interface ParseStats {
  linesScanned: number;
  eventLines: number;
  ignoredLines: number;
  malformedLines: number;
  /** Usable batches (records that carry at least one per-call duration). */
  batches: number;
  /** Parsed records that carry no per-call duration (e.g. an empty batch). */
  recordsWithoutSamples: number;
  perCall: number[];
  totals: number[];
  batchSizes: number[];
  oversizedCount: number;
}

// Matches the marker both in a raw JSON line and in an escaped JSON string
// (an envelope may carry the console line as an escaped string), e.g.
//   {"event":"s1_size_check_timing", ...}
//   {\"event\":\"s1_size_check_timing\", ...}
const MARKER_RE = /\\?"event\\?"\s*:\s*\\?"s1_size_check_timing\\?"/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Return the JSON object substring that starts at `start`, honouring string
 * literals and escapes, or null when the object is never closed.
 */
function balancedSlice(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

/**
 * Coerce one raw event object into a record, or null when the payload is
 * malformed (missing/invalid durations, non-numeric total, ...).
 */
export function toRecord(raw: Record<string, unknown>): S1TimingRecord | null {
  const rawDurations = raw.durations_ms;
  if (!Array.isArray(rawDurations)) {
    return null;
  }
  const durationsMs: number[] = [];
  for (const value of rawDurations) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return null;
    }
    durationsMs.push(value);
  }

  let totalMs: number;
  if (raw.total_ms === undefined || raw.total_ms === null) {
    totalMs = durationsMs.reduce((sum, ms) => sum + ms, 0);
  } else if (typeof raw.total_ms === "number" && Number.isFinite(raw.total_ms)) {
    totalMs = raw.total_ms;
  } else {
    return null;
  }

  let oversizedIndex: number | null = null;
  if (raw.oversizedIndex !== undefined && raw.oversizedIndex !== null) {
    if (
      typeof raw.oversizedIndex !== "number" ||
      !Number.isFinite(raw.oversizedIndex)
    ) {
      return null;
    }
    oversizedIndex = raw.oversizedIndex;
  }

  let batchSize = durationsMs.length;
  if (raw.batchSize !== undefined && raw.batchSize !== null) {
    if (typeof raw.batchSize !== "number" || !Number.isFinite(raw.batchSize)) {
      return null;
    }
    batchSize = raw.batchSize;
  }

  return { batchSize, durationsMs, totalMs, oversizedIndex };
}

/**
 * Walk a parsed JSON value looking for the event, descending into nested
 * objects, arrays and JSON-encoded strings (an envelope may carry the
 * console line as an escaped string).
 */
function walk(
  value: unknown,
  depth: number,
  found: S1TimingRecord[],
  seen: Set<string>
): void {
  if (depth > 8) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      walk(item, depth + 1, found, seen);
    }
    return;
  }
  if (!isPlainObject(value)) {
    return;
  }
  if (value.event === EVENT_NAME) {
    const record = toRecord(value);
    if (record) {
      const key = JSON.stringify(record);
      if (!seen.has(key)) {
        seen.add(key);
        found.push(record);
      }
    }
    return;
  }
  for (const nested of Object.values(value)) {
    if (typeof nested === "string") {
      const trimmed = nested.trim();
      if (trimmed.startsWith("{")) {
        try {
          walk(JSON.parse(trimmed), depth + 1, found, seen);
        } catch {
          // Not JSON — ignore, the line may still hold the event elsewhere.
        }
      }
      continue;
    }
    walk(nested, depth + 1, found, seen);
  }
}

/**
 * Extract every event record from one raw log line. Tolerant of arbitrary
 * prefixes and of any envelope shape.
 */
export function extractRecords(line: string): S1TimingRecord[] {
  const found: S1TimingRecord[] = [];
  const seen = new Set<string>();
  let cursor = 0;
  while (cursor < line.length) {
    const start = line.indexOf("{", cursor);
    if (start === -1) {
      break;
    }
    const slice = balancedSlice(line, start);
    if (slice === null) {
      cursor = start + 1;
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(slice);
    } catch {
      // Broken JSON here — keep scanning, an inner object may still parse.
      cursor = start + 1;
      continue;
    }
    walk(parsed, 0, found, seen);
    cursor = start + slice.length;
  }
  return found;
}

/** Parse a whole log text into aggregated statistics. Never throws. */
export function parseLogText(text: string): ParseStats {
  const stats: ParseStats = {
    linesScanned: 0,
    eventLines: 0,
    ignoredLines: 0,
    malformedLines: 0,
    batches: 0,
    recordsWithoutSamples: 0,
    perCall: [],
    totals: [],
    batchSizes: [],
    oversizedCount: 0,
  };

  const rawLines = text.split(/\r?\n/);
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") {
    rawLines.pop();
  }

  for (const line of rawLines) {
    stats.linesScanned++;
    if (!MARKER_RE.test(line)) {
      stats.ignoredLines++;
      continue;
    }
    stats.eventLines++;
    const records = extractRecords(line);
    if (records.length === 0) {
      stats.malformedLines++;
      continue;
    }
    for (const record of records) {
      if (record.durationsMs.length === 0) {
        stats.recordsWithoutSamples++;
        continue;
      }
      stats.batches++;
      stats.perCall.push(...record.durationsMs);
      stats.totals.push(record.totalMs);
      stats.batchSizes.push(record.batchSize);
      if (record.oversizedIndex !== null) {
        stats.oversizedCount++;
      }
    }
  }

  return stats;
}

/** Median of a numeric list (average of the two middles), or null if empty. */
export function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Nearest-rank percentile: sorted[ceil(p * n) - 1], or null if empty. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(p * sorted.length);
  const index = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
  return sorted[index];
}

export function maxOf(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((acc, value) => (value > acc ? value : acc), values[0]);
}

/**
 * The verdict line. Thresholds are exactly the 2026-11-02 decision rule.
 */
export function verdictFor(
  batches: number,
  perCallMedianMs: number | null
): string {
  if (batches < MIN_BATCHES || perCallMedianMs === null) {
    return "INSUFFICIENT (<100 batches)";
  }
  if (perCallMedianMs >= CONVERT_MEDIAN_MS) {
    return "CONVERT-CANDIDATE (median >=25ms + burst check needed)";
  }
  if (perCallMedianMs < DO_NOT_CONVERT_MEDIAN_MS) {
    return "DO-NOT-CONVERT (median <10ms)";
  }
  return "IN-BETWEEN (10–25ms — Alex decision, default do not convert)";
}

function formatMs(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(3);
}

function formatRate(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(4);
}

/** Render the human/machine readable report. */
export function formatSummary(stats: ParseStats): string {
  const perCallMedian = median(stats.perCall);
  const perCallP95 = percentile(stats.perCall, 0.95);
  const perCallMax = maxOf(stats.perCall);
  const totalMedian = median(stats.totals);
  const totalP95 = percentile(stats.totals, 0.95);
  const totalMax = maxOf(stats.totals);
  const oversizedRate =
    stats.batches === 0 ? null : stats.oversizedCount / stats.batches;

  const histogram = new Map<number, number>();
  for (const size of stats.batchSizes) {
    histogram.set(size, (histogram.get(size) ?? 0) + 1);
  }
  const sizes = [...histogram.keys()].sort((a, b) => a - b);

  const totalsBySize = new Map<number, number[]>();
  for (let i = 0; i < stats.batchSizes.length; i++) {
    const size = stats.batchSizes[i];
    const bucket = totalsBySize.get(size) ?? [];
    bucket.push(stats.totals[i]);
    totalsBySize.set(size, bucket);
  }

  const lines: string[] = [];
  lines.push("s1_size_check_timing summary");
  lines.push(`lines_scanned: ${stats.linesScanned}`);
  lines.push(`event_lines: ${stats.eventLines}`);
  lines.push(`ignored_lines: ${stats.ignoredLines}`);
  lines.push(`malformed_lines_skipped: ${stats.malformedLines}`);
  lines.push(`batches: ${stats.batches}`);
  lines.push(`records_without_samples: ${stats.recordsWithoutSamples}`);
  lines.push(`per_call_samples: ${stats.perCall.length}`);
  lines.push(`per_call_median_ms: ${formatMs(perCallMedian)}`);
  lines.push(`per_call_p95_ms: ${formatMs(perCallP95)}`);
  lines.push(`per_call_max_ms: ${formatMs(perCallMax)}`);
  lines.push(`total_median_ms: ${formatMs(totalMedian)}`);
  lines.push(`total_p95_ms: ${formatMs(totalP95)}`);
  lines.push(`total_max_ms: ${formatMs(totalMax)}`);
  lines.push("batch_size_histogram:");
  for (const size of sizes) {
    lines.push(`  ${size}: ${histogram.get(size)}`);
  }
  lines.push("batch_size_stats:");
  for (const size of sizes) {
    const bucket = totalsBySize.get(size) ?? [];
    lines.push(
      `  size=${size}: count=${bucket.length} median_total_ms=${formatMs(
        median(bucket)
      )} max_total_ms=${formatMs(maxOf(bucket))}`
    );
  }
  lines.push(
    `batches_size_ge_${BURST_BATCH_SIZE}: ${
      stats.batchSizes.filter((size) => size >= BURST_BATCH_SIZE).length
    }`
  );
  lines.push(`oversized_count: ${stats.oversizedCount}`);
  lines.push(`oversized_rate: ${formatRate(oversizedRate)}`);
  lines.push(`verdict: ${verdictFor(stats.batches, perCallMedian)}`);
  return lines.join("\n");
}

function readStdin(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

export async function main(argv: string[]): Promise<number> {
  let path: string | null = null;
  for (const arg of argv) {
    if (arg === "--stdin") {
      path = null;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      process.stdout.write(
        "usage: npx tsx scripts/s1-timing-parser.ts [logfile] [--stdin]\n"
      );
      return 0;
    }
    if (arg.startsWith("-")) {
      process.stderr.write(`unknown option: ${arg}\n`);
      return 2;
    }
    path = arg;
  }

  let text: string;
  try {
    text = path === null ? readStdin() : readFileSync(path, "utf8");
  } catch (error) {
    process.stderr.write(
      `cannot read log input: ${error instanceof Error ? error.message : String(error)}\n`
    );
    return 1;
  }

  process.stdout.write(`${formatSummary(parseLogText(text))}\n`);
  return 0;
}

/**
 * Run the CLI only when this file is the process entry point. The check is
 * based on argv (not import.meta / require.main) so that the same file works
 * when it is executed as ESM (node's type stripping) or as CommonJS (tsx),
 * and never runs when the module is imported by a test.
 */
function isCliEntryPoint(): boolean {
  const entry = process.argv[1] ?? "";
  return (
    entry.endsWith("s1-timing-parser.ts") ||
    entry.endsWith("s1-timing-parser.mts")
  );
}

if (isCliEntryPoint()) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
