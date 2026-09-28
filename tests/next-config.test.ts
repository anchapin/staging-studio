import { describe, expect, it } from "vitest";

import { CSP_VALUE } from "@/lib/security-headers";

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
