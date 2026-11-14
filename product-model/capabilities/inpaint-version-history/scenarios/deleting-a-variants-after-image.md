---
kind: primary
routes:
  web: Web app
steps:
  - text: "The firm user deletes the after-image of a variant; the delete resolves the session user first, the slot's after-image is cleared, and the room's before-image and the versions remain"
    kind: actor
    actor: user
    entities:
      - { entity: room, effect: changes, facts: [After images] }
    contexts:
      web:
        place: web-app
  - text: "The Product revalidates the project, rooms, lookbook, refine, report and preview paths, and the deleted variant stops rendering in the report, lookbook and preview"
    kind: product
    actor: user
    entities:
      - { entity: project, effect: reads, facts: [] }
      - { entity: room, effect: reads, facts: [] }
    contexts:
      web:
        place: web-app
---

# Deleting a variant's after-image

## Trigger

A slot holds an after-image.

## Outcome

The incomplete variant is no longer presented as a finished pair.
