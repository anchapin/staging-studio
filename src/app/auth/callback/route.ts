import { type NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");

  // Apply rate limiting based on client IP
  // Rate limit: 5 Magic Link exchanges per IP per 10 minutes
  const clientIp = getClientIp(request);
  const { allowed, remaining, resetIn } = checkRateLimit(clientIp, 5, 10 * 60 * 1000);

  // Rate limit headers for debugging and client awareness
  const rateLimitHeaders = {
    "X-RateLimit-Remaining": String(remaining),
    "X-RateLimit-Reset": String(Math.ceil(resetIn / 1000)),
  };

  if (!allowed) {
    return NextResponse.redirect(
      new URL("/login?error=rate_limit_exceeded", request.url),
      { status: 302, headers: rateLimitHeaders }
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL("/login?error=auth_callback_failed", request.url),
      { headers: rateLimitHeaders }
    );
  }

  const response = NextResponse.redirect(new URL("/dashboard", request.url), {
    headers: rateLimitHeaders,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data?.user) {
    return NextResponse.redirect(
      new URL("/login?error=auth_callback_failed", request.url),
      { headers: rateLimitHeaders }
    );
  }

  // The session is now valid and auth cookies are set on `response` —
  // nothing below may throw and strand an authenticated user on a 500
  // mid-redirect (issue #91). Any Prisma lookup failure fails SAFE to
  // /dashboard: the dashboard layout's own row check (issue #94) bounces
  // users without a Prisma User row to /setup, so a dropped DB does not
  // change where a provisioned user lands and a missing row still gets
  // provisioned.
  const { prisma } = await import("@/lib/prisma");
  try {
    if (!data.user.email) {
      console.error(
        JSON.stringify({
          event: "auth_callback_lookup_failed",
          userId: data.user.id,
          reason: "missing_email",
        })
      );
    } else {
      await prisma.user.findUnique({
        where: { email: data.user.email },
      });
    }
  } catch (lookupError) {
    console.error(
      JSON.stringify({
        event: "auth_callback_lookup_failed",
        userId: data.user.id,
        reason: "prisma_error",
      }),
      lookupError
    );
  }

  return response;
}
