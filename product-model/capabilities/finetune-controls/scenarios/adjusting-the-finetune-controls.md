---
kind: primary
routes:
  web: Web app
steps:
  - text: "The firm user moves the strength slider (0–100, mapping to the provider's strength 0–1), the expand slider (0–40, the pre-upload mask feathering radius in pixels) and the seed field (up to 6 digits, digits-only, enforced by the schema); nothing is persisted until saved"
    kind: actor
    actor: user
    entities: []
    contexts:
      web:
        place: web-app
  - text: "The firm user saves; the write is ownership-checked, and the three columns are nullable so a room that has never used FineTune ships without the state"
    kind: actor
    actor: user
    entities:
      - { entity: room, effect: changes, facts: [FineTune strength, FineTune expand, FineTune seed] }
    contexts:
      web:
        place: web-app
  - text: "The firm user switches rooms and back; the persisted values are re-seeded into the studio when the room changes"
    kind: actor
    actor: user
    entities:
      - { entity: room, effect: reads, facts: [FineTune strength, FineTune expand, FineTune seed] }
    contexts:
      web:
        place: web-app
---

# Adjusting the controls

## Trigger

A room exists.

## Outcome

The room remembers its tuning.
