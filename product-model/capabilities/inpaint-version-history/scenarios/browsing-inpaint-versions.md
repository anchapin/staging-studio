---
kind: primary
routes:
  web: Web app
steps:
  - text: "The firm user opens the version strip for the room's variant slots"
    kind: actor
    actor: user
    entities:
      - { entity: inpaint-version, effect: reads, facts: [Thumbnail, Variant slot] }
      - { entity: room, effect: reads, facts: [] }
    contexts:
      web:
        place: web-app
  - text: "The Product renders each version's thumbnail in the strip"
    kind: product
    entities: []
    contexts:
      web:
        place: web-app
---

# Browsing versions

## Trigger

A room has at least one completed inpaint run.

## Outcome

The earlier takes are visible and comparable.
