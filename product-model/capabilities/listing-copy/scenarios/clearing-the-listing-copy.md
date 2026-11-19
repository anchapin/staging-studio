---
kind: primary
routes:
  web: Web app
steps:
  - text: "The firm user clears the headline or body and saves; the column is set back to null/empty — presence is decided by trimming the value for the check only, and a stored body is preserved verbatim once set"
    kind: actor
    actor: user
    entities:
      - { entity: room, effect: changes, facts: [Lookbook headline, Lookbook body] }
    contexts:
      web:
        place: web-app
  - text: "The Product renders the fallback again and revalidates the preview"
    kind: product
    actor: user
    entities: []
    contexts:
      web:
        place: web-app
---

# Clearing the listing copy

## Trigger

The room has listing copy set.

## Outcome

The fallback takes over without a blank spread.
