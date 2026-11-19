---
kind: primary
routes:
  web: Web app
steps:
  - text: "The firm user picks variant A or variant B; the selection write resolves the session user, and the index is one of exactly two slots"
    kind: actor
    actor: user
    entities:
      - { entity: room, effect: changes, facts: [Selected variant] }
    contexts:
      web:
        place: web-app
  - text: "The Product renders the selected pair in the Lookbook room spread, falling back A → B when the selection is unset or points at an incomplete slot; the same selection governs the exported PDF, because the PDF renders the same Lookbook projection"
    kind: product
    entities:
      - { entity: room, effect: reads, facts: [After images, Selected variant] }
    contexts:
      web:
        place: web-app
  - text: "The Product invalidates the caches"
    kind: product
    actor: user
    entities: []
    contexts:
      web:
        place: web-app
---

# Selecting the variant that reaches the PDF

## Trigger

A room has two complete before/after pairs.

## Outcome

One variant per room is what the client sees.
