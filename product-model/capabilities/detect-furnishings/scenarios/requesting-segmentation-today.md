---
kind: edge
routes:
  web: Web app
steps:
  - text: "The firm user requests auto-segmentation"
    kind: actor
    actor: user
    entities: []
    contexts:
      web:
        place: web-app
  - text: "The Product checks provider capability before claiming any quota unit and answers 501 with retryable: false and code \"segmentation-failed\"; no quota unit is claimed and no detection is cached"
    kind: product
    entities: []
    contexts:
      web:
        place: web-app
  - text: "The firm user falls back to the brush tools — the working path"
    kind: actor
    actor: user
    entities: []
    contexts:
      web:
        place: web-app
---

# Requesting segmentation today

## Trigger

The wired providers do not implement SAM 3.1.

## Outcome

No daily cap is burned; the user masks by hand.
