import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClientSingleton } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function Home() {
  const cookieStore = await cookies();

  const supabase = createServerClientSingleton({
    getAll() {
      return cookieStore.getAll();
    },
    setAll(cookiesToSet) {
      try {
        cookiesToSet.forEach(({ name, value, options }) =>
          cookieStore.set(name, value, options as Parameters<typeof cookieStore.set>[2])
        );
      } catch {
        // Server Components cannot write cookies; middleware refreshes them.
      }
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  redirect(user ? "/projects" : "/login");
}
