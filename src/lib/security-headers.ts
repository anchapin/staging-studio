/**
 * Security headers applied by `next.config.ts` to every response.
 *
 * The Content-Security-Policy in particular is the load-bearing piece:
 * it gates every fetch the browser makes (auth, storage, images, model
 * calls). Changes here must be reviewed against the production allowlist
 * — every host added widens the browser's trust surface.
 *
 * @see issue #1076 for why `http://127.0.0.1:*` appears in `connect-src`
 *   and `img-src` (hermetic e2e harness).
 */
export interface SecurityHeader {
  key: string;
  value: string;
}

/**
 * Content-Security-Policy applied to every response.
 *
 * Issue #1076: the hermetic e2e harness serves Supabase auth + Storage on
 * a loopback port (127.0.0.1:39911) so the suite never contacts real
 * services. Different port = different origin, so CSP must allow it
 * explicitly. `http://127.0.0.1:*` scopes the relaxation to loopback
 * only — no production surface (Vercel sets `NEXT_PUBLIC_SUPABASE_URL`
 * to *.supabase.co and never 127.0.0.1). The Dana rig entrypoint
 * (docs/dana-rig/docker/entrypoint-app.sh) injects the same wildcard
 * into CSP at runtime; the committed value here keeps `npm run e2e`
 * working without that rig.
 */
export const CSP_VALUE = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: http://127.0.0.1:* https://*.supabase.co https://*.fal.ai https://*.openai.com https://*.openai-api.com https://picsum.photos https://browserless.io",
  "connect-src 'self' http://127.0.0.1:* wss://127.0.0.1:* https://*.supabase.co https://*.fal.ai https://api.openai.com https://api.openai-api.com wss://*.supabase.co",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join("; ");

/**
 * Security headers applied to every response via `next.config.ts`.
 *
 * Ordering matters for readability, not for security — every header is
 * applied independently. Keep this list aligned with the project's
 * threat model (no third-party script tags, no framing, no referrer
 * leakage to third-party origins).
 */
export const SECURITY_HEADERS: readonly SecurityHeader[] = [
  { key: "Content-Security-Policy", value: CSP_VALUE },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), interest-cohort=()",
  },
] as const;
