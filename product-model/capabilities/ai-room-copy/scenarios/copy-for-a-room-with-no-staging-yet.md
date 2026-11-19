---
kind: edge
routes:
  web: Web app
steps:
  - text: "The firm user requests copy generation anyway; the room's copy fields are written even though no variant is complete, and the room spread still shows no photo pair"
    kind: actor
    actor: user
    entities:
      - { entity: room, effect: changes, facts: [Observed challenge, Recommendation, Buyer psychology, Checklist items] }
    contexts:
      web:
        place: web-app
---

# Copy for a room with no staging yet

## Trigger

A room exists with no after-image.

## Edge cases

- No disclosure mark is applied to the room, because the mark needs a complete variant's after-image

## Outcome

Copy exists independently of staging.
