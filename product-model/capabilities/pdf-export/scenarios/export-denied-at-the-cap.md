---
kind: validation
routes:
  web: Web app
steps:
  - text: "The firm user requests an export; the session resolves to the owning User record and the claim finds nothing left"
    kind: actor
    actor: user
    entities: []
    contexts:
      web:
        place: web-app
  - text: "The Product refuses the request before any external call, so no Browserless render is started and the client is told the cap is reached"
    kind: product
    entities: []
    contexts:
      web:
        place: web-app
---

# Export denied at the cap

## Trigger

The firm user has already claimed 20 export units today.

## Outcome

No PDF and no external spend; the cap resets tomorrow.
