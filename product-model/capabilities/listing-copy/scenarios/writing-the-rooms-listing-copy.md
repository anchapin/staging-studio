---
kind: primary
routes:
  web: Web app
steps:
  - text: "The firm user types a headline and a body in the copy panel and saves; the write is ownership-checked and revalidates the project and preview paths"
    kind: actor
    actor: user
    entities:
      - { entity: room, effect: changes, facts: [Lookbook headline, Lookbook body] }
      - { entity: project, effect: reads, facts: [] }
    contexts:
      web:
        place: web-app
  - text: "The Product renders the new headline and body next to the photo pair in the Lookbook room spread"
    kind: product
    entities:
      - { entity: room, effect: reads, facts: [] }
    contexts:
      web:
        place: web-app
---

# Writing the room's listing copy

## Trigger

A room owned by the session's user exists.

## Outcome

The room spread carries the listing snippet.
