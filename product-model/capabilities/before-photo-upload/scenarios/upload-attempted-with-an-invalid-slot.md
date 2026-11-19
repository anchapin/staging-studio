---
kind: validation
routes:
  web: Web app
steps:
  - text: "The firm user requests an upload URL for a slot outside {0, 1} and the request is rejected"
    kind: actor
    actor: user
    entities: []
    contexts:
      web:
        place: web-app
  - text: "The firm user confirms an upload whose storage path does not belong to the claimed slot and the write is refused"
    kind: actor
    actor: user
    entities: []
    contexts:
      web:
        place: web-app
---

# Upload attempted with an invalid slot

## Trigger

A room owned by the session's user exists, and an upload targets a slot outside {0, 1} or a mismatched storage path.

## Outcome

The room keeps exactly two addressable slots.
