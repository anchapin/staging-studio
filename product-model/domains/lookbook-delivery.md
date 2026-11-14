---
references:
  - kind: code
    role: implementation
    target: src/app/api/sign-project/route.ts
  - kind: code
    role: implementation
    target: src/app/api/export-pdf/route.ts
---

# Lookbook & delivery

Assembling the Project's rooms, copy, metrics, swatches and procurement
into the Lookbook, having the client sign it, and exporting the Hero
Artifact PDF.

## Boundary

Begins when the workspace's rooms are staged and ends when the exported PDF
(Lookbook / Hero Artifact) is in the client's hands. The Lookbook itself is
a **projection of `Project`** — it has no lifecycle of its own; its
signature state lives on the `Project` as `clientSignatureStatus` /
`clientSignatureTimestamp`. It does not own the creation of projects or
rooms (Intake) or the staging work that produces the rooms' imagery
(Staging workspace). PDF capture mode is a rendering detail of the print
surface and is not modelled.

## What it contains

| Capability | Where |
| --- | --- |
| [Lookbook assembly](../capabilities/lookbook-assembly/capability.md) | `/projects/[id]/lookbook`, `src/components/lookbook/` |
| [ROI dashboard](../capabilities/roi-dashboard/capability.md) | `src/components/lookbook/roi-metrics-dashboard.tsx` |
| [Swatch page](../capabilities/swatch-page/capability.md) | `src/components/lookbook/material-swatch-page.tsx` |
| [Procurement table](../capabilities/procurement-table/capability.md) | `src/components/lookbook/furniture-procurement-table.tsx` |
| [Consultation report](../capabilities/consultation-report/capability.md) | `/projects/[id]/report` |
| [Client sign-off](../capabilities/client-sign-off/capability.md) | `POST /api/sign-project`, `src/app/actions/project.ts` |
| [PDF export](../capabilities/pdf-export/capability.md) | `POST /api/export-pdf`, `/preview/[id]` |

## Entities touched

- [Project](../entities/project.md) — the Lookbook's backing record
  and the owner of the sign-off.
- [Room](../entities/room.md) — the spreads, copy and selected variant.
- [MaterialSwatch](../entities/material-swatch.md) — the swatch page.
- [ProcurementItem](../entities/procurement-item.md) — the
  procurement table.
- [SignOff](../entities/sign-off.md) — the client's signature and
  consent attestation.

## Governing rules

- [BR-02 Sign-off refused once signed](../business-rules/br-02-sign-off-immutable.md)
- [BR-03 Exactly two variant pairs per room](../business-rules/br-03-two-variant-pairs.md)
- [BR-06 Short-lived preview token](../business-rules/br-06-preview-token-ttl.md)
- [BR-07 Preview token scoping](../business-rules/br-07-preview-token-scoping.md)
- [BR-08 Consent attestation required](../business-rules/br-08-consent-attestation.md)
- [BR-09 Signature encryption at rest](../business-rules/br-09-signature-encrypted-at-rest.md)
- [BR-11 Export quota unit not refunded on non-PDF body](../business-rules/br-11-export-unit-not-refunded.md)
- [BR-13 Preview revalidation on lookbook-rendered mutations](../business-rules/br-13-preview-revalidation.md)
- [BR-14 "Virtually staged" disclosure mark](../business-rules/br-14-virtually-staged-disclosure.md)

## Boundary notes

- PDF capture mode (the `capture=pdf` print-CSS switch) is a rendering
  detail, not a variation, and is not modelled.
- The print surface is modelled as its own
  [Interface](../interfaces/print-surface.md) because the
  preview-token rules anchor there.
