---
kind: primary
routes:
  web: Web app
steps:
  - text: "The firm user edits the observed challenge, recommendation or buyer psychology and saves; the edit path validates through the same schema as the generated path and is ownership-checked"
    kind: actor
    actor: user
    entities:
      - { entity: room, effect: changes, facts: [Observed challenge, Recommendation, Buyer psychology] }
    contexts:
      web:
        place: web-app
  - text: "The Product invalidates the preview"
    kind: product
    actor: user
    entities: []
    contexts:
      web:
        place: web-app
---

# Editing the copy by hand

## Trigger

The room has generated copy.

## Outcome

The firm's wording, not the model's, is what the client reads.
