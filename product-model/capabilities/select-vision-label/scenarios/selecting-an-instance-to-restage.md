---
kind: primary
routes:
  web: Web app
steps:
  - text: "The firm user clicks a labelled furnishing in the canvas; hit-testing resolves the click to a label instance — the selection itself is UI state"
    kind: actor
    actor: user
    entities:
      - { entity: vision-label, effect: reads, facts: [Concept, Instance index] }
    contexts:
      web:
        place: web-app
  - text: "The firm user runs the staging with the selected instances feeding the staging directives and the mask"
    kind: actor
    actor: user
    entities:
      - { entity: inpaint-request, effect: creates, to: In queue, facts: [Variant slot, Source slot] }
    contexts:
      web:
        place: web-app
---

# Selecting an instance to restage

## Trigger

Labels exist for the room.

## Edge cases

- On success the run also saves an InpaintVersion snapshot of the result

## Outcome

Exactly the chosen pieces are restaged.
