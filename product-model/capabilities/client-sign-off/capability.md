---
domain: lookbook-delivery
availability:
  - place: print-surface
references:
  - kind: code
    role: implementation
    target: src/app/api/sign-project/route.ts
  - kind: code
    role: implementation
    target: src/lib/sign-project-schema.ts
  - kind: code
    role: implementation
    target: src/lib/signature-encryption.ts
---

# Client sign-off

The client opens the share link with no session, reviews the Lookbook, attests consent and signs; the single sign-off ends in Signed.
