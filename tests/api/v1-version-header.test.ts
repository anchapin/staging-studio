/**
 * Shared v1 version-header consistency guard (issue #1099).
 *
 * `/api/v1/sign-project` shipped the legacy `API-Version` header name as a
 * string literal while its six siblings went through `buildVersionHeaders()`.
 * Because the rename (`API-Version` -> `X-Supabase-API-Version`, hotfix #1018)
 * missed it, the v1 surface answered in two dialects at once — and *no* test
 * failed, because no test pinned the header on that route. The bug was live in
 * Production while both suites stayed green.
 *
 * So the guard is two-sided:
 *
 *  1. A source-level table check over EVERY v1 route, discovered from disk (so
 *     a newly added route is covered automatically and cannot skip the shared
 *     helper). This is the recurrence guard: the failure mode was a hardcoded
 *     name, which is statically detectable.
 *  2. A behavioural check on the route that actually broke, asserting the real
 *     response header on both the POST proxy and the OPTIONS preflight. Text
 *     matching alone cannot prove the fix works at runtime.
 *
 * `VERSION_HEADER` is imported rather than retyped so that when the header is
 * renamed again, these assertions follow it and only a *route* left behind
 * fails.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VERSION_HEADER } from "@/lib/api-version";

// Resolved from this file rather than process.cwd() so the guard holds however
// vitest is invoked.
const SRC_APP_ROOT = fileURLToPath(new URL("../../src/app", import.meta.url));
const V1_ROUTE_ROOT = join(SRC_APP_ROOT, "api/v1");

/** The header name before the #1018 rename. Never type it as a live header. */
const LEGACY_HEADER_NAME = "API-Version";

/**
 * Matches the legacy name only when it is NOT part of the current
 * `X-Supabase-API-Version` name — a bare substring check would false-positive
 * on every correct usage, since the new name contains the old one.
 */
const LEGACY_HEADER_RE = /(?<!X-Supabase-)["'`]?API-Version/;

function collectRouteFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...collectRouteFiles(full));
    } else if (entry === "route.ts") {
      found.push(full);
    }
  }
  return found.sort();
}

/** e.g. `src/app/api/v1/inpaint/[requestId]/route.ts` -> `/api/v1/inpaint/[requestId]` */
function routePathOf(file: string): string {
  return file
    .slice(SRC_APP_ROOT.length)
    .replace(/\\/g, "/")
    .replace(/\/route\.ts$/, "");
}

const ROUTE_FILES = collectRouteFiles(V1_ROUTE_ROOT);

describe("v1 route version-header consistency (#1099)", () => {
  it("discovers every v1 route (guards the table below from going stale)", () => {
    // If this fails, a v1 route was added or removed and the expectations
    // below need re-reading — a silently empty table would pass forever.
    expect(ROUTE_FILES.length).toBeGreaterThan(0);
    expect(ROUTE_FILES.map(routePathOf)).toEqual(
      expect.arrayContaining([
        "/api/v1/sign-project",
        "/api/v1/export-pdf",
        "/api/v1/inpaint",
        "/api/v1/generate-copy",
        "/api/v1/segment",
      ])
    );
  });

  describe.each(ROUTE_FILES)("%s", (file) => {
    const source = readFileSync(file, "utf8");

    it("does not hardcode the legacy header name", () => {
      const offenders = source
        .split("\n")
        .map((line, i) => ({ line: i + 1, text: line }))
        .filter(({ text }) => LEGACY_HEADER_RE.test(text));
      expect(
        offenders,
        `${routePathOf(file)} still names the legacy version header. Route it through buildVersionHeaders() from @/lib/api-version so a rename cannot skip it.`
      ).toEqual([]);
    });

    it("stamps its version header via the shared helper", () => {
      expect(
        source,
        `${routePathOf(file)} sets no version header at all. Use buildVersionHeaders("v1").`
      ).toMatch(/buildVersionHeaders|buildDeprecationHeaders/);
    });
  });
});

const fetchMock = vi.hoisted(() => vi.fn());

describe("POST/OPTIONS /api/v1/sign-project version header (#1099)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
  });

  async function loadRoute() {
    return import("@/app/api/v1/sign-project/route");
  }

  it("emits VERSION_HEADER on the POST proxy response", async () => {
    const { POST } = await loadRoute();
    const request = { text: () => Promise.resolve("{}"), headers: new Headers() };

    const response = await POST(request as never);

    expect(response.headers.get(VERSION_HEADER)).toBe("v1");
    expect(response.headers.get(LEGACY_HEADER_NAME)).toBeNull();
  });

  it("emits VERSION_HEADER on the OPTIONS preflight", async () => {
    const { OPTIONS } = await loadRoute();

    const response = await OPTIONS();

    expect(response.status).toBe(204);
    expect(response.headers.get(VERSION_HEADER)).toBe("v1");
    expect(response.headers.get(LEGACY_HEADER_NAME)).toBeNull();
  });
});
