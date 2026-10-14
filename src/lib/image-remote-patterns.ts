/**
 * Single source of truth for the hermetic-e2e loopback image gate.
 *
 * Purpose: the e2e harness needs next/image to resolve http://127.0.0.1 and
 * http://localhost URLs (mock Supabase storage, local fixtures) and
 * room-patch payloads to accept them. Production NEVER wants either
 * relaxation — a loopback URL written to `Room.afterImageUrl` would
 * render through `<Image src>` server-side and let the optimizer fetch
 * the app's own loopback (SSRF surface, even behind auth). Issue #1112
 * gates both behind the same env var so the two files can't drift.
 *
 * Env var: {@link E2E_HERMETIC_ENV_VAR} === "1". Deliberately NOT
 * NODE_ENV-gated — the e2e suite runs a production build (`next build
 * && next start`), so NODE_ENV is already "production" in exactly the
 * run that needs the relaxation. Set ONLY by `tests/e2e/env.ts`; do not
 * set in dev or production `.env.local` files.
 *
 * Used by:
 * - `next.config.ts` (loopback remotePatterns + dangerouslyAllowLocalIP)
 * - `src/lib/room-patch-schema.ts` (loopback URL acceptance)
 * - `tests/image-remote-patterns.test.ts` (pinning both behaviors)
 */
export const E2E_HERMETIC_ENV_VAR = "E2E_HERMETIC";

/**
 * Returns true when the e2e harness relaxations may take effect.
 *
 * Contract: returns true ONLY when the supplied flag is exactly "1"
 * (after trimming); any other value — undefined, "", "  ", "0",
 * "true", "yes" — returns false. Mirrors the predicate in
 * `lib/browserless.ts`'s `resolveBrowserlessPdfUrl` so the two gates
 * share one shape; both reject the same stray values. Pure — the caller
 * passes the env value in so the function is testable without mutating
 * `process.env`.
 *
 * Side effects: none.
 */
export function isLoopbackImageAllowed(hermetic: string | undefined): boolean {
  return hermetic?.trim() === "1";
}

/**
 * The loopback `remotePatterns` entries to merge into
 * `next.config.ts`'s `images.remotePatterns`. Returns the http loopback
 * entries ONLY when the hermetic flag is "1"; otherwise returns an
 * empty array so production keeps the SSRF guard tight. Pure.
 *
 * Side effects: none.
 */
export function buildLoopbackRemotePatterns(
  hermetic: string | undefined
): Array<{ protocol: "http"; hostname: string }> {
  if (!isLoopbackImageAllowed(hermetic)) return [];
  return [
    { protocol: "http", hostname: "127.0.0.1" },
    { protocol: "http", hostname: "localhost" },
  ];
}

/**
 * Whether `next.config.ts` should set `images.dangerouslyAllowLocalIP`.
 * True ONLY under the hermetic flag; otherwise the optimizer's SSRF
 * guard for private IPs stays on. Pure.
 *
 * Side effects: none.
 */
export function shouldAllowLocalIp(hermetic: string | undefined): boolean {
  return isLoopbackImageAllowed(hermetic);
}