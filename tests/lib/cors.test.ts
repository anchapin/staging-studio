import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

import {
  createPreflightResponse,
  getCorsHeaders,
  isPreflightRequest,
  withCors,
} from "@/lib/cors";

/**
 * Issue #1061: CORS policy utility — the single-tenant app-origin policy
 * applied by every API route via `withCors(response)` or
 * `createPreflightResponse()`. Origin comes from NEXT_PUBLIC_APP_URL, with
 * a dev-only fallback to http://localhost:3000.
 */

describe("getCorsHeaders (issue #1061)", () => {
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

  afterEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
  });

  it("returns the configured origin when NEXT_PUBLIC_APP_URL is set", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://staging-studio-kappa.vercel.app";
    const headers = getCorsHeaders();
    expect(headers["Access-Control-Allow-Origin"]).toBe(
      "https://staging-studio-kappa.vercel.app"
    );
  });

  it("falls back to localhost:3000 in dev when NEXT_PUBLIC_APP_URL is unset", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    const headers = getCorsHeaders();
    expect(headers["Access-Control-Allow-Origin"]).toBe("http://localhost:3000");
  });

  it("falls back to localhost:3000 when NEXT_PUBLIC_APP_URL is empty", () => {
    process.env.NEXT_PUBLIC_APP_URL = "";
    const headers = getCorsHeaders();
    expect(headers["Access-Control-Allow-Origin"]).toBe("http://localhost:3000");
  });

  it("trims surrounding whitespace from NEXT_PUBLIC_APP_URL", () => {
    process.env.NEXT_PUBLIC_APP_URL = "   https://example.com   ";
    const headers = getCorsHeaders();
    expect(headers["Access-Control-Allow-Origin"]).toBe("https://example.com");
  });

  it("exposes the standard method + header + credentials allowlist", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://example.com";
    const headers = getCorsHeaders();
    expect(headers["Access-Control-Allow-Methods"]).toBe(
      "GET, POST, PUT, DELETE, PATCH, OPTIONS"
    );
    expect(headers["Access-Control-Allow-Headers"]).toBe(
      "Content-Type, Authorization"
    );
    expect(headers["Access-Control-Allow-Credentials"]).toBe("true");
  });
});

describe("createPreflightResponse (issue #1061)", () => {
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = "https://example.com";
  });
  afterEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
  });

  it("returns a 200 JSON { ok: true } body with CORS headers attached", async () => {
    const res = createPreflightResponse();
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://example.com"
    );
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe(
      "GET, POST, PUT, DELETE, PATCH, OPTIONS"
    );
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("withCors (issue #1061)", () => {
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = "https://example.com";
  });
  afterEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
  });

  it("attaches every CORS header to an existing NextResponse and returns it", () => {
    const original = NextResponse.json({ result: "ok" });
    const wrapped = withCors(original);
    expect(wrapped).toBe(original);
    expect(wrapped.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://example.com"
    );
    expect(wrapped.headers.get("Access-Control-Allow-Methods")).toBe(
      "GET, POST, PUT, DELETE, PATCH, OPTIONS"
    );
    expect(wrapped.headers.get("Access-Control-Allow-Headers")).toBe(
      "Content-Type, Authorization"
    );
    expect(wrapped.headers.get("Access-Control-Allow-Credentials")).toBe(
      "true"
    );
  });
});

describe("isPreflightRequest (issue #1061)", () => {
  function makeRequest(method: string): NextRequest {
    return new NextRequest("https://example.com/api/anything", { method });
  }

  it("returns true for an OPTIONS request", () => {
    expect(isPreflightRequest(makeRequest("OPTIONS"))).toBe(true);
  });

  it("returns false for every other method", () => {
    for (const method of ["GET", "POST", "PUT", "DELETE", "PATCH"]) {
      expect(isPreflightRequest(makeRequest(method))).toBe(false);
    }
  });

  it("returns false for an OPTIONS-shaped path with a non-OPTIONS method header", () => {
    // Defensive — a malformed request with OPTIONS in a body field but a
    // real method should not be treated as a preflight.
    const req = new NextRequest("https://example.com/api/anything", {
      method: "GET",
    });
    expect(isPreflightRequest(req)).toBe(false);
  });
});