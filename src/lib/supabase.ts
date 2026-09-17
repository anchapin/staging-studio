import { createBrowserClient, createServerClient } from "@supabase/ssr";
import { MissingEnvVarsError, requireEnvVars } from "@/lib/env";

const globalForSupabaseBrowser = globalThis as unknown as {
  supabaseBrowser: ReturnType<typeof createBrowserClient> | undefined;
};

/**
 * Browser-side Supabase client (React components, client components).
 *
 * Purpose: the ONLY sanctioned way to build a Supabase client in browser
 * code. Returns a memoized singleton so repeated calls share one client
 * instance (GoTrueClient deduplication).
 *
 * Side effects: reads `NEXT_PUBLIC_SUPABASE_URL` and
 * `NEXT_PUBLIC_SUPABASE_ANON_KEY` via literal `process.env` member
 * expressions so Next.js inlines them into the client bundle at build
 * time — dynamic `process.env[name]` access (as in `requireEnvVars`) is
 * NOT inlined and would be `undefined` in the browser. Throws
 * `MissingEnvVarsError` if either is missing. Reads/writes the
 * session in localStorage via the default `@supabase/ssr` browser storage.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const missing = [
    ...(url === undefined || url.trim() === "" ? ["NEXT_PUBLIC_SUPABASE_URL"] : []),
    ...(anonKey === undefined || anonKey.trim() === "" ? ["NEXT_PUBLIC_SUPABASE_ANON_KEY"] : []),
  ];
  if (missing.length > 0) throw new MissingEnvVarsError(missing);
  return (
    globalForSupabaseBrowser.supabaseBrowser ??
    createBrowserClient(url as string, anonKey as string)
  );
}

if (
  process.env.NODE_ENV !== "production" &&
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)
  globalForSupabaseBrowser.supabaseBrowser = createClient();

/**
 * Server-side Supabase client for Server Components, route handlers, and
 * server actions.
 *
 * Purpose: wraps `createServerClient` from `@supabase/ssr` with this
 * app's env wiring. This is the ONLY sanctioned server-side construction
 * site — route handlers and server actions should usually prefer the
 * request-scoped `createSupabaseRequestClient()` instead.
 *
 * CRITICAL cookie-adapter contract: callers MUST pass an object with the
 * EXACT `{ getAll, setAll }` shape shown here and exemplified in
 * `src/app/page.tsx`:
 *
 *   createServerClientSingleton({
 *     getAll() { ... }   // → { name, value }[] read from the request cookies
 *     setAll(list) { ... } // write every { name, value, options? } entry
 *   })
 *
 * If `getAll`/`setAll` are absent, renamed, or silently no-op, Supabase
 * auth cookies fail to refresh: `auth.getUser()` appears to work until a
 * token rotates, then sessions expire mid-request with no error surfaced.
 * In Server Components, `setAll` cannot write cookies — wrap it in
 * try/catch-and-ignore and let middleware refresh them (see
 * `createSupabaseRequestClient` below and `src/app/page.tsx`).
 *
 * Side effects: reads `NEXT_PUBLIC_SUPABASE_URL` and
 * `NEXT_PUBLIC_SUPABASE_ANON_KEY` at call time via `requireEnvVars` —
 * throws `MissingEnvVarsError` if either is missing. May set auth cookies
 * through the adapter during token refresh.
 *
 * @param cookies Cookie adapter. `getAll()` returns all request cookies
 *   as `{ name, value }[]`; `setAll(cookiesToSet)` persists every entry
 *   (`options` is the cookie options bag: maxAge, path, httpOnly, …).
 *   Neither may be omitted or stubbed out.
 * @returns A Supabase server client bound to the supplied cookie adapter.
 */
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

/**
 * Request-scoped Supabase server client for route handlers and server
 * actions.
 *
 * Purpose: builds a `createServerClientSingleton` with the canonical
 * `{ getAll, setAll }` cookie adapter wired to `next/headers`, so callers
 * don't hand-roll it. Use this in any request context where the session
 * must be read (and refreshed) per request.
 *
 * Behavior:
 * - `getAll` reads the incoming request cookies.
 * - `setAll` writes each cookie, swallowing failures in Server
 *   Components (they cannot mutate cookies) — middleware performs the
 *   actual refresh on matched routes. That try/catch-and-ignore is
 *   intentional, not a bug.
 *
 * Side effects: reads `NEXT_PUBLIC_SUPABASE_URL` /
 * `NEXT_PUBLIC_SUPABASE_ANON_KEY` via `requireEnvVars` (throws
 * `MissingEnvVarsError` when missing); may set auth cookies on the
 * outgoing response when called from a route handler or server action.
 *
 * @returns Promise resolving to a Supabase server client scoped to the
 *   current request's cookies.
 */
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
