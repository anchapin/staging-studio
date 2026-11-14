---
kind: primary
routes:
  web: Web app
steps:
  - text: "The firm user picks the swatch whose finish should carry over, along with the directives and the concept label captured with it"
    kind: actor
    actor: user
    entities:
      - { entity: room, effect: changes, facts: [Material finish, Material finish directives, Material finish concept label] }
    contexts:
      web:
        place: web-app
  - text: "The firm user uploads the room's next photo and opts in to seeding the saved finish; the seed is never applied silently"
    kind: actor
    actor: user
    entities:
      - { entity: room, effect: reads, facts: [] }
    contexts:
      web:
        place: web-app
---

# Saving a finish on the room

## Trigger

A project has a MaterialSwatch and the room has a staged variant.

## Outcome

Several angles of one room stay visually consistent.
