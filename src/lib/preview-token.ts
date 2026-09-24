/**
 * Minimal HMAC-signed, short-lived preview tokens.
 *
 * Purpose: the PDF exporter (Browserless headless Chrome) is a cookie-less
 * browser, so it cannot authenticate with a session and the printable
 * lookbook page (`/preview/:id`) would deny it access (it grants access
 * only to an owning session or a valid token). The export route instead
 * mints a token scoped to one projectId with a 5-minute TTL, appends it
 * to the preview URL, and the preview page verifies it (via
 * src/lib/preview-access.ts) before granting access.
 *
 * Runtime note: sign/verify use the Web Crypto API (`crypto.subtle`) rather
 * than `node:crypto`, keeping the module runtime-agnostic — Web Crypto
 * behaves identically in the Edge runtime, the Node server runtime, and
 * the vitest node environment (Node >= 18 exposes `globalThis.crypto`).
 *
 * Secret: `PREVIEW_TOKEN_SECRET`. When the variable is unset or empty, a
 * fixed DEV-ONLY fallback value is used so local development and CI (which
 * run with no secrets) keep working. The fallback is public by design and
 * NOT a secret — production deployments must set `PREVIEW_TOKEN_SECRET`
 * (e.g. `openssl rand -base64 32`); nothing throws at import time either way.
 *
 * Security properties:
 * - Forgery requires the secret (HMAC-SHA256 over the exact payload text).
 * - Tokens expire (embedded `exp`, default 5 minutes) — `verify` rejects
 *   expired tokens and never throws on malformed input.
 * - Tokens are scoped: `verify` returns the signed projectId; callers
 *   (the preview page, via src/lib/preview-access.ts) MUST compare it to
 *   the URL's own projectId, so a token minted for project A cannot
 *   unlock project B.
 */

/** Query param the signed token travels in on the preview URL. */
export const PREVIEW_TOKEN_QUERY_PARAM = "token";

/** Default token lifetime: 5 minutes, in seconds. */
export const PREVIEW_TOKEN_TTL_SECONDS = 5 * 60;

/**
 * DEV-ONLY fallback. Public on purpose; documented here and in .env.example.
 * Production MUST set PREVIEW_TOKEN_SECRET.
 */
const DEV_FALLBACK_SECRET =
  "staging-studio-dev-only-preview-token-secret-do-not-use-in-production";

function getSecret(): string {
  const secret = process.env.PREVIEW_TOKEN_SECRET;
  if (secret && secret.trim() !== "") {
    if (
      process.env.NODE_ENV === "production" &&
      secret === DEV_FALLBACK_SECRET
    ) {
      throw new Error(
        "PREVIEW_TOKEN_SECRET is set to the known DEV-ONLY fallback value. " +
          "Generate a real secret with: openssl rand -base64 32"
      );
    }
    return secret;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "PREVIEW_TOKEN_SECRET is not set. " +
        "Generate a real secret with: openssl rand -base64 32"
    );
  }
  return DEV_FALLBACK_SECRET;
}

interface PreviewTokenPayload {
  projectId: string;
  /** Expiry, Unix seconds. */
  exp: number;
}

/**
 * Discriminated result of {@link verifyPreviewToken}: on `valid: true`
 * the `projectId` is the one that was signed and MUST be compared to the
 * URL's own projectId; `valid: false` covers missing, malformed,
 * forged, and expired tokens alike.
 */
export type PreviewTokenVerificationResult =
  | { valid: true; projectId: string }
  | { valid: false };

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

const encoder = new TextEncoder();

async function importHmacKey(usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages
  );
}

/** Mint a signed token scoped to `projectId`, valid for `ttlSeconds`. */
export async function signPreviewToken(
  projectId: string,
  ttlSeconds: number = PREVIEW_TOKEN_TTL_SECONDS
): Promise<string> {
  const payload: PreviewTokenPayload = {
    projectId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encodedPayload = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await importHmacKey(["sign"]);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(encodedPayload)
  );
  return `${encodedPayload}.${toBase64Url(new Uint8Array(signature))}`;
}

/**
 * Verify a token's signature and expiry. Pure and total: any malformed,
 * forged, or expired input returns `{ valid: false }` instead of throwing.
 * Returns the signed projectId so callers can enforce the URL match.
 */
export async function verifyPreviewToken(
  token: string | null | undefined
): Promise<PreviewTokenVerificationResult> {
  try {
    if (!token) return { valid: false };

    const parts = token.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return { valid: false };
    }
    const [encodedPayload, encodedSignature] = parts;

    let payload: PreviewTokenPayload;
    try {
      payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encodedPayload)));
    } catch {
      return { valid: false };
    }
    if (
      typeof payload?.projectId !== "string" ||
      payload.projectId === "" ||
      typeof payload?.exp !== "number" ||
      !Number.isFinite(payload.exp)
    ) {
      return { valid: false };
    }

    const expired = payload.exp <= Math.floor(Date.now() / 1000);
    const signatureValid = await crypto.subtle.verify(
      "HMAC",
      await importHmacKey(["verify"]),
      fromBase64Url(encodedSignature),
      encoder.encode(encodedPayload)
    );

    if (!signatureValid || expired) return { valid: false };
    return { valid: true, projectId: payload.projectId };
  } catch {
    return { valid: false };
  }
}
