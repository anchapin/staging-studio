import { describe, expect, it } from "vitest";

import {
  resolveAuthRedirect,
  resolveSetupPageTarget,
} from "@/lib/auth-redirect";

/**
 * Pins the middleware auth redirect decision matrix exactly as
 * `resolveAuthRedirect` implements it. Every guard uses PREFIX
 * matching (`startsWith`) — including the auth page — which means
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
  { pathname: "/settings", isAuthenticated: false, expected: "/login" },

  // Unauthenticated → public paths pass through
  { pathname: "/", isAuthenticated: false, expected: null },
  { pathname: "/login", isAuthenticated: false, expected: null },
  { pathname: "/setup", isAuthenticated: false, expected: null },

  // Authenticated → the /login prefix redirects to /dashboard
  { pathname: "/login", isAuthenticated: true, expected: "/dashboard" },

  // Authenticated → /setup passes through in BOTH directions: middleware
  // runs on the edge runtime with no DB access, so it cannot tell an
  // authenticated user WITH a Prisma User row (should bounce to
  // /dashboard) from one WITHOUT (must reach /setup or password-first
  // signups dead-end). The setup page self-guards server-side via
  // resolveSetupPageTarget — issue #94.
  { pathname: "/setup", isAuthenticated: true, expected: null },

  // Authenticated → app paths pass through
  { pathname: "/dashboard", isAuthenticated: true, expected: null },
  { pathname: "/projects/new", isAuthenticated: true, expected: null },
  { pathname: "/settings", isAuthenticated: true, expected: null },
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
    pathname: "/settingsXYZ",
    isAuthenticated: false,
    expected: "/login",
    note: "prefix match: /settings matches /settingsXYZ (same startsWith quirk as /projects and /dashboard)",
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
    expected: null,
    note: "prefix match is moot for /setup: the guard was removed, so even /setuppage passes through",
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

/**
 * Pins the server-side /setup gate (rendered by
 * src/app/(auth)/setup/page.tsx, which middleware deliberately defers
 * to because the edge runtime has no DB access). Matrix: session
 * present? × Prisma User row present?
 */
const setupCases: Array<{
  isAuthenticated: boolean;
  hasUserRow: boolean;
  expected: string | null;
  note?: string;
}> = [
  {
    isAuthenticated: false,
    hasUserRow: false,
    expected: "/login",
    note: "no session → login, regardless of row state",
  },
  {
    isAuthenticated: false,
    hasUserRow: true,
    expected: "/login",
    note: "no session → login even if a row somehow exists",
  },
  {
    isAuthenticated: true,
    hasUserRow: false,
    expected: null,
    note: "session without a User row → render the setup form (the unblocked path, issue #94)",
  },
  {
    isAuthenticated: true,
    hasUserRow: true,
    expected: "/dashboard",
    note: "session with a User row → setup already complete, bounce to dashboard (preserves the old middleware behavior for provisioned users)",
  },
];

describe("resolveSetupPageTarget", () => {
  it.each(setupCases)(
    "auth=$isAuthenticated row=$hasUserRow → $expected",
    ({ isAuthenticated, hasUserRow, expected }) => {
      expect(resolveSetupPageTarget(isAuthenticated, hasUserRow)).toBe(expected);
    }
  );
});
