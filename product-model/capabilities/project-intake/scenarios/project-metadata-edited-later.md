---
kind: primary
routes:
  web: Web app
steps:
  - text: "The firm user edits the project's metadata through the ownership-checked server action"
    kind: actor
    actor: user
    entities:
      - { entity: project, effect: changes, facts: [Property address, Client name, Target buyer, Staging aesthetic, Staging package, Staging directives] }
    contexts:
      web:
        place: web-app
  - text: "The Product invalidates the cached pages, revalidating /projects/{projectId}, /projects/{projectId}/lookbook and /preview/{projectId} — the last because project metadata is lookbook-rendered"
    kind: product
    actor: user
    entities:
      - { entity: project, effect: reads, facts: [] }
    contexts:
      web:
        place: web-app
---

# Project metadata edited later

## Trigger

A Project owned by the session's user exists.

## Outcome

The project view and the print surface show the new metadata.
