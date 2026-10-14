import { describe, expect, it } from "vitest";

import {
  buildLoopbackRemotePatterns,
  E2E_HERMETIC_ENV_VAR,
  isLoopbackImageAllowed,
  shouldAllowLocalIp,
} from "@/lib/image-remote-patterns";

describe("E2E_HERMETIC_ENV_VAR", () => {
  it("is the E2E_HERMETIC env var name (mirrored by next.config.ts)", () => {
    expect(E2E_HERMETIC_ENV_VAR).toBe("E2E_HERMETIC");
  });
});

describe("isLoopbackImageAllowed", () => {
  it("returns false when the flag is undefined (production path)", () => {
    expect(isLoopbackImageAllowed(undefined)).toBe(false);
  });

  it("returns true when the flag is exactly \"1\"", () => {
    expect(isLoopbackImageAllowed("1")).toBe(true);
  });

  it("trims the flag so a stray whitespace cannot disable the gate", () => {
    expect(isLoopbackImageAllowed(" 1 ")).toBe(true);
    expect(isLoopbackImageAllowed("\t1\n")).toBe(true);
  });

  it("rejects every non-\"1\" flag value (production-safe set)", () => {
    // Issue #1112: the production deploy MUST reject every value
    // other than exactly "1", so a stray E2E_HERMETIC in a
    // production .env.local cannot widen the loopback gate.
    // Mirrors `resolveBrowserlessPdfUrl` so both gates share one shape.
    for (const flag of ["", "  ", "0", "true", "yes", "2", "01", "10", "1a"]) {
      expect(isLoopbackImageAllowed(flag)).toBe(false);
    }
  });
});

describe("buildLoopbackRemotePatterns", () => {
  // These tests pin the SHAPE that `next.config.ts` merges into its
  // `images.remotePatterns` array, so a regression that drops the gate
  // (or widens it to non-loopback hosts) breaks here, not in a hand-
  // parsed next.config diff. Production means the helper returns [] —
  // next.config spreads nothing in, the production config never has
  // loopback entries. The hermetic flag means the two loopback entries
  // come back, and ONLY those.

  it("returns an empty array under the production config (no loopback entries)", () => {
    expect(buildLoopbackRemotePatterns(undefined)).toEqual([]);
  });

  it("returns an empty array for every non-\"1\" flag value", () => {
    for (const flag of ["", "  ", "0", "true", "yes", "2"]) {
      expect(buildLoopbackRemotePatterns(flag)).toEqual([]);
    }
  });

  it("returns the two loopback entries when E2E_HERMETIC=1", () => {
    expect(buildLoopbackRemotePatterns("1")).toEqual([
      { protocol: "http", hostname: "127.0.0.1" },
      { protocol: "http", hostname: "localhost" },
    ]);
  });

  it("returns ONLY loopback hosts — no widening to other http hosts", () => {
    // The helper must not, e.g., add 0.0.0.0 or private CIDRs: those
    // are SSRF surfaces a hermetic test doesn't actually need.
    const patterns = buildLoopbackRemotePatterns("1");
    const hostnames = patterns.map((p) => p.hostname).sort();
    expect(hostnames).toEqual(["127.0.0.1", "localhost"]);
    for (const pattern of patterns) {
      expect(pattern.protocol).toBe("http");
    }
  });
});

describe("shouldAllowLocalIp", () => {
  // Pins the second half of the next.config gate: `dangerouslyAllowLocalIP`.
  // That flag is gated by the same predicate as `remotePatterns`, so a
  // production build never widens the optimizer's private-IP guard.

  it("is false under the production config", () => {
    expect(shouldAllowLocalIp(undefined)).toBe(false);
  });

  it("is false for every non-\"1\" flag value", () => {
    for (const flag of ["", "0", "true", "yes", "2"]) {
      expect(shouldAllowLocalIp(flag)).toBe(false);
    }
  });

  it("is true when E2E_HERMETIC=1", () => {
    expect(shouldAllowLocalIp("1")).toBe(true);
    expect(shouldAllowLocalIp(" 1 ")).toBe(true);
  });
});