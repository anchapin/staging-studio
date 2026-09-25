/**
 * AES-GCM-256 encryption for client signature data at rest.
 *
 * Purpose: the `clientSignature` field is stored as a PNG data URL in
 * Prisma Postgres. This module encrypts it so that the plaintext is never
 * stored on disk.
 *
 * Runtime note: uses the Web Crypto API (`crypto.subtle`) rather than
 * `node:crypto` — identical behaviour in the Edge runtime, the Node server
 * runtime, and the vitest Node environment (Node >= 18 exposes
 * `globalThis.crypto`).
 *
 * Secret: `SIGNATURE_ENCRYPTION_KEY`. A 32-byte (256-bit) base64-encoded
 * key is required. Generate with: openssl rand -base64 32
 *
 * Key derivation: the key is used directly (not derived) — it must already
 * be 32 bytes of entropy.
 *
 * Encrypted output format (base64): IV (12 bytes) || ciphertext || tag (16 bytes)
 * All in one base64 string for storage convenience.
 */

const ALGORITHM = "AES-GCM";
const KEY_LENGTH = 256;
const IV_LENGTH = 12;
const TAG_LENGTH = 128;

/**
 * Encrypt `data` using AES-GCM-256.
 *
 * @param data Plaintext string to encrypt.
 * @returns Base64-encoded string: IV || ciphertext || auth tag.
 */
export async function encryptSignature(data: string): Promise<string> {
  const key = await importEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const encoded = new TextEncoder().encode(data);
  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv, tagLength: TAG_LENGTH },
    key,
    encoded
  );

  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return uint8ArrayToBase64(combined);
}

/**
 * Decrypt an AES-GCM-256 encrypted signature.
 *
 * @param encrypted Base64-encoded string: IV || ciphertext || auth tag.
 * @returns Decrypted plaintext string.
 */
export async function decryptSignature(
  encrypted: string
): Promise<string> {
  const key = await importEncryptionKey();
  const combined = base64ToUint8Array(encrypted);

  const iv = combined.slice(0, IV_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH);

  const decrypted = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv, tagLength: TAG_LENGTH },
    key,
    ciphertext
  );

  return new TextDecoder().decode(decrypted);
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

let cachedKey: CryptoKey | null = null;

async function importEncryptionKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;

  const rawKey = getEncryptionKey();
  const keyBytes = base64ToUint8Array(rawKey);

  cachedKey = await crypto.subtle.importKey(
    "raw",
    keyBytes.buffer as ArrayBuffer,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ["encrypt", "decrypt"]
  );

  return cachedKey;
}

const DEV_FALLBACK_KEY = "NQMJDL4nwT0Dd3b1rGmfPj6Ykygt38jgsnjN69i/9nE=";

function getEncryptionKey(): string {
  const key = process.env.SIGNATURE_ENCRYPTION_KEY;
  if (key && key.trim() !== "") {
    return key;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SIGNATURE_ENCRYPTION_KEY is not set. " +
        "Generate a key with: openssl rand -base64 32"
    );
  }
  return DEV_FALLBACK_KEY;
}
