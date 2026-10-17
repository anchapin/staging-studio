/**
 * Shared-secret webhook signature verification (issue #1221).
 *
 * Envelope is Replicate-style so the Replicate adapter, the fal
 * delivery mode, and the test mock all speak one format:
 *
 *   webhook-signature: t=<unixSeconds>,v1=<hex HMAC-SHA256>
 *
 * The MAC covers `<t>.<rawBody>` with the shared secret from
 * `INPAINT_WEBHOOK_SECRET`, so both a tampered body and a stale
 * delivery (replay past REPLAY_WINDOW_SECONDS) reject.
 *
 * Web Crypto (`crypto.subtle`) per AGENTS.md: middleware and edge
 * deployments have no node:crypto. Node runtimes expose the same
 * global, so this module works in both.
 */

export const WEBHOOK_SIGNATURE_HEADER = "webhook-signature";

/** Deliveries older than this are treated as replays (issue #1221). */
export const WEBHOOK_REPLAY_WINDOW_SECONDS = 5 * 60;

export type WebhookVerificationResult =
  | { ok: true }
  | { ok: false; reason: "missing_header" | "malformed_header" | "bad_signature" | "replayed" };

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  // Constant-time-ish compare over equal-length hex strings.
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return toHex(new Uint8Array(mac));
}

/**
 * Verifies a signed webhook delivery against the raw request body.
 * `headerValue` is the verbatim `webhook-signature` header. Never
 * throws on attacker-controlled input: every failure is a typed
 * rejection so the route can map it to 401 and write nothing.
 */
export async function verifyWebhookSignature(
  headerValue: string | null | undefined,
  rawBody: string,
  secret: string,
  nowMs: number = Date.now()
): Promise<WebhookVerificationResult> {
  if (!headerValue) {
    return { ok: false, reason: "missing_header" };
  }

  const parts = new Map<string, string>();
  for (const piece of headerValue.split(",")) {
    const eq = piece.indexOf("=");
    if (eq <= 0) continue;
    parts.set(piece.slice(0, eq).trim(), piece.slice(eq + 1).trim());
  }
  const timestamp = parts.get("t");
  const signature = parts.get("v1");
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) {
    return { ok: false, reason: "malformed_header" };
  }

  const ageSeconds = Math.abs(nowMs / 1000 - Number(timestamp));
  if (ageSeconds > WEBHOOK_REPLAY_WINDOW_SECONDS) {
    return { ok: false, reason: "replayed" };
  }

  const expected = await hmacSha256Hex(secret, `${timestamp}.${rawBody}`);
  if (!timingSafeEqualHex(expected, signature.toLowerCase())) {
    return { ok: false, reason: "bad_signature" };
  }

  return { ok: true };
}

/** Signs a delivery the same way production providers do; used by the mock and the probe. */
export async function signWebhookPayload(
  rawBody: string,
  secret: string,
  timestampSeconds: number = Math.floor(Date.now() / 1000)
): Promise<string> {
  const mac = await hmacSha256Hex(secret, `${timestampSeconds}.${rawBody}`);
  return `t=${timestampSeconds},v1=${mac}`;
}
