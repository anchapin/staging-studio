---
kind: edge
routes:
  web: Web app
steps:
  - text: "The Product renders the room's copy on the Lookbook page and the print preview: when the listing columns are null, empty or whitespace-only, the recommendation is used for the body slot, so both routes render the same semantics"
    kind: product
    entities:
      - { entity: room, effect: reads, facts: [Lookbook headline, Lookbook body, Recommendation] }
    contexts:
      web:
        place: web-app
  - text: "The firm user sees a room with a body but no distinct headline"
    kind: actor
    actor: user
    entities:
      - { entity: room, effect: reads, facts: [] }
    contexts:
      web:
        place: web-app
---

# Falling back to the consultation prose

## Trigger

The room's listing-copy columns are unset, but its recommendation is set.

## Outcome

A room that was never opened in the new copy panel still shows copy.
