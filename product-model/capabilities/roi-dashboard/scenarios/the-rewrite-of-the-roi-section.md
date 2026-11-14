---
kind: primary
routes:
  web: Web app
steps:
  - text: "The firm user edits the premium, velocity or tier through the project's metadata form"
    kind: actor
    actor: user
    entities:
      - { entity: project, effect: changes, facts: [ROI sales price premium, ROI transaction velocity, ROI investment tier] }
    contexts:
      web:
        place: web-app
  - text: "The Product revalidates the Lookbook and preview paths — the literal \"Virtually staged\" disclosure mark, per-project with only an explicit false disabling it, is carried on the after-images"
    kind: product
    actor: user
    entities:
      - { entity: project, effect: reads, facts: [] }
    contexts:
      web:
        place: web-app
---

# The rewrite of the ROI section

## Trigger

The numbers have been entered and then change.

## Outcome

The client sees the updated numbers and the disclosure.
