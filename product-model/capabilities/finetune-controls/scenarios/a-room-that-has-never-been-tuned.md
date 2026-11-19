---
kind: edge
routes:
  web: Web app
steps:
  - text: "The firm user opens the studio; the controls fall back to their defaults — strength 50 (→ 0.5), expand 12, seed empty"
    kind: actor
    actor: user
    entities: []
    contexts:
      web:
        place: web-app
  - text: "The firm user runs an inpaint without tuning; a request and, on success, a version are created"
    kind: actor
    actor: user
    entities:
      - { entity: inpaint-request, effect: creates, to: In queue, facts: [Variant slot, Source slot] }
    contexts:
      web:
        place: web-app
---

# A room that has never been tuned

## Trigger

The room's FineTune columns are null.

## Outcome

An untuned room still stages.
