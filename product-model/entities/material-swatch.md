---
relations:
  - entity: room
    verb: is the material finish of
    cardinality: one-to-many
references:
  - kind: code
    role: implementation
    target: prisma/schema.prisma
---

# MaterialSwatch

A finish or palette reference shown in the Lookbook's swatch page — the
named material ("White Oak", "Brushed Brass", "Cream Linen") with its hex
code, type and use case, and optionally its vendor and SKU. Persisted as
the Prisma model `MaterialSwatch` (`prisma/schema.prisma`), owned by its
`Project` (`MaterialSwatch.project`, cascade on delete).

## Information kept

- **Name** — `name`: the material's display name
- **Hex code** — `hexCode`: the material's colour, e.g. `#C8A882`
- **Material type** — `materialType`: "Hardwood", "Metal", "Fabric"
- **Use case** — `useCase`: "Flooring", "Hardware", "Textile"
- **Vendor** — `vendor`: procurement detail, optional
- **SKU** — `sku`: procurement detail, optional
- **Sort order** — `sortOrder`: manual ordering on the swatch page

## Why it exists

- Swatches belong to a `Project`, so they are shared across the project's
  rooms.
- The swatch page of the Lookbook renders `MaterialSwatch` rows
  (`src/components/lookbook/material-swatch-page.tsx`).
- A room may point at one swatch as its **material finish**, which can then
  be reused on that room's next photo
  ([room-finish-reuse capability](../capabilities/room-finish-reuse/capability.md)).

## Notes

- Writing swatches mutates a lookbook-rendered field, so those writes are
  bound by [BR-13](../business-rules/br-13-preview-revalidation.md).
