/**
 * Webhook signature (issue #1221) — HMAC verification contract:
 * - valid signature within the replay window verifies
 * - wrong signature, wrong secret, and malformed headers reject
 * - replayed (older than the window) signatures reject
 * - the signed string is `<timestamp>.<rawBody>`, verified against the
 *   RAW bytes, so any payload mutation invalidates the signature
 * - clock contract: sign takes unix SECONDS, verify takes ms
 */

import { describe, expect, it } from "vitest";
import { webcrypto } from "node:crypto";

import {
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_REPLAY_WINDOW_SECONDS,
  signWebhookPayload,
  verifyWebhookSignature,
} from "@/lib/webhook-signature";

// The lib uses Web Crypto (edge-runtime rule); node:crypto's webcrypto
// is the same standard interface under vitest's node environment.
const subtle = webcrypto.subtle;
const encoder = new TextEncoder();

const SECRET = "whsec_test_secret_123";
const BODY = JSON.stringify({ type: "queue.status.updated", request_id: "job-1" });
const SENT_AT_SECONDS = 1_700_000_000;
const SENT_AT_MS = SENT_AT_SECONDS * 1000;

describe("webhook signature contract", () => {
  it("exposes the header name and a 5-minute replay window", () => {
    expect(WEBHOOK_SIGNATURE_HEADER).toBe("webhook-signature");
    expect(WEBHOOK_REPLAY_WINDOW_SECONDS).toBe(300);
  });

  it("verifies a freshly signed delivery", async () => {
    const header = await signWebhookPayload(BODY, SECRET, SENT_AT_SECONDS);
    const result = await verifyWebhookSignature(header, BODY, SECRET, SENT_AT_MS);
    expect(result.ok).toBe(true);
  });

  it("rejects a signature computed with a different secret", async () => {
    const header = await signWebhookPayload(BODY, "whsec_other", SENT_AT_SECONDS);
    const result = await verifyWebhookSignature(header, BODY, SECRET, SENT_AT_MS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("bad_signature");
  });

  it("rejects a tampered payload (signature is over the raw body)", async () => {
    const header = await signWebhookPayload(BODY, SECRET, SENT_AT_SECONDS);
    const tampered = BODY.replace("job-1", "job-2");
    const result = await verifyWebhookSignature(header, tampered, SECRET, SENT_AT_MS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("bad_signature");
  });

  it("rejects a delivery older than the replay window", async () => {
    const header = await signWebhookPayload(BODY, SECRET, SENT_AT_SECONDS);
    const arrivedAt = SENT_AT_MS + (WEBHOOK_REPLAY_WINDOW_SECONDS + 1) * 1000;
    const result = await verifyWebhookSignature(header, BODY, SECRET, arrivedAt);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("replayed");
  });

  it("rejects missing and malformed headers", async () => {
    const missing = await verifyWebhookSignature("", BODY, SECRET, SENT_AT_MS);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toBe("missing_header");

    const malformed = await verifyWebhookSignature("garbage", BODY, SECRET, SENT_AT_MS);
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.reason).toBe("malformed_header");
  });

  it("accepts a delivery up to the last second of the replay window", async () => {
    const header = await signWebhookPayload(BODY, SECRET, SENT_AT_SECONDS);
    const arrivedAt = SENT_AT_MS + WEBHOOK_REPLAY_WINDOW_SECONDS * 1000;
    const result = await verifyWebhookSignature(header, BODY, SECRET, arrivedAt);
    expect(result.ok).toBe(true);
  });

  it("signs as `t=<unixSeconds>,v1=<hex>` using HMAC-SHA256 over <t>.<body>", async () => {
    const header = await signWebhookPayload(BODY, SECRET, SENT_AT_SECONDS);
    expect(header).toMatch(/^t=1700000000,v1=[0-9a-f]{64}$/);

    // Independent recomputation with the standard Web Crypto interface.
    const key = await subtle.importKey(
      "raw",
      encoder.encode(SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const mac = await subtle.sign(
      "HMAC",
      key,
      encoder.encode(`1700000000.${BODY}`)
    );
    const expected = Array.from(new Uint8Array(mac))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    expect(header.endsWith(expected)).toBe(true);
  });
});
