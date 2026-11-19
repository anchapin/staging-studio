---
kind: edge
routes:
  web: Web app
steps:
  - text: "The firm user deletes the after-image of the variant; the delete resolves the session user first and revalidates the report path among others"
    kind: actor
    actor: user
    entities:
      - { entity: room, effect: changes, facts: [After images] }
    contexts:
      web:
        place: web-app
  - text: "The Product renders the report without the deleted variant, and the variant stops rendering in the lookbook and preview as well"
    kind: product
    actor: user
    entities: []
    contexts:
      web:
        place: web-app
---

# Deleting a variant's after-image from the report

## Trigger

The report shows a variant whose after-image the firm wants gone.

## Outcome

The deleted variant is gone from every surface.
