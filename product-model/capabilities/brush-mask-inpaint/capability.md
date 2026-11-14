---
domain: staging-workspace
availability:
  - place: web-app
references:
  - kind: code
    role: implementation
    target: src/app/api/inpaint/route.ts
  - kind: code
    role: implementation
    target: src/components/edit-room/MaskLayer.tsx
---

# Brush-mask inpaint

The firm paints a mask over a region of a before-photo and asks the model to restage that region, producing an after-image.
