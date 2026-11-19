---
kind: primary
routes:
  web: Web app
steps:
  - text: "The firm user edits an item's fields, drags to reorder, or deletes it; each write is ownership-checked"
    kind: actor
    actor: user
    entities:
      - { entity: procurement-item, effect: changes, facts: [Category, Item, Description, Procurement status, SKU, Estimated cost, Vendor, Notes, Sort order] }
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

# Editing and deleting items

## Trigger

The project has procurement items.

## Outcome

The Material Needs page tracks the firm's shopping list.
