---
kind: primary
routes:
  web: Web app
steps:
  - text: "The firm user requests the export for the project; the export unit (daily cap 20) is claimed atomically before any external call, and the claim is per firm user"
    kind: actor
    actor: user
    entities:
      - { entity: project, effect: reads, facts: [] }
    contexts:
      web:
        place: web-app
  - text: "The Product fetches the print surface: Browserless renders the exact /preview/{id} page the client sees, with a fresh preview token minted for the project; on return, if the body is not a PDF the export attempt is answered 502 as retryable and the unit stays claimed"
    kind: product
    entities:
      - { entity: project, effect: reads, facts: [Property address, Headline] }
    contexts:
      web:
        place: web-app
  - text: "The firm user downloads the PDF that arrives"
    kind: actor
    actor: user
    entities: []
    contexts:
      web:
        place: web-app
---

# Exporting the Lookbook PDF

## Trigger

An authenticated session resolving to an owning User record.

## Edge cases

- A fetch timeout refunds the claimed unit (504, Retry-After: 5) — a slow queue does not consume an export
- A non-PDF 2xx body does NOT refund the unit: the export attempt consumed a real render

## Outcome

The firm has the printable file.
