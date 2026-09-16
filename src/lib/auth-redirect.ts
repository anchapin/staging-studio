/**
 * Pure decision function extracted from the root `middleware.ts`.
 *
 * Encodes EXACTLY the current middleware semantics — including the
 * surprising ones: every guard uses prefix matching (`startsWith`), so
 * e.g. `/projectsXYZ` matches the `/projects` guard and `/loginfoo`
 * matches the `/login` guard. Do not "fix" that here without changing
 * middleware behavior intentionally.
 */
/**
 * Computes where (if anywhere) a request should be redirected for auth.
 *
 * Purpose: pure, testable twin of the routing rules in root
 * `middleware.ts`; middleware calls this and acts on the result.
 *
 * Contract: see the module doc above — guards are PREFIX matches, so
 * e.g. `/projectsXYZ` is treated as protected. Protected prefixes are
 * `/dashboard` and `/projects`; auth-page prefixes are `/login` and
 * `/setup`. Protected + unauthenticated → `/login`; auth page +
 * authenticated → `/dashboard`; otherwise no redirect.
 *
 * Side effects: none — pure function, no env vars or I/O.
 *
 * @param pathname The request path, as received by middleware.
 * @param isAuthenticated Whether `supabase.auth.getUser()` validated a
 *   real session for this request.
 * @returns The redirect target URL, or `null` to pass through.
 */
export function resolveAuthRedirect(
  pathname: string,
  isAuthenticated: boolean
): string | null {
  // Unauthenticated users hitting protected route prefixes → login
  if (
    !isAuthenticated &&
    (pathname.startsWith("/dashboard") || pathname.startsWith("/projects"))
  ) {
    return "/login";
  }

  // Authenticated users hitting auth-page prefixes → dashboard
  if (
    isAuthenticated &&
    (pathname.startsWith("/login") || pathname.startsWith("/setup"))
  ) {
    return "/dashboard";
  }

  // Everything else passes through
  return null;
}
