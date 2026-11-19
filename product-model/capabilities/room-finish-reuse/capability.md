---
domain: staging-workspace
availability:
  - place: web-app
references:
  - kind: code
    role: implementation
    target: src/app/actions/room-finish.ts
---

# Room finish reuse

The firm saves a chosen finish on a room and seeds it into the next photo's inpaint directives.
