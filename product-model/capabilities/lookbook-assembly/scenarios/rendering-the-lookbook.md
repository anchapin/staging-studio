---
kind: primary
routes:
  web: Web app
steps:
  - text: "The firm user opens /projects/{projectId}/lookbook; the read resolves the session user first"
    kind: actor
    actor: user
    entities:
      - { entity: project, effect: reads, facts: [] }
    contexts:
      web:
        place: web-app
  - text: "The Product gathers the Lookbook projection from the project and its rooms: before/after pairs from the selected variants, no photo pair for a room without a complete variant, a \"Virtually staged\" badge on the after-image of a complete variant when the project's disclosure toggle is on, the firm name and refreshed logo, the headline used for the OG/social-share card title, and a stored caption shown truncated at 80 characters in the admin list"
    kind: product
    entities:
      - { entity: project, effect: reads, facts: [Property address, Target buyer, Cover photo, Headline, Share caption, Virtually staged disclosure] }
      - { entity: room, effect: reads, facts: [Before images, After images, Selected variant] }
      - { entity: user, effect: reads, facts: [Firm name, Firm logo] }
    contexts:
      web:
        place: web-app
  - text: "The firm user sees the firm, cover, room spreads in sort order, swatch page, procurement page, ROI section, finishing touches, psychology and sign-off areas rendered — including the Firm Setup branding's Psychology page copy"
    kind: actor
    actor: user
    entities:
      - { entity: room, effect: reads, facts: [] }
    contexts:
      web:
        place: web-app
---

# Rendering the Lookbook

## Trigger

A project exists; sections render the project's cover hero, investment summary, ROI section, per-room spreads in sortOrder with the selected variant's pair, finishing touches and notes.

## Outcome

A client-ready magazine for the project.
