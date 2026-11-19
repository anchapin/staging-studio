---
appliesTo:
  - type: entity
    id: sign-off
    facts: [Consent attested]
  - type: entity
    id: sign-off
    effect: changes
permits:
  - actors: [client]
references:
  - kind: code
    role: implementation
    target: src/lib/sign-project-schema.ts
  - kind: code
    role: implementation
    target: src/app/api/sign-project/route.ts
---

# A sign-off is accepted only with an explicit consent attestation

A sign-off is only accepted when the client explicitly attests consent
(consentAttested === true). A missing, false or non-boolean attestation
is rejected.

**Grant.** No signature may be recorded without the client's explicit
attestation that they read and accepted the approval statement.

**Enforcing code.**

- `src/lib/sign-project-schema.ts` — the shared payload schema declares
  `consentAttested: z.literal(true, ...)`. The literal rejects `false`,
  missing, and non-boolean values, so a client cannot burn a record to
  `Signed` without confirming the attestation. The schema is `.strict()`,
  so only the known client-controlled fields can be validated through it.
- `src/app/api/sign-project/route.ts` — a schema failure on the
  `consentAttested` field is answered **400** with the `consentRequired`
  copy ("Please confirm you have read and accept the staging-plan approval
  statement before signing."), distinct from a 401 credential failure: the
  token can be fine and the signature fine, and the client simply has not
  ticked the box. The same schema is shared with the firm-side
  `saveProjectSignature` action so both write paths enforce identical
  validation.

**Effect on the model.** The [SignOff](../entities/sign-off.md)
persists `clientConsentAttested` and `clientConsentAttestedAt` alongside
the signature, so a `Signed` record without a recorded attestation is
detectable rather than decorative.
