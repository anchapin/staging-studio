import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { buildDeprecationHeaders } from "@/lib/api-version";
import { resolveAuthRedirect } from "@/lib/auth-redirect";
import { logger } from "@/lib/logger";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options as Parameters<typeof supabaseResponse.cookies.set>[2])
          );
        },
      },
    }
  );

  // Refresh session if expired. getUser() validates the JWT against the
  // Supabase auth server (signature + expiry); on error (forged/stale cookie,
  // invalid token) user is null and every branch below fails closed.
  let user = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch (err) {
    // Log structured auth error; continue with user=null so we fail closed
    logger.warn(
      { event: "auth_check_failed", path: request.nextUrl.pathname, error: err instanceof Error ? err.message : String(err) },
      "Supabase auth.getUser() threw — failing closed"
    );
  }

  // Note: /preview/:id (the PDF-export print route) self-guards via
  // src/lib/preview-access.ts (signed token or owning session) — it sits
  // outside the protected prefixes and passes through middleware in both
  // directions. The former signed-token bypass here for the removed
  // /projects/:id/preview route was deleted (issue #715).

  // Redirect decision matrix (see src/lib/auth-redirect.ts):
  // unauthenticated → /login for protected prefixes (/dashboard,
  // /projects, /settings), authenticated → /dashboard for the /login
  // prefix, otherwise pass through. `/setup` passes through in both
  // directions: middleware cannot consult Postgres (edge runtime), so
  // the setup page self-guards server-side (resolveSetupPageTarget) —
  // this is what lets an authenticated user WITHOUT a Prisma User row
  // reach setup instead of dead-ending.
  const pathname = request.nextUrl.pathname;
  const authenticated = Boolean(user);
  const redirectTarget = resolveAuthRedirect(pathname, authenticated);
  if (redirectTarget) {
    return NextResponse.redirect(new URL(redirectTarget, request.url));
  }

  if (pathname.startsWith("/api/") && !pathname.startsWith("/api/v1/")) {
    for (const [key, value] of Object.entries(buildDeprecationHeaders())) {
      supabaseResponse.headers.set(key, value);
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
