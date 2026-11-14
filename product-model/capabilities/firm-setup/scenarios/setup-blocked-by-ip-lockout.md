---
kind: validation
routes:
  web: Web app
steps:
  - text: "A visitor submits the setup form from the rate-limited IP"
    kind: actor
    actor: user
    entities: []
    contexts:
      web:
        place: web-app
  - text: "The Product refuses the attempt: the IP's counter is at the maximum of 10 attempts within the one-hour window, so the IP is locked for the remainder of the window and no User record is created"
    kind: product
    entities:
      - { entity: user, effect: reads, facts: [] }
    contexts:
      web:
        place: web-app
---

# Setup blocked by IP lockout

## Trigger

The client IP has 10 failed setup attempts within the sliding one-hour window.

## Outcome

No firm record is created; the IP must wait out the window.
