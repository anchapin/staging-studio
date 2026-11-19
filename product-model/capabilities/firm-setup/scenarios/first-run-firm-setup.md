---
kind: primary
routes:
  web: Web app
steps:
  - text: "The Product routes the visitor to /setup because the session resolved to no User record"
    kind: product
    actor: user
    entities: []
    contexts:
      web:
        place: web-app
  - text: "The firm user enters the firm's name and logo and submits"
    kind: actor
    actor: user
    entities:
      - { entity: user, effect: creates, facts: [Firm name, Owner name, Firm logo] }
    contexts:
      web:
        place: web-app
  - text: "The Product redirects to the dashboard, which redirects to /projects; the successful setup deletes the rate-limit counter, resetting it"
    kind: product
    entities:
      - { entity: project, effect: reads, facts: [] }
    contexts:
      web:
        place: web-app
---

# First-run firm setup

## Trigger

A valid session exists but no User record matches its email.

## Outcome

The firm's branding record exists; the firm can intake projects.
