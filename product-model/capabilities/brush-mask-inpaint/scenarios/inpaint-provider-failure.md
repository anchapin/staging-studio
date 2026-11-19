---
kind: edge
routes:
  web: Web app
steps:
  - text: "The Product's provider call fails; the request's status becomes Error and the slot's after-image is unchanged"
    kind: product
    actor: user
    entities:
      - { entity: inpaint-request, effect: changes, from: In progress, to: Error, facts: [] }
    contexts:
      web:
        place: web-app
  - text: "The firm user retries, possibly with a different mask; the daily cap still applies"
    kind: actor
    actor: user
    entities:
      - { entity: inpaint-request, effect: creates, to: In queue, facts: [Variant slot, Source slot] }
    contexts:
      web:
        place: web-app
---

# Provider failure

## Trigger

A run is submitted and the provider call fails.

## Edge cases

- A pre-write failure — the request row cannot be written — is the only path that refunds the inpaint unit

## Outcome

The failed run is recorded and the room keeps its prior staged image.
