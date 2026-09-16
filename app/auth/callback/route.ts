import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";
import { prisma } from "@/lib/prisma";

export default async function AuthCallback({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; next?: string }>;
}) {
  const params = await searchParams;
  const code = params.code;

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
      // Check if user has a User record (first-run check)
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
