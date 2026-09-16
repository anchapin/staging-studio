import { createBrowserClient, createServerClient } from "@supabase/ssr";
import { requireEnvVars } from "@/lib/env";

const globalForSupabaseBrowser = globalThis as unknown as {
  supabaseBrowser: ReturnType<typeof createBrowserClient> | undefined;
};

export function createClient() {
  const env = requireEnvVars("NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return (
    globalForSupabaseBrowser.supabaseBrowser ??
    createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  );
}

if (
  process.env.NODE_ENV !== "production" &&
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)
  globalForSupabaseBrowser.supabaseBrowser = createClient();

export function createServerClientSingleton(
  cookies: {
    getAll(): { name: string; value: string }[];
    setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]): void;
  }
) {
  const env = requireEnvVars("NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies,
  });
}

export async function createSupabaseRequestClient() {
  // Lazily imported: this module is also bundled for the browser (login page),
  // and a static next/headers import breaks the client build.
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();

  return createServerClientSingleton({
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
}
