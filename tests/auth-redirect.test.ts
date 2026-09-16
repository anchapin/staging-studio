import { describe, expect, it } from "vitest";

import { resolveAuthRedirect } from "@/lib/auth-redirect";

/**
 * Pins the middleware auth redirect decision matrix exactly as the
 * original middleware.ts implemented it. Every guard uses PREFIX
 * matching (`startsWith`) — including the auth pages — which means
 * paths like `/projectsXYZ` or `/loginfoo` match guards they were
 * never meant to match. Those quirks are intentional observations,
 * not bugs being blessed: they are pinned here so any deliberate
 * change shows up as an explicit, reviewed test failure.
 */
const cases: Array<{
  pathname: string;
  isAuthenticated: boolean;
  expected: string | null;
  note?: string;
}> = [
  // Unauthenticated → protected prefixes redirect to /login
  { pathname: "/dashboard", isAuthenticated: false, expected: "/login" },
  { pathname: "/projects", isAuthenticated: false, expected: "/login" },
  { pathname: "/projects/abc", isAuthenticated: false, expected: "/login" },
  { pathname: "/projects/new", isAuthenticated: false, expected: "/login" },

  // Unauthenticated → public paths pass through
  { pathname: "/", isAuthenticated: false, expected: null },
  { pathname: "/login", isAuthenticated: false, expected: null },
  { pathname: "/setup", isAuthenticated: false, expected: null },

  // Authenticated → auth-page prefixes redirect to /dashboard
  { pathname: "/login", isAuthenticated: true, expected: "/dashboard" },
  { pathname: "/setup", isAuthenticated: true, expected: "/dashboard" },

  // Authenticated → app paths pass through
  { pathname: "/dashboard", isAuthenticated: true, expected: null },
  { pathname: "/projects/new", isAuthenticated: true, expected: null },
  { pathname: "/", isAuthenticated: true, expected: null },

  // Surprising PREFIX-match semantics (startsWith everywhere) — pinned as-is.
  // "/projectsXYZ" matches the "/projects" guard: prefix match, not segment match.
  {
    pathname: "/projectsXYZ",
    isAuthenticated: false,
    expected: "/login",
    note: "prefix match: /projects matches /projectsXYZ",
  },
  {
    pathname: "/dashboardfoo",
    isAuthenticated: false,
    expected: "/login",
    note: "prefix match: /dashboard matches /dashboardfoo",
  },
  {
    pathname: "/loginfoo",
    isAuthenticated: true,
    expected: "/dashboard",
    note: "prefix match: /login matches /loginfoo (auth pages use startsWith too, not exact match)",
  },
  {
    pathname: "/setuppage",
    isAuthenticated: true,
    expected: "/dashboard",
    note: "prefix match: /setup matches /setuppage",
  },

  // Case sensitivity: matching is case-sensitive; uppercase variants pass through.
  {
    pathname: "/Dashboard",
    isAuthenticated: false,
    expected: null,
    note: "case-sensitive: /Dashboard does not match /dashboard",
  },
  {
    pathname: "/Projects",
    isAuthenticated: false,
    expected: null,
    note: "case-sensitive: /Projects does not match /projects",
  },

  // Query strings / trailing details live on pathname only; bare prefixes count.
  {
    pathname: "/projects/",
    isAuthenticated: false,
    expected: "/login",
    note: "trailing slash still starts with /projects",
  },
];

describe("resolveAuthRedirect", () => {
  it.each(cases)(
    "$isAuthenticated ? authed : unauthed  $pathname → $expected",
    ({ pathname, isAuthenticated, expected }) => {
      expect(resolveAuthRedirect(pathname, isAuthenticated)).toBe(expected);
    }
  );

  it("returns null for an empty pathname (pass through)", () => {
    expect(resolveAuthRedirect("", false)).toBeNull();
    expect(resolveAuthRedirect("", true)).toBeNull();
  });
});
