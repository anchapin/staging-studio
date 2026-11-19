---
kind: edge
routes:
  web: Web app
steps:
  - text: "The Product renders the Lookbook for the project; the ROI inputs are independent nullable columns, so an incomplete triple renders as far as the data goes and the firm simply never filled it in"
    kind: product
    entities:
      - { entity: project, effect: reads, facts: [ROI sales price premium, ROI transaction velocity, ROI investment tier] }
    contexts:
      web:
        place: web-app
  - text: "The firm user enters the numbers later from the project form"
    kind: actor
    actor: user
    entities:
      - { entity: project, effect: changes, facts: [ROI sales price premium, ROI transaction velocity, ROI investment tier] }
    contexts:
      web:
        place: web-app
---

# A project with no numbers

## Trigger

All three columns are null.

## Outcome

The Lookbook still renders; the ROI section is completed when numbers land.
