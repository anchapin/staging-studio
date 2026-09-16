import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return [];
          },
          setAll() {},
        },
      }
    );

    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data?.user) {
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
