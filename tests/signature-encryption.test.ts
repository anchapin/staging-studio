import { describe, it, expect } from "vitest";
import { encryptSignature, decryptSignature } from "@/lib/signature-encryption";

describe("signature-encryption", () => {
  const TEST_CASES = [
    "data:image/png;base64,aGVsbG8gd29ybGQ=",
    "data:image/png;base64,VGhpcyBpcyBhIHNpZ25hdHVyZSBkYXRhIFVSTCB3aXRoIGEgbG90IG9mIGNoYXJhY3RlcnMgaGVyZSBmb3IgdGVzdGluZyB0aGUgZW5jcnlwdGlvbiBhbGdvcml0aG0=",
    "",
    "a".repeat(10000),
    "unicode: \u00e9\u00e8\u00ea \u4e2d\u6587 \uD83D\uDE00",
  ];

  for (const [i, plaintext] of TEST_CASES.entries()) {
    it(`round-trips correctly for test case ${i}`, async () => {
      const encrypted = await encryptSignature(plaintext);
      const decrypted = await decryptSignature(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it(`produces different ciphertexts for the same plaintext (due to random IV) for test case ${i}`, async () => {
      const encrypted1 = await encryptSignature(plaintext);
      const encrypted2 = await encryptSignature(plaintext);
      expect(encrypted1).not.toBe(encrypted2);
    });

    it(`encrypted output is valid base64 for test case ${i}`, async () => {
      const encrypted = await encryptSignature(plaintext);
      expect(() => atob(encrypted)).not.toThrow();
    });
  }

  it("encrypted output length grows with input length", async () => {
    const short = await encryptSignature("x");
    const long = await encryptSignature("x".repeat(1000));
    const shortBytes = Buffer.from(short, "base64").length;
    const longBytes = Buffer.from(long, "base64").length;
    expect(longBytes).toBeGreaterThan(shortBytes);
  });
});
