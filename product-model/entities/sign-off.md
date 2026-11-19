---
references:
  - kind: code
    role: implementation
    target: prisma/schema.prisma
---

# SignOff

The client's digital sign-off of the Lookbook: the signature itself plus
the explicit consent attestation. It is **owned by `Project`** and carries
the signature + consent-attestation fields that live on `Project` today —
it is not a separate table.

## Information kept

- **Signature** — `clientSignature`: the AES-GCM-256 ciphertext (base64: IV ‖ ciphertext ‖ tag) of the client's PNG signature; never a raw PNG
- **When signed** — `clientSignatureTimestamp`: when the sign-off was recorded
- **Consent attested** — `clientConsentAttested`: whether the client attested that they read and accepted the approval statement; persisted so a `Signed` record without an attestation is detectable
- **When consent attested** — `clientConsentAttestedAt`: when the attestation was made; agrees with the signature timestamp to the millisecond

## States

### Pending

The Lookbook awaits the client's signature (`clientSignatureStatus` is
`"Pending"` or null). This state is the Lookbook's sign-off state, carried
on the owning Project.

### Signed

The signature and consent attestation are recorded
(`clientSignatureStatus` is `"Signed"`). From here the record is
immutable: a second sign-off is refused with `409 alreadySigned`.

## Why it exists

- A client who has no account signs from the cookie-less print surface,
  using the preview token as the only credential
  ([BR-06](../business-rules/br-06-preview-token-ttl.md),
  [BR-07](../business-rules/br-07-preview-token-scoping.md)).
- Once signed, the record is **immutable**: a second sign-off is refused
  with `409 alreadySigned`
  ([BR-02](../business-rules/br-02-sign-off-immutable.md)).
- Consent must be explicitly attested, not implied
  ([BR-08](../business-rules/br-08-consent-attestation.md)).
- The signature is stored **encrypted at rest** (AES-GCM-256); the raw PNG
  never reaches the database
  ([BR-09](../business-rules/br-09-signature-encrypted-at-rest.md)).

## Notes

- The `SignOff` **actor** is "the client (via preview token)" — the
  [Client](./client.md), an Entity that acts and keeps nothing. There is
  no Client record in this model.
- `Project.clientName` (an intake string) and this attestation are
  **unlinked** — the model asserts no identity between them. See
  [coverage.md](../coverage.md).
- Both write paths — the session-less `POST /api/sign-project` route and
  the firm-side `saveProjectSignature` server action — enforce identical
  validation via `src/lib/sign-project-schema.ts`.
