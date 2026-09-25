import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { componentLogger } from "@/lib/logger";

import { resolveAuthRedirect } from "@/lib/auth-redirect";

const log = componentLogger("middleware");

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const requestId =
    request.headers.get("x-request-id") ??
    request.headers.get("x-vercel-id") ??
    "unknown";

  const log = componentLogger("middleware").child({ requestId });

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
    // getUser() throws on network errors; fail closed (no user) and log
    log.error(
      { type: "session_refresh_error", error: err instanceof Error ? err.message : String(err) },
      "Session refresh failed — denying access"
    );
    // Continue with user=null so the protected-route logic below redirects to login
  }

  const pathname = request.nextUrl.pathname;
  const authenticated = Boolean(user);
  const redirectTarget = resolveAuthRedirect(pathname, authenticated);

  if (redirectTarget) {
    log.info(
      { type: "auth_redirect", from: pathname, to: redirectTarget, authenticated },
      `Redirecting unauthenticated request from ${pathname} to ${redirectTarget}`
    );
    return NextResponse.redirect(new URL(redirectTarget, request.url));
  }

  log.debug({ type: "middleware_pass", pathname, authenticated }, "Request passed through middleware");

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
