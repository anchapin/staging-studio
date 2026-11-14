---
kind: primary
result: achieved
routes:
  main: Core journey
steps:
  - text: "The firm user signs in with a password and lands on the dashboard"
    kind: actor
    actor: user
    capability: sign-in
    entities: []
    contexts:
      main:
        place: web-app
  - text: "The firm user captures the firm's name and logo, creating the firm's branding record"
    kind: actor
    actor: user
    capability: firm-setup
    entities:
      - { entity: user, effect: creates, facts: [Firm name, Owner name, Firm logo] }
    contexts:
      main:
        place: web-app
  - text: "The firm user creates the staging job from the intake form: property address, client name, target buyer, staging aesthetic and staging package"
    kind: actor
    actor: user
    capability: project-intake
    entities:
      - { entity: project, effect: creates, facts: [Property address, Client name, Target buyer, Staging aesthetic, Staging package] }
    contexts:
      main:
        place: web-app
  - text: "The firm user creates all the property's rooms in one pass"
    kind: actor
    actor: user
    capability: batch-room-upload
    entities:
      - { entity: room, effect: creates, facts: [Name, Sort order] }
    contexts:
      main:
        place: web-app
  - text: "The firm user uploads a before-photo into the room's first variant slot"
    kind: actor
    actor: user
    capability: before-photo-upload
    entities:
      - { entity: room, effect: changes, facts: [Before images] }
    contexts:
      main:
        place: web-app
  - text: "The firm user paints a mask and runs the inpaint, staging the room"
    kind: actor
    actor: user
    capability: brush-mask-inpaint
    entities:
      - { entity: inpaint-request, effect: creates, to: In queue, facts: [Variant slot, Source slot] }
      - { entity: room, effect: reads, facts: [] }
    contexts:
      main:
        place: web-app
  - text: "The firm user generates the room's consultation copy from its staging directives"
    kind: actor
    actor: user
    capability: ai-room-copy
    entities:
      - { entity: room, effect: changes, facts: [Observed challenge, Recommendation, Buyer psychology, Checklist items] }
    contexts:
      main:
        place: web-app
  - text: "The firm user reviews the assembled Lookbook for the project"
    kind: actor
    actor: user
    capability: lookbook-assembly
    entities:
      - { entity: project, effect: reads, facts: [] }
      - { entity: room, effect: reads, facts: [] }
    contexts:
      main:
        place: web-app
  - text: "The client opens the share link, attests consent and signs the plan"
    kind: actor
    actor: client
    capability: client-sign-off
    entities:
      - { entity: sign-off, effect: changes, from: Pending, to: Signed, facts: [Signature, Consent attested, When consent attested, When signed] }
    contexts:
      main:
        place: print-surface
  - text: "The firm user exports the Lookbook as a PDF"
    kind: actor
    actor: user
    capability: pdf-export
    entities:
      - { entity: project, effect: reads, facts: [] }
    contexts:
      main:
        place: web-app
---

# Complete a staging job

## Trigger

A new listing needs staging, and the firm user has (or is given) an account. A firm user takes the property from intake to a client-approved, printable Lookbook, and the client signs it off along the way.

## Outcome

The project is signed off by the client and the firm holds the exported PDF.
