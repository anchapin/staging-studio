---
appliesTo:
  - type: entity
    id: sign-off
    effect: changes
    from: Signed
permits: []
references:
  - kind: code
    role: implementation
    target: src/app/api/sign-project/route.ts
---

# A signed SignOff is immutable; a further sign-off is refused

Once a Project's sign-off is recorded as Signed, a further sign-off
attempt is refused with 409 alreadySigned, and the signed record is not
mutated. Re-signing requires an explicit firm-side reset.

**Grant.** No second sign-off may alter a `Signed` project's
`SignOff` fields.

**Enforcing code.** `src/app/api/sign-project/route.ts` — the write is a
conditional `prisma.project.updateMany` whose `where` clause matches only
rows whose `clientSignatureStatus` is `null` or not `"Signed"`. When no
row matches, `updateMany` returns `count === 0` and the route answers
**409** with the `alreadySigned` error copy: *"This project has already
been signed. The staging firm must reset the signature before it can be
signed again."* The `null` status is matched explicitly because a Prisma
`not` filter compiles to SQL `<>`, which never matches `NULL` — without
that clause an unsigned project could never be signed.

**Effect on the model.** The [SignOff](../entities/sign-off.md)
record is immutable once written; its `clientSignature`,
`clientSignatureStatus`, `clientSignatureTimestamp`,
`clientConsentAttested` and `clientConsentAttestedAt` are written in one
atomic update and never overwritten by a client-initiated request.
