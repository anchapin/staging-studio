---
kind: edge
routes:
  web: Web app
steps:
  - text: "The firm user re-opens the room; the cached rows match on the unique key (userId, imageUrlHash, concept, instanceIndex), so the vision call is not repeated and no labelling unit is consumed"
    kind: actor
    actor: user
    entities:
      - { entity: vision-label, effect: reads, facts: [Concept, Label, Score] }
      - { entity: room, effect: reads, facts: [] }
    contexts:
      web:
        place: web-app
  - text: "The Product renders the cached instances in the inspector"
    kind: product
    entities: []
    contexts:
      web:
        place: web-app
---

# Re-opening the editor without re-billing

## Trigger

Labels were produced earlier for the same image.

## Outcome

The instance list is restored at no cost.
