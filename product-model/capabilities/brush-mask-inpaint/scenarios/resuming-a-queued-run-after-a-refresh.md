---
kind: edge
routes:
  web: Web app
steps:
  - text: "The firm user reopens the room after a page refresh; the persisted request is what survives the serverless deadline"
    kind: actor
    actor: user
    entities:
      - { entity: inpaint-request, effect: reads, facts: [] }
      - { entity: room, effect: reads, facts: [] }
    contexts:
      web:
        place: web-app
  - text: "The Product resumes polling the request's status and the page follows it to its terminal state"
    kind: product
    actor: user
    entities:
      - { entity: inpaint-request, effect: changes, facts: [] }
    contexts:
      web:
        place: web-app
---

# Resuming a queued run after a refresh

## Trigger

An InpaintRequest exists in In queue or In progress.

## Outcome

The run completes without the user re-submitting.
