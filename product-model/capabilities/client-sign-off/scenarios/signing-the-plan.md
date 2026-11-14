---
kind: primary
routes:
  print: Print surface
steps:
  - text: "The client ticks the consent attestation and signs; the single sign-off record flips to Signed, carrying the signature — stored encrypted, never a raw PNG — the client's name, the attestation and its timestamp, and when the signature was applied"
    kind: actor
    actor: client
    entities:
      - { entity: sign-off, effect: changes, from: Pending, to: Signed, facts: [Signature, Consent attested, When consent attested, When signed] }
    contexts:
      print:
        place: print-surface
  - text: "The Product records the signature and invalidates the Lookbook, preview and dashboard caches, so the signed state shows everywhere — the sign-off also revalidates the project, refining the pages so the firm's view updates"
    kind: product
    entities:
      - { entity: project, effect: reads, facts: [] }
    contexts:
      print:
        place: print-surface
---

# Signing the plan

## Trigger

The sign-off is still Pending, and the client has reviewed the plan.

## Outcome

The plan is approved; there is no un-sign.
