---
kind: primary
routes:
  web: Web app
steps:
  - text: "The firm user selects the property's photos in the batch uploader; the upload URLs are only issued to the owning user"
    kind: actor
    actor: user
    entities: []
    contexts:
      web:
        place: web-app
  - text: "The firm user runs the batch creation, which resolves the session user and checks project ownership, and one room is created per property room"
    kind: actor
    actor: user
    entities:
      - { entity: room, effect: creates, facts: [Name, Sort order] }
      - { entity: project, effect: reads, facts: [] }
    contexts:
      web:
        place: web-app
  - text: "The Product invalidates the project and preview caches"
    kind: product
    actor: user
    entities:
      - { entity: project, effect: reads, facts: [] }
    contexts:
      web:
        place: web-app
---

# Creating all rooms in one pass

## Trigger

A Project owned by the session's user exists.

## Outcome

The project's room list exists.
