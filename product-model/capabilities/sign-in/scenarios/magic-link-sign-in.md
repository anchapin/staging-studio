---
kind: primary
routes:
  web: Web app
steps:
  - text: "The firm user requests a magic link"
    kind: actor
    actor: user
    entities: []
    contexts:
      web:
        place: web-app
  - text: "The firm user follows the emailed link; Supabase redirects to /auth/callback and a session is issued"
    kind: actor
    actor: user
    entities: []
    contexts:
      web:
        place: web-app
  - text: "The Product resolves the session to the owning User record; an unknown email lands on /setup"
    kind: product
    actor: user
    entities:
      - { entity: user, effect: reads, facts: [Email] }
    contexts:
      web:
        place: web-app
---

# Magic-link sign-in

## Trigger

The firm user selects the login form's magic-link toggle instead of entering a password.

## Outcome

An authenticated session whose User owns the firm's projects.
