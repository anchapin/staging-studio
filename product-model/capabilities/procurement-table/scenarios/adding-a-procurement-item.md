---
kind: primary
routes:
  web: Web app
steps:
  - text: "The firm user adds a purchase item through the add dialog; the write is ownership-checked and revalidates the project and preview paths"
    kind: actor
    actor: user
    entities:
      - { entity: procurement-item, effect: creates, facts: [Category, Item, Description, SKU, Estimated cost, Vendor, Notes] }
      - { entity: project, effect: reads, facts: [] }
    contexts:
      web:
        place: web-app
  - text: "The Product renders the item in the Lookbook's Material Needs page"
    kind: product
    entities: []
    contexts:
      web:
        place: web-app
---

# Adding a procurement item

## Trigger

A Project owned by the session's user exists.

## Outcome

The Material Needs page lists the item.
