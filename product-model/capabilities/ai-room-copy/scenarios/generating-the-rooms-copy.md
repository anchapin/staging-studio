---
kind: primary
routes:
  web: Web app
steps:
  - text: "The firm user requests copy generation for the room; the copy surface claims one unit against the daily cap of 50"
    kind: actor
    actor: user
    entities:
      - { entity: room, effect: reads, facts: [Staging directives] }
    contexts:
      web:
        place: web-app
  - text: "The Product expands the directives with GPT-4o-mini (through the Vercel AI SDK); the unit is claimed atomically before the paid call and refunded on provider failure"
    kind: product
    entities: []
    contexts:
      web:
        place: web-app
  - text: "The firm user saves the generated copy; the write is ownership-checked and revalidates the project and preview paths — the copy is lookbook-rendered"
    kind: actor
    actor: user
    entities:
      - { entity: room, effect: changes, facts: [Observed challenge, Recommendation, Buyer psychology, Checklist items] }
      - { entity: project, effect: reads, facts: [] }
    contexts:
      web:
        place: web-app
---

# Generating the room's copy

## Trigger

A room exists with staging directives typed into it.

## Outcome

The room carries its consultation copy and checklist.
