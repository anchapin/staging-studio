---
kind: primary
routes:
  web: Web app
steps:
  - text: "The firm user chooses a photo; it is compressed in the browser before any storage write, so the stored object is the compressed bytes"
    kind: actor
    actor: user
    entities: []
    contexts:
      web:
        place: web-app
  - text: "The firm user requests an upload URL for variant slot 0; the request resolves the session user, checks ownership, and bounds the slot to 0 or 1"
    kind: actor
    actor: user
    entities: []
    contexts:
      web:
        place: web-app
  - text: "The firm user uploads to storage and confirms; the stored path is re-validated against the claimed slot before the room's slot-0 before-image is set"
    kind: actor
    actor: user
    entities:
      - { entity: room, effect: changes, facts: [Before images] }
    contexts:
      web:
        place: web-app
---

# Uploading a before-photo into slot 0

## Trigger

A Room owned by the session's user exists.

## Outcome

The room's slot 0 holds a before-image.
