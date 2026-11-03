import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  formatSummary,
  median,
  parseLogText,
  percentile,
  verdictFor,
} from "../scripts/s1-timing-parser";

/**
 * Parser tests for scripts/s1-timing-parser.ts (issue #1494).
 *
 * The script lives under scripts/ as a one-shot CLI (repo convention:
 * `#!/usr/bin/env tsx` + `npx tsx scripts/<file>`; scripts/ holds both .mts
 * and .ts CLI scripts — this one is .ts so that the repo's own tsc run and
 * the tautology sanity guard can see it). Node >= 24 can execute the same
 * file directly with type stripping, so the CLI tests spawn the script with
 * the current node binary — no extra dependency, and they exercise the real
 * CLI contract (file/stdin input -> summary on stdout).
 *
 * The fixtures are SYNTHETIC: they prove the parser is correct, they prove
 * nothing about real latency.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const scriptPath = path.join(repoRoot, "scripts", "s1-timing-parser.ts");
const fixtureDir = path.join(repoRoot, "tests", "fixtures", "s1-timing");

function runParser(fixture: string): string {
  return execFileSync(
    process.execPath,
    // --no-warnings: node prints a MODULE_TYPELESS_PACKAGE_JSON notice for
    // every repo script (package.json has no "type" field); it is noise here.
    ["--no-warnings", scriptPath, path.join(fixtureDir, fixture)],
    { encoding: "utf8", cwd: repoRoot }
  );
}

function runParserWithStdin(input: string): string {
  return execFileSync(
    process.execPath,
    ["--no-warnings", scriptPath, "--stdin"],
    {
      encoding: "utf8",
      cwd: repoRoot,
      input,
    }
  );
}

function expectedOutput(fixture: string): string {
  return readFileSync(
    path.join(fixtureDir, fixture.replace(/\.log$/, ".expected.txt")),
    "utf8"
  );
}

describe("s1-timing-parser (issue #1494)", () => {
  it("reproduces the hand-computed medians on the mixed synthetic fixture", () => {
    expect(runParser("synthetic-mixed.log")).toBe(
      expectedOutput("synthetic-mixed.log")
    );
  });

  it("computes the hand-computed medians of the mixed fixture", () => {
    const stats = parseLogText(
      readFileSync(path.join(fixtureDir, "synthetic-mixed.log"), "utf8")
    );
    expect(stats.batches).toBe(6);
    expect(stats.perCall.length).toBe(14);
    // 8 x 10ms, 4 x 20ms, 2 x 30ms -> median 10, p95 30.
    expect(median(stats.perCall)).toBe(10);
    expect(percentile(stats.perCall, 0.95)).toBe(30);
    // totals 30, 40, 30, 40, 40, 40 -> median 40, p95 40.
    expect(median(stats.totals)).toBe(40);
    expect(percentile(stats.totals, 0.95)).toBe(40);
    expect(stats.oversizedCount).toBe(1);
    expect(stats.malformedLines).toBe(2);
    expect(stats.ignoredLines).toBe(2);
    expect(stats.eventLines).toBe(9);
    expect(stats.recordsWithoutSamples).toBe(1);
    expect(stats.batchSizes.sort((a, b) => a - b)).toEqual([1, 2, 2, 2, 3, 4]);
  });

  it("reports INSUFFICIENT below 100 batches", () => {
    const output = runParser("synthetic-mixed.log");
    expect(output).toContain("batches: 6");
    expect(output).toContain("verdict: INSUFFICIENT (<100 batches)");
  });

  it("skips malformed lines with a count and does not crash", () => {
    const output = runParser("synthetic-mixed.log");
    expect(output).toContain("malformed_lines_skipped: 2");
    expect(output).toContain("event_lines: 9");
    expect(output).toContain("ignored_lines: 2");
    // The whole run must succeed (execFileSync throws on a non-zero exit).
    expect(output).toContain("s1_size_check_timing summary");
  });

  it("reports INSUFFICIENT and no samples when the log holds no events", () => {
    expect(runParser("synthetic-no-events.log")).toBe(
      expectedOutput("synthetic-no-events.log")
    );
  });

  it("reports CONVERT-CANDIDATE at 100 batches with a 30ms median", () => {
    expect(runParser("synthetic-convert.log")).toBe(
      expectedOutput("synthetic-convert.log")
    );
    expect(runParser("synthetic-convert.log")).toContain(
      "verdict: CONVERT-CANDIDATE (median >=25ms + burst check needed)"
    );
  });

  it("reports DO-NOT-CONVERT below a 10ms median", () => {
    expect(runParser("synthetic-do-not-convert.log")).toBe(
      expectedOutput("synthetic-do-not-convert.log")
    );
    expect(runParser("synthetic-do-not-convert.log")).toContain(
      "verdict: DO-NOT-CONVERT (median <10ms)"
    );
  });

  it("reports IN-BETWEEN between 10ms and 25ms", () => {
    expect(runParser("synthetic-in-between.log")).toBe(
      expectedOutput("synthetic-in-between.log")
    );
    expect(runParser("synthetic-in-between.log")).toContain(
      "verdict: IN-BETWEEN (10–25ms — Alex decision, default do not convert)"
    );
  });

  it("maps the decision rule thresholds to verdicts", () => {
    expect(verdictFor(99, 30)).toBe("INSUFFICIENT (<100 batches)");
    expect(verdictFor(100, 30)).toBe(
      "CONVERT-CANDIDATE (median >=25ms + burst check needed)"
    );
    expect(verdictFor(100, 25)).toBe(
      "CONVERT-CANDIDATE (median >=25ms + burst check needed)"
    );
    expect(verdictFor(100, 9.999)).toBe("DO-NOT-CONVERT (median <10ms)");
    expect(verdictFor(100, 10)).toBe(
      "IN-BETWEEN (10–25ms — Alex decision, default do not convert)"
    );
    expect(verdictFor(100, 24.999)).toBe(
      "IN-BETWEEN (10–25ms — Alex decision, default do not convert)"
    );
  });

  it("reads the log from stdin as well", () => {
    const log = readFileSync(
      path.join(fixtureDir, "synthetic-mixed.log"),
      "utf8"
    );
    expect(runParserWithStdin(log)).toBe(expectedOutput("synthetic-mixed.log"));
  });

  it("never throws on garbage input", () => {
    const output = runParserWithStdin(
      'not json at all\n{"event":"s1_size_check_timing"\n'
    );
    expect(output).toContain("malformed_lines_skipped: 1");
    expect(output).toContain("verdict: INSUFFICIENT (<100 batches)");
  });

  it("formats a summary without a trailing newline in the middle", () => {
    const stats = parseLogText(
      readFileSync(path.join(fixtureDir, "synthetic-mixed.log"), "utf8")
    );
    const summary = formatSummary(stats);
    expect(summary.split("\n")[0]).toBe("s1_size_check_timing summary");
    expect(summary.split("\n").at(-1)).toBe(
      "verdict: INSUFFICIENT (<100 batches)"
    );
  });
});
