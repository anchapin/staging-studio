---
domain: staging-workspace
availability:
  - place: web-app
references:
  - kind: code
    role: implementation
    target: src/app/api/segment/furnishings/route.ts
  - kind: code
    role: implementation
    target: src/lib/segment-cache.ts
---

# SAM auto-segmentation

The model detects the furnishings in the room automatically, so masks need not be painted by hand.

> **Current state.** No wired inference provider implements SAM 3.1, so `POST /api/segment/furnishings` checks provider capability *before* claiming a quota unit and returns a classified `501` (`retryable: false`, `code: "segmentation-failed"`). The capability is modelled because it is part of the intended product; the daily cap it would consume is currently inert (BR-15).
