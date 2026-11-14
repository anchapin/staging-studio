---
kind: primary
routes:
  web: Web app
steps:
  - text: "The firm user edits a swatch's name, kind or attributes, or drags to reorder; the write is ownership-checked"
    kind: actor
    actor: user
    entities:
      - { entity: material-swatch, effect: changes, facts: [Name, Material type, Use case, Vendor, SKU, Sort order] }
    contexts:
      web:
        place: web-app
  - text: "The Product revalidates the project, lookbook and preview paths"
    kind: product
    actor: user
    entities:
      - { entity: project, effect: reads, facts: [] }
    contexts:
      web:
        place: web-app
---

# Editing and reordering swatches

## Trigger

The project has swatches.

## Outcome

The swatch page reflects the firm's order.
