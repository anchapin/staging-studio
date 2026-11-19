---
kind: primary
routes:
  web: Web app
steps:
  - text: "The firm user triggers room-type detection over the uploaded photos; the action resolves the session user and checks project ownership"
    kind: actor
    actor: user
    entities:
      - { entity: project, effect: reads, facts: [] }
      - { entity: room, effect: reads, facts: [] }
    contexts:
      web:
        place: web-app
  - text: "The Product infers each room's type and writes it as the room's name (e.g. \"Kitchen\") — a per-room field write, not a new entity"
    kind: product
    actor: user
    entities:
      - { entity: room, effect: changes, facts: [Name] }
    contexts:
      web:
        place: web-app
---

# AI room-type detection

## Trigger

Rooms have been created and photos uploaded.

## Outcome

Rooms are named from their photos.
