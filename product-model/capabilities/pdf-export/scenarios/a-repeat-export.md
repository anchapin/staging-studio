---
kind: primary
routes:
  web: Web app
steps:
  - text: "The firm user requests the export again; a new unit is claimed against the same daily cap of 20"
    kind: actor
    actor: user
    entities: []
    contexts:
      web:
        place: web-app
  - text: "The Product fetches the print surface again through Browserless with a freshly minted token; the export is not cached — the PDF is not a stored file, it is produced per request"
    kind: product
    entities:
      - { entity: project, effect: reads, facts: [Property address, Headline] }
    contexts:
      web:
        place: web-app
  - text: "The firm user downloads the fresh PDF"
    kind: actor
    actor: user
    entities: []
    contexts:
      web:
        place: web-app
---

# A repeat export

## Trigger

The firm already exported today.

## Outcome

A fresh PDF, and one unit closer to the cap.
