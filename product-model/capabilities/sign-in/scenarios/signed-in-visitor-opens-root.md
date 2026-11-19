---
kind: edge
routes:
  web: Web app
steps:
  - text: "The firm user opens / and is redirected to /projects"
    kind: actor
    actor: user
    entities:
      - { entity: project, effect: reads, facts: [] }
    contexts:
      web:
        place: web-app
  - text: "The Product resolves the session and renders the project list for the owning user only"
    kind: product
    actor: user
    entities:
      - { entity: project, effect: reads, facts: [] }
    contexts:
      web:
        place: web-app
---

# Visiting / while signed in

## Trigger

A valid session exists and the firm user opens /.

## Outcome

The firm user's project list.
