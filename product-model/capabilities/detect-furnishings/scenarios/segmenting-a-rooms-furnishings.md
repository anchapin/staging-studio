---
kind: primary
routes:
  web: Web app
steps:
  - text: "The firm user requests auto-segmentation for the room; the provider-capability check runs first and one segmentation unit is claimed against the daily cap of 100"
    kind: actor
    actor: user
    entities:
      - { entity: room, effect: reads, facts: [] }
    contexts:
      web:
        place: web-app
  - text: "The Product detects the furnishings and their masks; the results are cached by image hash, so a repeated request does not re-infer"
    kind: product
    entities: []
    contexts:
      web:
        place: web-app
  - text: "The firm user sees the detected objects in the inspector's object list and as concept chips — the source of the clickable VisionLabel instances"
    kind: actor
    actor: user
    entities:
      - { entity: vision-label, effect: reads, facts: [Concept, Label] }
    contexts:
      web:
        place: web-app
---

# Segmenting a room's furnishings (intended behaviour)

## Trigger

A room with an uploaded before-image, and a SAM-capable provider wired.

## Outcome

Furnishings are selectable without hand-painting masks.
