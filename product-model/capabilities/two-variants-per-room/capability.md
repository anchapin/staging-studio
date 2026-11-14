---
domain: staging-workspace
availability:
  - place: web-app
references:
  - kind: code
    role: implementation
    target: src/app/actions/room-variants.ts
---

# Two variants per room

Each room keeps two before/after pairs, and the selected variant is the one that reaches the Lookbook and the PDF.
