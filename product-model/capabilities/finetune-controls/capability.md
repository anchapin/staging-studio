---
domain: staging-workspace
availability:
  - place: web-app
references:
  - kind: code
    role: implementation
    target: src/app/actions/room-mutations.ts
  - kind: code
    role: implementation
    target: src/lib/finetune-wire.ts
---

# FineTune controls

The firm tunes a run with three controls — strength, expand and seed — which are persisted per room.

Adherence and shadows controls were removed and are not part of this model.
