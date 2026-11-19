---
kind: edge
routes:
  web: Web app
steps:
  - text: "The Product renders slot 0 in the room spread, following the A → B fallback when the selection is unset or points at an incomplete slot"
    kind: product
    entities:
      - { entity: room, effect: reads, facts: [After images] }
    contexts:
      web:
        place: web-app
  - text: "The firm user sees the room presenting exactly one pair; the \"Virtually staged\" mark applies only to a complete variant's after-image"
    kind: actor
    actor: user
    entities:
      - { entity: room, effect: reads, facts: [] }
    contexts:
      web:
        place: web-app
---

# A room with only one complete variant

## Trigger

Slot 0 is complete and slot 1 has no after-image.

## Outcome

The Lookbook shows the room with the one finished pair.
