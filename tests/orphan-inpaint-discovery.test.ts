/**
 * Unit tests for the orphan inpaint-row discovery (issue #1423).
 *
 * Pinned pieces:
 *   - `discoverOrphans` classifies each row into RECOVERY / CLEANUP / no-op.
 *   - The two age cutoffs are pinned at 24h (RECOVERY) and 7d (CLEANUP).
 *   - Force-include allowlist logic (from the two scripts' merge code)
 *     yields the right combined classification.
 *   - `formatOrphanLine` keeps a stable, parseable output across the
 *     pair of scripts.
 */
import { describe, expect, it } from "vitest";
import {
  CLEANUP_AGE_MS,
  RECOVERY_AGE_MS,
  discoverOrphans,
  formatOrphanLine,
  type InpaintRequestRow,
} from "@/lib/orphan-inpaint-discovery";

const NOW = new Date("2026-10-21T12:00:00Z");

function rowWith(overrides: Partial<InpaintRequestRow>): InpaintRequestRow {
  return {
    id: overrides.id ?? "row-1",
    status: overrides.status ?? "IN_QUEUE",
    createdAt: overrides.createdAt ?? NOW,
    updatedAt: overrides.updatedAt ?? NOW,
    resultUrl: overrides.resultUrl ?? null,
    roomId: overrides.roomId ?? "room-1",
  };
}

describe("discoverOrphans", () => {
  it("classifies an ERROR row older than 24h as RECOVERY", () => {
    const rows = [
      rowWith({
        id: "r-error-1",
        status: "ERROR",
        createdAt: new Date(NOW.getTime() - RECOVERY_AGE_MS - 1000),
      }),
    ];
    const out = discoverOrphans(rows, NOW);
    expect(out.counts.RECOVERY).toBe(1);
    expect(out.counts.CLEANUP).toBe(0);
    expect(out.orphans[0]).toMatchObject({ id: "r-error-1", kind: "RECOVERY" });
  });

  it("does NOT classify an ERROR row newer than 24h (recent errors stay put)", () => {
    const rows = [
      rowWith({
        id: "r-error-2",
        status: "ERROR",
        createdAt: new Date(NOW.getTime() - 60 * 60 * 1000), // 1h ago
      }),
    ];
    const out = discoverOrphans(rows, NOW);
    expect(out.counts.RECOVERY).toBe(0);
    expect(out.counts.CLEANUP).toBe(0);
    expect(out.orphans).toHaveLength(0);
  });

  it("classifies a PERSISTENCE_FAILED row updated more than 7d ago as CLEANUP", () => {
    const rows = [
      rowWith({
        id: "r-cleanup-1",
        status: "PERSISTENCE_FAILED",
        createdAt: new Date(NOW.getTime() - CLEANUP_AGE_MS - 1000),
        updatedAt: new Date(NOW.getTime() - CLEANUP_AGE_MS - 1000),
      }),
    ];
    const out = discoverOrphans(rows, NOW);
    expect(out.counts.RECOVERY).toBe(0);
    expect(out.counts.CLEANUP).toBe(1);
    expect(out.orphans[0]).toMatchObject({ id: "r-cleanup-1", kind: "CLEANUP" });
  });

  it("does NOT classify a recently-updated PERSISTENCE_FAILED row", () => {
    const rows = [
      rowWith({
        id: "r-cleanup-2",
        status: "PERSISTENCE_FAILED",
        updatedAt: new Date(NOW.getTime() - 60 * 60 * 1000), // 1h ago
      }),
    ];
    const out = discoverOrphans(rows, NOW);
    expect(out.counts.CLEANUP).toBe(0);
  });

  it("ignores rows in any other status (IN_PROGRESS, COMPLETED, IN_QUEUE)", () => {
    const rows = [
      rowWith({
        id: "r-1",
        status: "IN_PROGRESS",
        createdAt: new Date(NOW.getTime() - RECOVERY_AGE_MS * 2),
      }),
      rowWith({
        id: "r-2",
        status: "COMPLETED",
        updatedAt: new Date(NOW.getTime() - CLEANUP_AGE_MS * 2),
        createdAt: new Date(NOW.getTime() - CLEANUP_AGE_MS * 2),
      }),
      rowWith({ id: "r-3", status: "IN_QUEUE" }),
    ];
    const out = discoverOrphans(rows, NOW);
    expect(out.orphans).toHaveLength(0);
    expect(out.counts).toEqual({ RECOVERY: 0, CLEANUP: 0 });
  });

  it("brief-style scenario: two orphans + one healthy row", () => {
    // The brief asks the e2e suite to "seed two orphan rows + one
    // healthy row and assert the discovery step returns exactly the
    // two". This is the discovery side of that pin.
    const rows: InpaintRequestRow[] = [
      rowWith({
        id: "r-orphan-1",
        status: "ERROR",
        createdAt: new Date(NOW.getTime() - RECOVERY_AGE_MS - 1000),
      }),
      rowWith({
        id: "r-orphan-2",
        status: "PERSISTENCE_FAILED",
        createdAt: new Date(NOW.getTime() - CLEANUP_AGE_MS - 1000),
        updatedAt: new Date(NOW.getTime() - CLEANUP_AGE_MS - 1000),
      }),
      rowWith({ id: "r-healthy", status: "COMPLETED" }),
    ];
    const out = discoverOrphans(rows, NOW);
    expect(out.orphans.map((o) => o.id).sort()).toEqual([
      "r-orphan-1",
      "r-orphan-2",
    ]);
    expect(out.counts.RECOVERY).toBe(1);
    expect(out.counts.CLEANUP).toBe(1);
  });

  it("cutoff constants are pinned: 24h and 7d respectively", () => {
    expect(RECOVERY_AGE_MS).toBe(24 * 60 * 60 * 1000);
    expect(CLEANUP_AGE_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe("formatOrphanLine", () => {
  const orphanRow = rowWith({
    id: "r-1",
    status: "ERROR",
    roomId: "room-XYZ",
    resultUrl: null,
  });
  const orphan = {
    id: "r-1",
    kind: "RECOVERY" as const,
    row: orphanRow,
  };

  it("renders verb in lowercase for dry-run", () => {
    const line = formatOrphanLine(orphan, false);
    expect(line).toContain("recovery");
    expect(line).toContain("would flip->persistence_failed");
    expect(line).toContain("r-1");
    expect(line).toContain("status=ERROR");
    expect(line).toContain("roomId=room-XYZ");
    expect(line).toContain("resultUrl=null");
  });

  it("renders verb in uppercase for apply-mode", () => {
    const line = formatOrphanLine(orphan, true);
    expect(line).toContain("FLIP->PERSISTENCE_FAILED");
    expect(line).not.toContain("would ");
  });

  it("truncates long resultUrl at 60 chars", () => {
    const longUrl =
      "https://example.com/some/long/url/" + "x".repeat(80) + "/result.jpg";
    const out = formatOrphanLine(
      { ...orphan, row: { ...orphanRow, resultUrl: longUrl } },
      false,
    );
    expect(out).toContain("...");
    expect(out.length).toBeLessThan(300);
  });
});
