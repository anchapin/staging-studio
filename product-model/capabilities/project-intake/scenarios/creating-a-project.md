---
kind: primary
routes:
  web: Web app
steps:
  - text: "The firm user opens /projects/new and enters the property address, client name, target buyer and staging aesthetic, and picks a staging package card"
    kind: actor
    actor: user
    entities:
      - { entity: project, effect: reads, facts: [] }
    contexts:
      web:
        place: web-app
  - text: "The firm user submits the form; the ownership-checked server action creates the project for the session's user"
    kind: actor
    actor: user
    entities:
      - { entity: project, effect: creates, facts: [Property address, Client name, Target buyer, Staging aesthetic, Staging package] }
    contexts:
      web:
        place: web-app
  - text: "The firm user lands on the new project's workspace, scoped to the owning user"
    kind: actor
    actor: user
    entities:
      - { entity: project, effect: reads, facts: [] }
    contexts:
      web:
        place: web-app
---

# Creating a project

## Trigger

A signed-in session resolving to an owning User record.

## Outcome

A Project exists and the user is in its workspace.
