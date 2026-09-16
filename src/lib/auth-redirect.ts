/**
 * Pure decision functions extracted from the root `middleware.ts` and the
 * server-side route gates.
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
 * `/dashboard` and `/projects`; the auth-page prefix is `/login`.
 * Protected + unauthenticated → `/login`; `/login` + authenticated →
 * `/dashboard`; otherwise no redirect.
 *
 * `/setup` intentionally passes through in both directions: middleware
 * runs on the edge runtime and cannot consult Postgres, so it cannot
 * distinguish an authenticated user WITH a Prisma `User` row (should be
 * bounced to `/dashboard`) from one WITHOUT a row (must reach `/setup`
 * or password-first signups hit a permanent dead-end). The setup page
 * (`src/app/(auth)/setup/page.tsx`) performs that check server-side via
 * `resolveSetupPageTarget` below, preserving the old observable
 * behavior for users that already have a row.
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

  // Authenticated users hitting the login page → dashboard. `/setup` is
  // NOT included here: it self-guards server-side (see
  // `resolveSetupPageTarget`), because middleware has no DB access.
  if (isAuthenticated && pathname.startsWith("/login")) {
    return "/dashboard";
  }

  // Everything else passes through
  return null;
}

/**
 * Computes where (if anywhere) the `/setup` page should send a visitor.
 *
 * Purpose: pure, testable twin of the server-side gate in
 * `src/app/(auth)/setup/page.tsx`. Middleware cannot make this decision
 * (edge runtime, no Prisma), so the page itself resolves it after
 * validating the session and looking up the Prisma `User` row.
 *
 * Contract:
 * - No valid session → `/login` (fail closed; same destination the old
 *   client-side effect used).
 * - Session + existing `User` row → `/dashboard` (setup already
 *   complete; mirrors what middleware used to do for ALL authenticated
 *   visitors, now narrowed to only those who need it).
 * - Session + no row → `null` (render the setup form — this is the
 *   path unblocked for password-first signups, issue #94).
 *
 * Side effects: none — pure function, no env vars or I/O.
 *
 * @param isAuthenticated Whether `supabase.auth.getUser()` validated a
 *   real session (with a usable email).
 * @param hasUserRow Whether a Prisma `User` row exists for the session
 *   email.
 * @returns The redirect target URL, or `null` to render the setup form.
 */
export function resolveSetupPageTarget(
  isAuthenticated: boolean,
  hasUserRow: boolean
): string | null {
  if (!isAuthenticated) return "/login";
  if (hasUserRow) return "/dashboard";
  return null;
}
