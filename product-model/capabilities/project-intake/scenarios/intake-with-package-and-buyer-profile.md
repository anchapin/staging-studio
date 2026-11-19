---
kind: primary
routes:
  web: Web app
steps:
  - text: "The firm user selects a staging package (essential / premium / turnkey) and a Target Buyer profile, and creates the project with them"
    kind: actor
    actor: user
    entities:
      - { entity: project, effect: creates, facts: [Staging package, Target buyer, Buyer demographics] }
    contexts:
      web:
        place: web-app
  - text: "The firm user adds project-wide staging directives"
    kind: actor
    actor: user
    entities:
      - { entity: project, effect: changes, facts: [Staging directives] }
    contexts:
      web:
        place: web-app
---

# Intake with a staging package and buyer profile

## Trigger

As creating a project, with the package and buyer profile specified at intake.

## Outcome

A fully specified Project.
