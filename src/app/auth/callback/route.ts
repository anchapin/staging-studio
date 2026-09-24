import { type NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(
      new URL("/login?error=auth_callback_failed", request.url)
    );
  }

  const response = NextResponse.redirect(new URL("/dashboard", request.url));

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
      new URL("/login?error=auth_callback_failed", request.url)
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
