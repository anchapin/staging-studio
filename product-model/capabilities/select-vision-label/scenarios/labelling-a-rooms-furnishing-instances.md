---
kind: primary
routes:
  web: Web app
steps:
  - text: "The firm user triggers vision labelling for the room's photo; one labelling unit is claimed against the daily cap of 50"
    kind: actor
    actor: user
    entities:
      - { entity: room, effect: reads, facts: [] }
    contexts:
      web:
        place: web-app
  - text: "The Product labels each detected furnishing instance with GPT-4o-mini vision and persists one VisionLabel per instance, keyed by image hash + concept + instance index and scoped to the paying user"
    kind: product
    actor: user
    entities:
      - { entity: vision-label, effect: creates, facts: [Image hash, Concept, Instance index, Label, Score, Paying user] }
    contexts:
      web:
        place: web-app
---

# Labelling a room's furnishing instances

## Trigger

A room with an uploaded before-image.

## Outcome

Every furnishing instance in the photo has a label.
