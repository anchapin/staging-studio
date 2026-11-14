---
kind: primary
routes:
  web: Web app
steps:
  - text: "The firm user edits the firm's Psychology page copy and Sign-off page copy in Settings; the save is ownership-checked and revalidates the Lookbook and preview"
    kind: actor
    actor: user
    entities:
      - { entity: user, effect: changes, facts: [Psychology page content, Sign-off page content] }
    contexts:
      web:
        place: web-app
  - text: "The firm user sees the edited copy on the relevant Lookbook pages"
    kind: actor
    actor: user
    entities: []
    contexts:
      web:
        place: web-app
---

# Editing the firm page copy

## Trigger

The firm's User record exists.

## Outcome

Every Lookbook carries the firm's current copy.
