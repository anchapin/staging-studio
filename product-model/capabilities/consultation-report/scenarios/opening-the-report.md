---
kind: primary
routes:
  web: Web app
steps:
  - text: "The firm user opens /projects/{projectId}/report; the read resolves the session user first"
    kind: actor
    actor: user
    entities:
      - { entity: project, effect: reads, facts: [] }
    contexts:
      web:
        place: web-app
  - text: "The Product assembles the report from each room's observed challenge, recommendation and checklist items (only those present) and a Project Title summary header — the in-app title shown on the first workspace step"
    kind: product
    entities:
      - { entity: room, effect: reads, facts: [Observed challenge, Recommendation, Checklist items] }
      - { entity: project, effect: reads, facts: [Property address] }
    contexts:
      web:
        place: web-app
  - text: "The firm user sees the report page render the assembled consultation"
    kind: actor
    actor: user
    entities: []
    contexts:
      web:
        place: web-app
---

# Opening the report

## Trigger

A project with rooms that carry copy.

## Outcome

A printable consultation exists for the project.
