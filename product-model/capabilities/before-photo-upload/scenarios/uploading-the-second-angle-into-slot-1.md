---
kind: primary
routes:
  web: Web app
steps:
  - text: "The firm user uploads a second photo targeting variant slot 1, which maps to the second before/after column pair"
    kind: actor
    actor: user
    entities:
      - { entity: room, effect: changes, facts: [Before images] }
    contexts:
      web:
        place: web-app
  - text: "The firm user sees the room showing two before/after pairs"
    kind: actor
    actor: user
    entities:
      - { entity: room, effect: reads, facts: [] }
    contexts:
      web:
        place: web-app
---

# Uploading the second angle into slot 1

## Trigger

A Room owned by the session's user exists, as for slot 0.

## Outcome

The room is ready for staging in either slot.
