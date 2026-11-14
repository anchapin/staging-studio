---
appliesTo:
  - type: context
    context:
      place: print-surface
  - type: entity
    id: project
references:
  - kind: code
    role: implementation
    target: src/lib/preview-token.ts
  - kind: code
    role: implementation
    target: src/lib/preview-access.ts
---

# A preview token is scoped to one project and must match the URL's project

A preview token carries exactly one projectId. Verification returns the
signed projectId, and callers must compare it to the URL's own
projectId; a token minted for one project can never unlock another.

**Grant.** A preview token grants access to exactly one project.

**Enforcing code.**

- `src/lib/preview-token.ts` — `verifyPreviewToken` returns the signed
  `projectId` (along with validity and expiry) rather than a bare
  boolean, so the caller performs the scope comparison. The module
  documents the requirement explicitly: *"callers MUST compare it to the
  URL's own projectId, so a token minted for project A cannot unlock
  project B."*
- `src/lib/preview-access.ts` — the preview page compares the token's
  project id to the URL's `id` and denies on mismatch. Denied access
  always yields a `404`, never a `403`, so the route never leaks a
  project's existence. The same module's `tokenMatchesProject` helper is
  what the sign-off route uses to assert scope before any Prisma access.

**Effect on the model.** The token is a *grant on one `Project`*; it is
not a general session substitute. Any surface that accepts a token must
treat the project id inside it as the object of the grant.
