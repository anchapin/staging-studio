---
kind: primary
routes:
  web: Web app
steps:
  - text: "The firm user adds a fabric or finish to the project through the add dialog; the write is ownership-checked"
    kind: actor
    actor: user
    entities:
      - { entity: material-swatch, effect: creates, facts: [Name, Material type, Use case, Vendor, SKU] }
      - { entity: project, effect: reads, facts: [] }
    contexts:
      web:
        place: web-app
  - text: "The Product renders the swatch on the Lookbook's swatch page"
    kind: product
    entities: []
    contexts:
      web:
        place: web-app
---

# Adding a swatch

## Trigger

A Project owned by the session's user exists.

## Outcome

The project's finish palette grows.
