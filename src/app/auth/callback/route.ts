import { redirect } from "next/navigation";
import { type NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

export default async function AuthCallback(
  request: NextRequest,
  { searchParams }: { searchParams: Promise<{ code?: string; next?: string }> }
) {
  const params = await searchParams;
  const code = params.code;
  const redirectTo = params.next ?? "/dashboard";

  if (code) {
    const supabaseResponse = NextResponse.redirect(
      new URL(redirectTo, request.url)
    );

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
              supabaseResponse.cookies.set(name, value, options)
            );
          },
        },
      }
    );

    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data?.user) {
      // Check if user exists in database; if not, redirect to setup
      const { prisma } = await import("@/lib/prisma");
      const userRecord = await prisma.user.findUnique({
        where: { email: data.user.email },
      });

      if (userRecord) {
        redirect("/dashboard");
      } else {
        redirect("/setup");
      }
    }
  }

  redirect("/login?error=auth_callback_failed");
}
