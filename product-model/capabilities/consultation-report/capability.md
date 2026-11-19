---
domain: lookbook-delivery
availability:
  - place: web-app
references:
  - kind: code
    role: implementation
    target: src/app/(dashboard)/projects/[id]/report/page.tsx
---

# Consultation report

The firm assembles the printable report from each room's challenge, recommendation and checklist that goes out to the homeowner.

> **Known issue (existing doc note).** A checklist-only mutation updates `checkedAt` / `completedSteps` but does not revalidate `/preview/{projectId}` (see `product-model/edge-cases.md`).
