---
domain: intake
availability:
  - place: web-app
references:
  - kind: code
    role: implementation
    target: src/app/actions/room-batch.ts
  - kind: code
    role: implementation
    target: src/app/(dashboard)/projects/[id]/rooms/page.tsx
---

# Batch room upload and room-type detection

The firm creates every room of a property in one pass and lets AI detect each room's type from the uploaded photos.
