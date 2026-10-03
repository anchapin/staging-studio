import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DETECTION_TIMEOUT_MS, SEGMENT_WORST_CASE_MS } from "@/lib/segment-timeouts";

/**
 * Issue #1118: the platform must not kill /api/segment/furnishings before
 * its own timeouts fire. Worst case is the fal subscribe (DETECTION_TIMEOUT_MS)
 * followed by the mask fetches, each armed with a fresh DETECTION_TIMEOUT_MS
 * (they run in parallel via Promise.allSettled, #1119). The declared
 * maxDuration has to cover both legs or a slow detection becomes an opaque
 * 504 and the SAM call is never recorded against the daily quota.
 */
const source = readFileSync(
  join(process.cwd(), "src/app/api/segment/furnishings/route.ts"),
  "utf8"
);

function readNumber(pattern: RegExp): number {
  const match = source.match(pattern);
  if (!match) throw new Error(`pattern not found: ${pattern}`);
  return Number(match[1].replace(/_/g, ""));
}

describe("segment/furnishings maxDuration (#1118)", () => {
  const maxDurationSeconds = readNumber(/export const maxDuration = ([\d_]+);/);

  it("declares maxDuration", () => {
    expect(maxDurationSeconds).toBeGreaterThan(0);
  });

  it("covers the subscribe plus the mask-fetch leg", () => {
    expect(SEGMENT_WORST_CASE_MS).toBe(2 * DETECTION_TIMEOUT_MS);
    expect(maxDurationSeconds * 1000).toBeGreaterThanOrEqual(SEGMENT_WORST_CASE_MS);
  });

  it("the route uses the shared timeout, not a local copy", () => {
    expect(source).toContain('from "@/lib/segment-timeouts"');
    expect(source).not.toMatch(/const DETECTION_TIMEOUT_MS =/);
  });

  it("stays within the Vercel Pro ceiling", () => {
    expect(maxDurationSeconds).toBeLessThanOrEqual(800);
  });
});
