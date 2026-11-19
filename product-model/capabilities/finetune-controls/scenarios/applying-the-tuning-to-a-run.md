---
kind: primary
routes:
  web: Web app
steps:
  - text: "The firm user runs an inpaint with the tuned settings; the expand value feathers the mask before upload, the strength value maps to the provider's strength parameter, and the seed is recorded on the resulting version so the run can be regenerated"
    kind: actor
    actor: user
    entities:
      - { entity: inpaint-request, effect: creates, to: In queue, facts: [Variant slot, Source slot] }
    contexts:
      web:
        place: web-app
  - text: "The Product writes the staged image to the target slot"
    kind: product
    actor: user
    entities:
      - { entity: room, effect: changes, facts: [After images] }
    contexts:
      web:
        place: web-app
---

# Applying the tuning to a run

## Trigger

The room has persisted FineTune values.

## Outcome

The run reflects the firm's tuning.
