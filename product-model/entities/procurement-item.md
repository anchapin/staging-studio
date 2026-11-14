---
references:
  - kind: code
    role: implementation
    target: prisma/schema.prisma
---

# ProcurementItem

One line of the Lookbook's furniture procurement table — a piece the
staging package calls for, with its category, description, procurement
status and cost estimate. Persisted as the Prisma model `ProcurementItem`
(`prisma/schema.prisma`), owned by its `Project`
(`ProcurementItem.project`, cascade on delete).

## Information kept

- **Category** — `category`: "Seating", "Tables", "Lighting"
- **Item** — `item`: "Sofa", "Dining Table", "Floor Lamp"
- **Description** — `description`: what the piece is
- **Procurement status** — `status`: `"needed"` | `"ordered"` | `"received"`
- **SKU** — `sku`: optional procurement detail
- **Estimated cost** — `estCost`: estimated cost, nullable
- **Vendor** — `vendor`: optional procurement detail
- **Notes** — `notes`: optional procurement detail
- **Sort order** — `sortOrder`: manual ordering in the table

## Why it exists

- Items belong to a `Project` and render on the Lookbook's furniture
  procurement table (`src/components/lookbook/furniture-procurement-table.tsx`).
- They are written in bulk by `saveProcurementItems`
  (`src/app/actions/procurement.ts`).

## Notes

- Writing procurement items mutates a lookbook-rendered field and is
  therefore bound by [BR-13](../business-rules/br-13-preview-revalidation.md).
