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

  const { prisma } = await import("@/lib/prisma");
  const userRecord = await prisma.user.findUnique({
    where: { email: data.user.email },
  });

  response.headers.set(
    "Location",
    new URL(userRecord ? "/dashboard" : "/setup", request.url).toString()
  );

  return response;
}
