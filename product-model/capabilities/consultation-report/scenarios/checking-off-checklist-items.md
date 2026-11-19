---
kind: primary
routes:
  web: Web app
steps:
  - text: "The firm user checks off completed steps; the write is ownership-checked"
    kind: actor
    actor: user
    entities:
      - { entity: room, effect: changes, facts: [Checklist items] }
    contexts:
      web:
        place: web-app
  - text: "The firm user sees the report's completion state update — the item's checkedAt timestamp is set and completedSteps tracks progress"
    kind: actor
    actor: user
    entities: []
    contexts:
      web:
        place: web-app
---

# Checking off checklist items

## Trigger

A room's checklist has items.

## Outcome

The report reflects what the firm has done.
