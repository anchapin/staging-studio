import { describe, expect, it } from "vitest";

import { formatLongDate, formatRelativeTime } from "@/lib/relative-time";

/**
 * Issue #713: pins the shared relative/absolute date formatting 1:1.
 *
 * formatRelativeTime previously lived verbatim in both
 * version-history-pills.tsx and version-history-panel.tsx; formatLongDate
 * replaces the inline en-US toLocaleDateString options objects in the
 * signoff and consultation-report pages. Dates are built from local
 * components so expectations hold on any runner timezone, and `now` is
 * injected so the thresholds are deterministic.
 */

// Local-components noon so day-level math never crosses a DST boundary
// skew in either direction.
const NOW = new Date(2026, 8, 23, 12, 0, 0, 0).getTime();

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("formatRelativeTime", () => {
  it("returns 'just now' for anything under a minute old, including future timestamps", () => {
    expect(formatRelativeTime(new Date(NOW), NOW)).toBe("just now");
    expect(formatRelativeTime(new Date(NOW - 59_999), NOW)).toBe("just now");
    // Negative diffs (clock skew, future rows) floor below 60 as well.
    expect(formatRelativeTime(new Date(NOW + 30 * MINUTE), NOW)).toBe("just now");
  });

  it("returns minute labels for 1–59 minutes", () => {
    expect(formatRelativeTime(new Date(NOW - 1 * MINUTE), NOW)).toBe("1m ago");
    expect(formatRelativeTime(new Date(NOW - 59 * MINUTE), NOW)).toBe("59m ago");
  });

  it("returns hour labels for 1–23 hours", () => {
    expect(formatRelativeTime(new Date(NOW - 1 * HOUR), NOW)).toBe("1h ago");
    expect(formatRelativeTime(new Date(NOW - 23 * HOUR), NOW)).toBe("23h ago");
  });

  it("returns day labels for 1–6 days", () => {
    expect(formatRelativeTime(new Date(NOW - 1 * DAY), NOW)).toBe("1d ago");
    expect(formatRelativeTime(new Date(NOW - 6 * DAY), NOW)).toBe("6d ago");
  });

  it("falls back to the locale absolute date from a week on", () => {
    const weekOld = new Date(2026, 8, 16, 12, 0, 0, 0);
    const monthOld = new Date(2026, 7, 23, 12, 0, 0, 0);
    expect(formatRelativeTime(weekOld, NOW)).toBe(weekOld.toLocaleDateString());
    expect(formatRelativeTime(monthOld, NOW)).toBe(monthOld.toLocaleDateString());
  });

  it("accepts serialized string and number timestamps", () => {
    expect(formatRelativeTime(new Date(NOW - 5 * MINUTE).toISOString(), NOW)).toBe("5m ago");
    expect(formatRelativeTime(NOW - 5 * MINUTE, NOW)).toBe("5m ago");
  });

  it("defaults `now` to the current clock", () => {
    const fresh = new Date();
    expect(formatRelativeTime(fresh)).toBe("just now");
    expect(formatRelativeTime(fresh, new Date())).toBe("just now");
  });
});

describe("formatLongDate", () => {
  it("renders the long en-US form", () => {
    expect(formatLongDate(new Date(2026, 8, 23, 12, 0, 0, 0))).toBe(
      "September 23, 2026"
    );
  });

  it("accepts serialized timestamps", () => {
    const ts = new Date(2026, 0, 7, 9, 30, 0, 0);
    expect(formatLongDate(ts.toISOString())).toBe("January 7, 2026");
    expect(formatLongDate(ts.getTime())).toBe("January 7, 2026");
  });
});
