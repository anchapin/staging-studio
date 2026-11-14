---
kind: primary
routes:
  web: Web app
steps:
  - text: "The firm user picks a version and restores it; the write is ownership-checked, the room's slot after-image is set back to the version's result, and the version list itself is unchanged"
    kind: actor
    actor: user
    entities:
      - { entity: room, effect: changes, facts: [After images] }
      - { entity: inpaint-version, effect: reads, facts: [Result image] }
    contexts:
      web:
        place: web-app
  - text: "The Product revalidates the project and preview paths, so the canvas, lookbook and print surface all show the restored image"
    kind: product
    actor: user
    entities:
      - { entity: project, effect: reads, facts: [] }
    contexts:
      web:
        place: web-app
---

# Restoring an earlier version

## Trigger

At least one version exists for the slot.

## Outcome

The earlier take is live again without losing the newer one.
