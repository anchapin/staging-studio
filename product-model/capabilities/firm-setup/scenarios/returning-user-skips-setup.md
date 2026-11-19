---
kind: edge
routes:
  web: Web app
steps:
  - text: "The firm user signs in and lands on the dashboard, bypassing /setup"
    kind: actor
    actor: user
    entities: []
    contexts:
      web:
        place: web-app
  - text: "The Product renders the project list scoped to the owning User record"
    kind: product
    actor: user
    entities:
      - { entity: project, effect: reads, facts: [] }
    contexts:
      web:
        place: web-app
---

# Returning user skips setup

## Trigger

A User record already exists for the session's email.

## Outcome

The firm proceeds directly to project work.
