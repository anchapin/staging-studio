import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  hashIp,
  extractIp,
  recordFailedAttempt,
  checkRateLimit,
  clearRateLimit,
  SETUP_RATE_LIMIT_MAX_ATTEMPTS,
  SETUP_RATE_LIMIT_WINDOW_MS,
  SETUP_LOCKOUT_MS,
} from "@/lib/setup-rate-limit";

// ---------------------------------------------------------------------------
// Mock Prisma
// ---------------------------------------------------------------------------

/** Shared in-memory store used by the mocked Prisma client. */
interface RateLimitRow {
  attemptCount: number;
  windowStart: Date;
  lockedUntil: Date | null;
}

const mockStore: Record<string, RateLimitRow> = {};

vi.mock("@/lib/prisma", () => {
  async function mockUpsert(args: {
    where: { ipHash: string };
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }) {
    const ipHash = args.where.ipHash;
    const create = args.create as Record<string, unknown>;
    if (!mockStore[ipHash]) {
      mockStore[ipHash] = {
        attemptCount: create.attemptCount as number,
        windowStart: new Date(),
        lockedUntil: null,
      };
    } else {
      mockStore[ipHash].attemptCount += 1;
    }
    return mockStore[ipHash];
  }

  async function mockUpdate(args: {
    where: { ipHash: string };
    data: Record<string, unknown>;
  }) {
    const ipHash = args.where.ipHash;
    if (mockStore[ipHash]) {
      if (args.data.lockedUntil !== undefined) {
        mockStore[ipHash].lockedUntil = args.data.lockedUntil as Date | null;
      }
    }
    return mockStore[ipHash];
  }

  async function mockFindUnique(args: { where: { ipHash: string } }) {
    return mockStore[args.where.ipHash] ?? null;
  }

  async function mockDeleteMany(args: { where: { ipHash: string } }) {
    const count = mockStore[args.where.ipHash] ? 1 : 0;
    delete mockStore[args.where.ipHash];
    return { count };
  }

  async function mockTransaction<T>(
    fn: (tx: {
      setupRateLimit: {
        upsert: typeof mockUpsert;
        update: typeof mockUpdate;
        findUnique: typeof mockFindUnique;
      };
    }) => Promise<T>
  ): Promise<T> {
    return fn({
      setupRateLimit: {
        upsert: mockUpsert,
        update: mockUpdate,
        findUnique: mockFindUnique,
      },
    });
  }

  return {
    prisma: {
      $transaction: mockTransaction,
      setupRateLimit: {
        upsert: mockUpsert,
        update: mockUpdate,
        findUnique: mockFindUnique,
        deleteMany: mockDeleteMany,
      },
    },
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ONE_HOUR_MS = SETUP_RATE_LIMIT_WINDOW_MS;
const MAX_ATTEMPTS = SETUP_RATE_LIMIT_MAX_ATTEMPTS;

function storeEntry(
  ipHash: string,
  attemptCount: number,
  windowStart: Date,
  lockedUntil: Date | null = null
) {
  mockStore[ipHash] = { attemptCount, windowStart, lockedUntil };
}

function currentWindowStart() {
  // Started 55 min ago — well within the 1-hour window.
  return new Date(Date.now() - ONE_HOUR_MS + 60_000);
}

function expiredWindowStart() {
  // Started 65 min ago — window has expired.
  return new Date(Date.now() - ONE_HOUR_MS - 60_000);
}

// ---------------------------------------------------------------------------
// hashIp
// ---------------------------------------------------------------------------

describe("hashIp", () => {
  it("produces a 64-character hex string (SHA-256)", async () => {
    const result = await hashIp("192.168.1.1");
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic: same input yields same output", async () => {
    const a = await hashIp("10.0.0.1");
    const b = await hashIp("10.0.0.1");
    expect(a).toBe(b);
  });

  it("different IPs produce different hashes", async () => {
    const a = await hashIp("1.1.1.1");
    const b = await hashIp("2.2.2.2");
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// extractIp
// ---------------------------------------------------------------------------

describe("extractIp", () => {
  it("returns the first comma-separated value from x-forwarded-for", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.1, 10.0.0.1, 172.16.0.1",
    });
    expect(extractIp(headers)).toBe("203.0.113.1");
  });

  it("trims whitespace from x-forwarded-for value", () => {
    const headers = new Headers({ "x-forwarded-for": "  198.51.100.42  , 10.0.0.1" });
    expect(extractIp(headers)).toBe("198.51.100.42");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const headers = new Headers({ "x-real-ip": "192.0.2.1" });
    expect(extractIp(headers)).toBe("192.0.2.1");
  });

  it("returns 'unknown' when no IP header is present", () => {
    const headers = new Headers();
    expect(extractIp(headers)).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// recordFailedAttempt
// ---------------------------------------------------------------------------

describe("recordFailedAttempt", () => {
  beforeEach(() => {
    // Reset the in-memory store between tests.
    for (const key of Object.keys(mockStore)) delete mockStore[key];
  });

  it("creates a new row with attemptCount=1 for a first-time IP", async () => {
    const ip = await hashIp("1.2.3.4");
    const result = await recordFailedAttempt(ip);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(MAX_ATTEMPTS - 1);
    expect(result.locked).toBe(false);
  });

  it("increments attemptCount on subsequent failures", async () => {
    const ip = await hashIp("5.6.7.8");
    storeEntry(ip, 3, currentWindowStart());

    const result = await recordFailedAttempt(ip);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(MAX_ATTEMPTS - 4);
  });

  it("returns allowed=false and locked=true once MAX_ATTEMPTS is reached", async () => {
    const ip = await hashIp("9.9.9.9");
    storeEntry(ip, MAX_ATTEMPTS - 1, currentWindowStart());

    const result = await recordFailedAttempt(ip);

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.locked).toBe(true);
  });

  it("continues to block after lockout is set", async () => {
    const ip = await hashIp("8.8.8.8");
    const lockUntil = new Date(Date.now() + SETUP_LOCKOUT_MS);
    storeEntry(ip, MAX_ATTEMPTS, currentWindowStart(), lockUntil);

    const result = await recordFailedAttempt(ip);

    expect(result.allowed).toBe(false);
    expect(result.locked).toBe(true);
    expect(result.resetAt).toBe(lockUntil.getTime());
  });

  it("allows a request in a fresh window after expiry", async () => {
    const ip = await hashIp("77.77.77.77");
    storeEntry(ip, MAX_ATTEMPTS, expiredWindowStart()); // old window

    const result = await recordFailedAttempt(ip);

    // The upsert starts a new window with count=1.
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(MAX_ATTEMPTS - 1);
  });

  it("resetAt is in the future", async () => {
    const ip = await hashIp("11.22.33.44");
    const result = await recordFailedAttempt(ip);
    expect(result.resetAt).toBeGreaterThan(Date.now());
  });
});

// ---------------------------------------------------------------------------
// checkRateLimit
// ---------------------------------------------------------------------------

describe("checkRateLimit", () => {
  beforeEach(() => {
    for (const key of Object.keys(mockStore)) delete mockStore[key];
  });

  it("returns full quota for an unknown IP", async () => {
    const ip = await hashIp("99.99.99.99");
    const result = await checkRateLimit(ip);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(MAX_ATTEMPTS);
    expect(result.locked).toBe(false);
  });

  it("returns remaining attempts for a known IP within the window", async () => {
    const ip = await hashIp("88.88.88.88");
    storeEntry(ip, 4, currentWindowStart());

    const result = await checkRateLimit(ip);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(MAX_ATTEMPTS - 4);
  });

  it("returns allowed=true for a row past its window (new window)", async () => {
    const ip = await hashIp("77.77.77.77");
    storeEntry(ip, 100, expiredWindowStart()); // old window

    const result = await checkRateLimit(ip);

    // Window expired — fresh quota.
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(MAX_ATTEMPTS);
  });

  it("returns allowed=true when lockedUntil is null even at max attempts", async () => {
    const ip = await hashIp("66.66.66.66");
    storeEntry(ip, MAX_ATTEMPTS, currentWindowStart(), null);

    const result = await checkRateLimit(ip);

    // lockedUntil is null, so check only sees attemptCount — still allowed
    // because we don't auto-lock on read, only on write.
    expect(result.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// clearRateLimit
// ---------------------------------------------------------------------------

describe("clearRateLimit", () => {
  beforeEach(() => {
    for (const key of Object.keys(mockStore)) delete mockStore[key];
  });

  it("deletes the row for the given IP hash", async () => {
    const ip = await hashIp("55.55.55.55");
    storeEntry(ip, 5, currentWindowStart());

    await clearRateLimit(ip);

    expect(mockStore[ip]).toBeUndefined();
  });

  it("does not throw when the IP has no row", async () => {
    const ip = await hashIp("44.44.44.44");
    await expect(clearRateLimit(ip)).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("Constants", () => {
  it("SETUP_RATE_LIMIT_WINDOW_MS is 1 hour in ms", () => {
    expect(SETUP_RATE_LIMIT_WINDOW_MS).toBe(60 * 60 * 1000);
  });

  it("SETUP_RATE_LIMIT_MAX_ATTEMPTS is 10", () => {
    expect(SETUP_RATE_LIMIT_MAX_ATTEMPTS).toBe(10);
  });

  it("SETUP_LOCKOUT_MS equals the window", () => {
    expect(SETUP_LOCKOUT_MS).toBe(SETUP_RATE_LIMIT_WINDOW_MS);
  });
});
