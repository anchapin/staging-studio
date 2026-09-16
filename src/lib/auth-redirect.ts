/**
 * Pure decision function extracted from the root `middleware.ts`.
 *
 * Encodes EXACTLY the current middleware semantics — including the
 * surprising ones: every guard uses prefix matching (`startsWith`), so
 * e.g. `/projectsXYZ` matches the `/projects` guard and `/loginfoo`
 * matches the `/login` guard. Do not "fix" that here without changing
 * middleware behavior intentionally.
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
