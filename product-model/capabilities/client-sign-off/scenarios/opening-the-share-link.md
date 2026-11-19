---
kind: primary
routes:
  print: Print surface
steps:
  - text: "The client opens the preview link without a session"
    kind: actor
    actor: client
    entities: []
    contexts:
      print:
        place: print-surface
  - text: "The Product verifies the signed token: minted over this project, valid for 30 minutes, and compared against the URL's project so a token minted for another project never unlocks this one. Denial always yields 404, never 403, so the route never leaks the project's existence"
    kind: product
    entities:
      - { entity: project, effect: reads, facts: [Property address, Headline, Share caption] }
    contexts:
      print:
        place: print-surface
  - text: "The Product renders the Lookbook spread on the print surface; the signature area shows only if no signature exists yet, and the recorded signature is shown otherwise"
    kind: product
    entities:
      - { entity: sign-off, effect: reads, facts: [] }
    contexts:
      print:
        place: print-surface
  - text: "The client reviews the rendered plan"
    kind: actor
    actor: client
    entities: []
    contexts:
      print:
        place: print-surface
---

# Opening the share link

## Trigger

The firm has shared a link carrying a live preview token.

## Outcome

The client is looking at the correct project's plan.
