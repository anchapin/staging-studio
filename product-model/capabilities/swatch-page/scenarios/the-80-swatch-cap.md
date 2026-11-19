---
kind: validation
routes:
  web: Web app
steps:
  - text: "The firm user attempts to add another swatch; the route counts the project's swatches first and answers 400 with \"Material swatch limit reached\" — the 80-swatch cap is enforced in application code, not the schema"
    kind: actor
    actor: user
    entities:
      - { entity: material-swatch, effect: reads, facts: [] }
      - { entity: project, effect: reads, facts: [] }
    contexts:
      web:
        place: web-app
  - text: "The firm user deletes a swatch to free a slot; rooms referencing it keep their finish directives but lose the swatch reference"
    kind: actor
    actor: user
    entities:
      - { entity: material-swatch, effect: removes }
      - { entity: room, effect: reads, facts: [] }
    contexts:
      web:
        place: web-app
---

# The 80-swatch cap

## Trigger

The project already holds 80 swatches.

## Outcome

The palette stays at or under the cap.
