---
kind: primary
routes:
  web: Web app
steps:
  - text: "The firm user uploads a property cover photo for the Lookbook hero; the write is ownership-checked and the storage path is validated against the project's own id"
    kind: actor
    actor: user
    entities:
      - { entity: project, effect: changes, facts: [Cover photo] }
    contexts:
      web:
        place: web-app
  - text: "The Product renders the uploaded photo as the hero on the Lookbook page and the OG/social-share card image"
    kind: product
    entities: []
    contexts:
      web:
        place: web-app
---

# Uploading the project cover photo

## Trigger

A Project owned by the session's user exists.

## Outcome

The Lookbook leads with the property's photo.
