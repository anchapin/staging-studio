---
kind: primary
routes:
  web: Web app
steps:
  - text: "The firm user submits an email and password on /login"
    kind: actor
    actor: user
    entities: []
    contexts:
      web:
        place: web-app
  - text: "The Product validates the credential through Supabase Auth and issues a session"
    kind: product
    entities: []
    contexts:
      web:
        place: web-app
  - text: "The Product resolves the session's email to the firm's User record; a session whose email has no record, or whose email is unconfirmed, resolves to no user and is routed to /setup"
    kind: product
    actor: user
    entities:
      - { entity: user, effect: reads, facts: [Email] }
    contexts:
      web:
        place: web-app
  - text: "The firm user lands on the dashboard, which redirects to /projects"
    kind: actor
    actor: user
    entities:
      - { entity: project, effect: reads, facts: [] }
    contexts:
      web:
        place: web-app
---

# Password sign-in

## Trigger

A firm user with a password wants to enter the product; the firm has a User record (or is about to create one via firm setup).

## Outcome

An authenticated session whose User owns the firm's projects.
