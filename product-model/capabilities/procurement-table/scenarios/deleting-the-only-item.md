---
kind: primary
routes:
  web: Web app
steps:
  - text: "The firm user deletes it; the write is ownership-checked and its fields are gone with the row"
    kind: actor
    actor: user
    entities:
      - { entity: procurement-item, effect: removes }
    contexts:
      web:
        place: web-app
  - text: "The Product renders the Material Needs page with no items"
    kind: product
    entities: []
    contexts:
      web:
        place: web-app
---

# Deleting the only item

## Trigger

The project has exactly one procurement item.

## Outcome

The procurement table is empty.
