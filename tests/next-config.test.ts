import { describe, expect, it } from "vitest";

import nextConfig from "../next.config";
import { CSP_VALUE, SECURITY_HEADERS } from "@/lib/security-headers";

/**
 * Pins the Content-Security-Policy allowlist so the hermetic e2e
 * harness (`npm run e2e`) can keep talking to its local mock Supabase
 * (GoTrue auth + Storage) on `127.0.0.1:39911`.
 *
 * The mock is on a different port than the app under test
 * (`127.0.0.1:39901`), so it's not `'self'` and CSP must explicitly
 * allow it. The wildcard `http://127.0.0.1:*` (and `wss://` for any
 * websocket upgrade) scopes the relaxation to loopback only — no
 * production surface, since Vercel sets `NEXT_PUBLIC_SUPABASE_URL` to
 * `*.supabase.co` and never loopback.
 *
 * Pinned by issue #1076. Any future contributor who "tightens" the CSP
 * by removing the loopback allowlist will see this test fail with a
 * cross-reference to the issue, restoring the suite.
 */
describe("security-headers CSP allowlist (issue #1076)", () => {
  const connectSrc = CSP_VALUE.split(";").find((d) => d.trim().startsWith("connect-src"));
  const imgSrc = CSP_VALUE.split(";").find((d) => d.trim().startsWith("img-src"));

  it("allows http://127.0.0.1:* in connect-src (mock Supabase auth + storage)", () => {
    expect(connectSrc, "connect-src directive missing from CSP").toBeDefined();
    expect(connectSrc).toMatch(/http:\/\/127\.0\.0\.1:\*/);
  });

  it("allows wss://127.0.0.1:* in connect-src (covers ws:// auto-upgrades)", () => {
    expect(connectSrc).toMatch(/wss:\/\/127\.0\.0\.1:\*/);
  });

  it("allows http://127.0.0.1:* in img-src (next/image optimizer fetches mock storage)", () => {
    expect(imgSrc, "img-src directive missing from CSP").toBeDefined();
    expect(imgSrc).toMatch(/http:\/\/127\.0\.0\.1:\*/);
  });

  it("preserves production CSP invariants (still allows *.supabase.co + wss://*.supabase.co)", () => {
    // Regression guard: the relaxation must NOT remove the production
    // allowlist. Real deployments hit https://*.supabase.co and
    // wss://*.supabase.co for Supabase Auth/Realtime.
    expect(CSP_VALUE).toMatch(/connect-src[^;]*https:\/\/\*\.supabase\.co/);
    expect(CSP_VALUE).toMatch(/connect-src[^;]*wss:\/\/\*\.supabase\.co/);
  });
});

/**
 * Pins the security-header wiring itself (issue #1127). Before this block
 * the `headers()` export in `next.config.ts` was referenced by no test:
 * deleting the block (or gutting SECURITY_HEADERS) kept the suite green
 * while dropping CSP, clickjacking and referrer protection site-wide.
 *
 * Deliberately NOT a directive-by-directive copy of the whole CSP here —
 * the #1076 describe block above owns the loopback allowlist; this block
 * pins the five security-critical directives plus the full
 * headers()-to-SECURITY_HEADERS contract.
 */
describe("security headers wiring (issue #1127)", () => {
  it("headers() applies every SECURITY_HEADERS entry to /:path*", async () => {
    const headers = nextConfig.headers;
    expect(
      headers,
      "next.config.ts lost its headers() block — CSP, clickjacking and referrer protection are gone site-wide (issue #1127)"
    ).toBeDefined();
    const rules = await headers!();
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe("/:path*");
    // Full key+value map: a removed header or a drifted value fails, not
    // just an absence.
    expect(rules[0].headers).toEqual([...SECURITY_HEADERS]);
  });

  it("pins X-Frame-Options: DENY (clickjacking)", () => {
    expect(SECURITY_HEADERS).toContainEqual({
      key: "X-Frame-Options",
      value: "DENY",
    });
  });

  it("pins X-Content-Type-Options: nosniff (MIME confusion)", () => {
    expect(SECURITY_HEADERS).toContainEqual({
      key: "X-Content-Type-Options",
      value: "nosniff",
    });
  });

  it("pins Referrer-Policy: strict-origin-when-cross-origin", () => {
    expect(SECURITY_HEADERS).toContainEqual({
      key: "Referrer-Policy",
      value: "strict-origin-when-cross-origin",
    });
  });

  it("pins Permissions-Policy: no camera, microphone, geolocation, payment, FLoC", () => {
    expect(SECURITY_HEADERS).toContainEqual({
      key: "Permissions-Policy",
      value:
        "camera=(), microphone=(), geolocation=(), payment=(), interest-cohort=()",
    });
  });

  const directives = CSP_VALUE.split(";").map((d) => d.trim());

  it("pins frame-ancestors 'none' (CSP framing counterpart to X-Frame-Options)", () => {
    expect(directives).toContain("frame-ancestors 'none'");
  });

  it("pins object-src 'none' (no plugin/object embeds)", () => {
    expect(directives).toContain("object-src 'none'");
  });

  it("pins base-uri 'self' (blocks injected <base> hijacking)", () => {
    expect(directives).toContain("base-uri 'self'");
  });

  it("pins form-action 'self' (blocks exfil via injected form targets)", () => {
    expect(directives).toContain("form-action 'self'");
  });

  it("pins upgrade-insecure-requests", () => {
    expect(directives).toContain("upgrade-insecure-requests");
  });

  // Issue #1344 follow-up: `browser-image-compression@2.0.2` (the room
  // photo upload's client-side compressor) uses a blob: Web Worker. The
  // CSP must permit it explicitly — without `worker-src 'self' blob:`,
  // browsers fall back to `script-src`, the worker is blocked, and the
  // upload throws `data.find is not a function` mid-compression. Pinned
  // here so a future "tighten CSP" pass doesn't silently re-break the
  // upload flow (the 9 pre-existing e2e failures from 2026-10-15).
  it("allows blob: workers (browser-image-compression, room photo upload)", () => {
    const workerSrc = directives.find((d) => d.startsWith("worker-src"));
    expect(workerSrc, "worker-src directive missing from CSP").toBeDefined();
    expect(workerSrc).toMatch(/'self'/);
    expect(workerSrc).toMatch(/blob:/);
  });
});
