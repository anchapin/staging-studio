---
kind: primary
routes:
  web: Web app
steps:
  - text: "The firm user enters the sales price premium, the transaction velocity and picks the investment tier (seed / mid / complete)"
    kind: actor
    actor: user
    entities:
      - { entity: project, effect: changes, facts: [ROI sales price premium, ROI transaction velocity, ROI investment tier] }
    contexts:
      web:
        place: web-app
  - text: "The firm user sees the Lookbook's ROI section render the three numbers"
    kind: actor
    actor: user
    entities: []
    contexts:
      web:
        place: web-app
---

# Entering the project numbers

## Trigger

A Project owned by the session's user exists.

## Outcome

The Lookbook carries the project's ROI section.
