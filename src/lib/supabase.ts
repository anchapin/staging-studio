import { createBrowserClient, createServerClient } from "@supabase/ssr";

const globalForSupabaseBrowser = globalThis as unknown as {
  supabaseBrowser: ReturnType<typeof createBrowserClient> | undefined;
};

export function createClient() {
  return (
    globalForSupabaseBrowser.supabaseBrowser ??
    createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
  );
}

if (process.env.NODE_ENV !== "production")
  globalForSupabaseBrowser.supabaseBrowser = createClient();

export function createServerClientSingleton(
  cookies: {
    getAll(): { name: string; value: string }[];
    setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]): void;
  }
) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies,
    }
  );
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
