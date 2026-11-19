---
appliesTo:
  - type: entity
    id: sign-off
    facts: [Signature]
references:
  - kind: code
    role: implementation
    target: src/lib/signature-encryption.ts
---

# The client signature is stored encrypted at rest, never as a raw PNG

The client signature is encrypted with AES-GCM-256 before it is written.
The database never holds the raw PNG data URL; consumers decrypt on read.

**Grant.** The plaintext signature never reaches the database.

**Enforcing code.** `src/lib/signature-encryption.ts` — `encryptSignature`
encrypts with AES-GCM-256 using a 32-byte base64 key from
`SIGNATURE_ENCRYPTION_KEY` (`openssl rand -base64 32`), generating a fresh
12-byte IV per encryption and producing one base64 string in the format
IV ‖ ciphertext ‖ tag (16-byte tag). `decryptSignature` reverses it.
Encryption uses the Web Crypto API so it behaves identically in the Edge
runtime, the Node server runtime and vitest. The key is used directly, not
derived — it must already be 32 bytes of entropy.

The write path encrypts **before** the retry loop in
`src/app/api/sign-project/route.ts`, so the persisted value does not depend
on which retry attempt won (a fresh IV per attempt would otherwise produce
different ciphertexts), and so encryption is not the failure mode the
retry exists for.

**Effect on the model.** [SignOff](../entities/sign-off.md)
`clientSignature` holds ciphertext, not a PNG data URL. The schema still
validates the *inbound* payload as a PNG data URL
(`src/lib/sign-project-schema.ts`, capped at ~1 MB of base64 text) — that
is the transport contract, not the storage contract.
