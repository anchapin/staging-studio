---
kind: primary
routes:
  web: Web app
steps:
  - text: "The firm user opens the variant strip, which shows how many refinements each variant has; the read resolves the session user first"
    kind: actor
    actor: user
    entities:
      - { entity: inpaint-request, effect: reads, facts: [] }
      - { entity: inpaint-version, effect: reads, facts: [] }
    contexts:
      web:
        place: web-app
  - text: "The Product derives the counts from the room's inpaint requests and versions; the slots are exactly 0 and 1"
    kind: product
    entities:
      - { entity: room, effect: reads, facts: [] }
    contexts:
      web:
        place: web-app
---

# Counting touch-ups per variant

## Trigger

A room has runs recorded.

## Outcome

The firm sees which variant has been refined.
