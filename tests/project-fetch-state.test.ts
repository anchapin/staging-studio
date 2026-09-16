import { describe, expect, it } from "vitest";
import { projectFetchStateFromStatus } from "@/lib/project-fetch-state";

/**
 * Table-driven mapping (issue #90): ONLY a real 404 is "the project isn't
 * there"; every auth/server/client error and every thrown network error
 * (no status) must be a retryable load failure.
 */
const CASES: ReadonlyArray<[number | null | undefined, string]> = [
  // Authoritative miss
  [404, "not-found"],
  // Auth failures are session problems, not data loss
  [401, "retryable"],
  [403, "retryable"],
  // Server-side failures
  [500, "retryable"],
  [502, "retryable"],
  [503, "retryable"],
  // Other non-OK statuses default to retryable too
  [400, "retryable"],
  [429, "retryable"],
  // Thrown fetch errors carry no status and must never read as not-found
  [null, "retryable"],
  [undefined, "retryable"],
];

describe("projectFetchStateFromStatus", () => {
  it.each(CASES)("status %s → %s", (status, expected) => {
    expect(projectFetchStateFromStatus(status)).toBe(expected);
  });
});
