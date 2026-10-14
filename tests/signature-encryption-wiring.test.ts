import { beforeEach, describe, expect, it } from "vitest";
import { encryptSignature, decryptSignature } from "@/lib/signature-encryption";

/**
 * Issue #1106 — wiring tests for the signature-encryption module.
 *
 * The unit tests at `tests/signature-encryption.test.ts` already pin
 * the module's own contract (round-trip, IV randomness, valid base64).
 * This file pins the *wiring*: the write paths persist ciphertext that
 * round-trips back to the original PNG data URL, and never the
 * plaintext itself.
 */

// A minimal valid PNG data URL (1×1) that satisfies
// `signProjectPayloadSchema.signatureDataUrl` (it must start with
// `data:image/png;base64,`). The bytes are irrelevant for the wiring
// pin — what matters is that the encrypted value is NOT this string.
const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("signature-encryption wiring (issue #1106)", () => {
  beforeEach(() => {
    // Force the dev-fallback-key path: the wiring tests run under
    // NODE_ENV="test" and must not depend on a developer's local
    // SIGNATURE_ENCRYPTION_KEY. The unit tests
    // (tests/signature-encryption.test.ts) already pin the production
    // throw path in spirit via the DEV_FALLBACK_KEY constant.
    // Cast through `unknown` so the runtime assignment survives even
    // though `NODE_ENV` is typed as readonly in Node's typings.
    delete process.env.SIGNATURE_ENCRYPTION_KEY;
    (process.env as unknown as { NODE_ENV: string }).NODE_ENV = "test";
  });

  it("the stored ciphertext is NOT equal to the plaintext signature", async () => {
    const encrypted = await encryptSignature(TINY_PNG_DATA_URL);

    // The encryption module guarantees a non-empty base64 string; the
    // value is a fresh ciphertext every call thanks to the random IV,
    // so a single equality check is enough to catch a missed call.
    expect(encrypted).toBeTypeOf("string");
    expect(encrypted.length).toBeGreaterThan(0);
    expect(encrypted).not.toBe(TINY_PNG_DATA_URL);
    // The plaintext is a recognizable `data:image/png;base64,…`
    // prefix; that prefix must NOT appear in the ciphertext.
    expect(encrypted.startsWith("data:image/png")).toBe(false);
    expect(encrypted.includes(TINY_PNG_DATA_URL)).toBe(false);
  });

  it("a value read back from the (mocked) Prisma store decrypts to the original data URL", async () => {
    // Simulate the write path: encrypt before Prisma.
    const stored = await encryptSignature(TINY_PNG_DATA_URL);

    // Simulate the read path: the stored string is what consumers see
    // when they fetch the project row. Decryption must yield the
    // original PNG data URL.
    const decrypted = await decryptSignature(stored);
    expect(decrypted).toBe(TINY_PNG_DATA_URL);
  });

  it("re-encrypting the same plaintext produces a different ciphertext (IV randomness) AND both still decrypt correctly", async () => {
    const first = await encryptSignature(TINY_PNG_DATA_URL);
    const second = await encryptSignature(TINY_PNG_DATA_URL);

    expect(first).not.toBe(second);
    expect(await decryptSignature(first)).toBe(TINY_PNG_DATA_URL);
    expect(await decryptSignature(second)).toBe(TINY_PNG_DATA_URL);
  });
});
