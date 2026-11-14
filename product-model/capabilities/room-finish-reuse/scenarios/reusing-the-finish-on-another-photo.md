---
kind: primary
routes:
  web: Web app
steps:
  - text: "The firm user runs an inpaint on the room's other photo with the saved finish seeded"
    kind: actor
    actor: user
    entities:
      - { entity: inpaint-request, effect: creates, to: In queue, facts: [Variant slot, Source slot] }
      - { entity: room, effect: reads, facts: [] }
    contexts:
      web:
        place: web-app
  - text: "The Product writes the new after-image to the target slot and revalidates the preview"
    kind: product
    actor: user
    entities:
      - { entity: room, effect: changes, facts: [After images] }
    contexts:
      web:
        place: web-app
---

# Reusing the finish on another photo

## Trigger

The room carries a saved finish.

## Edge cases

- On success the run also saves an InpaintVersion snapshot of the result

## Outcome

The room's angles share one finish.
