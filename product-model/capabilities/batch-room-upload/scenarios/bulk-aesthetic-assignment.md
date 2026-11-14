---
kind: primary
routes:
  web: Web app
steps:
  - text: "The firm user assigns the project's staging aesthetic across the room matrix in bulk; the Staging Aesthetic is a variation recorded on the product, not an entity"
    kind: actor
    actor: user
    entities:
      - { entity: project, effect: reads, facts: [] }
      - { entity: room, effect: reads, facts: [] }
    contexts:
      web:
        place: web-app
  - text: "The Product invalidates the project and preview caches"
    kind: product
    actor: user
    entities:
      - { entity: project, effect: reads, facts: [] }
    contexts:
      web:
        place: web-app
---

# Bulk aesthetic assignment

## Trigger

Rooms exist in the project.

## Outcome

Every room carries an aesthetic consistent with the project's.
