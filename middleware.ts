import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { resolveAuthRedirect } from "@/lib/auth-redirect";
import {
  PREVIEW_TOKEN_QUERY_PARAM,
  verifyPreviewToken,
} from "@/lib/preview-token";

// Exact preview path: /projects/:id/preview. Segment-anchored so the token
// bypass cannot be smuggled through prefix-match quirks like /projectsXYZ.
const PREVIEW_PATH_PATTERN = /^\/projects\/([^/]+)\/preview$/;

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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Signed preview-token bypass: the PDF exporter (Browserless) is a
  // cookie-less headless browser, so it cannot authenticate with session
  // cookies. It instead presents a short-lived HMAC token scoped to one
  // projectId. A valid, unexpired, projectId-matching token is treated as
  // authenticated FOR THIS REQUEST ONLY — resolveAuthRedirect semantics are
  // unchanged (pinned by tests/auth-redirect.test.ts).
  const pathname = request.nextUrl.pathname;
  let authenticated = Boolean(user);
  const previewMatch = PREVIEW_PATH_PATTERN.exec(pathname);
  if (!authenticated && previewMatch) {
    const token = request.nextUrl.searchParams.get(PREVIEW_TOKEN_QUERY_PARAM);
    if (token) {
      const verification = await verifyPreviewToken(token);
      if (verification.valid && verification.projectId === previewMatch[1]) {
        authenticated = true;
      }
    }
  }

  // Redirect decision matrix (see src/lib/auth-redirect.ts):
  // unauthenticated → /login for protected prefixes (/dashboard,
  // /projects, /settings), authenticated → /dashboard for the /login
  // prefix, otherwise pass through. `/setup` passes through in both
  // directions: middleware cannot consult Postgres (edge runtime), so
  // the setup page self-guards server-side (resolveSetupPageTarget) —
  // this is what lets an authenticated user WITHOUT a Prisma User row
  // reach setup instead of dead-ending.
  const redirectTarget = resolveAuthRedirect(pathname, authenticated);
  if (redirectTarget) {
    return NextResponse.redirect(new URL(redirectTarget, request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
