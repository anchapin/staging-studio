---
kind: validation
routes:
  print: Print surface
steps:
  - text: "The client submits a second signature for the now-signed plan"
    kind: actor
    actor: client
    entities: []
    contexts:
      print:
        place: print-surface
  - text: "The Product refuses: the route rejects an already-signed project before any Prisma access, so the first signature stands and the record is unchanged"
    kind: product
    entities:
      - { entity: sign-off, effect: reads, facts: [] }
      - { entity: project, effect: reads, facts: [] }
    contexts:
      print:
        place: print-surface
---

# A second signing attempt

## Trigger

The sign-off is already Signed.

## Outcome

The first signature stands.
