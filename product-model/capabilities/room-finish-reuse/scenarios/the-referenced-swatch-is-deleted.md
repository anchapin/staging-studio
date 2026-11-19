---
kind: edge
routes:
  web: Web app
steps:
  - text: "The firm user deletes the swatch; the room's finish reference becomes null (onDelete: SetNull) while the room's finish directives and concept label text survive"
    kind: actor
    actor: user
    entities:
      - { entity: material-swatch, effect: removes }
      - { entity: room, effect: changes, facts: [Material finish] }
    contexts:
      web:
        place: web-app
  - text: "The firm user sees the room no longer offering the saved finish for seeding"
    kind: actor
    actor: user
    entities:
      - { entity: room, effect: reads, facts: [] }
    contexts:
      web:
        place: web-app
---

# The referenced swatch is deleted

## Trigger

The room's material finish points at a swatch.

## Outcome

The stale reference is gone; the captured directives are not lost.
