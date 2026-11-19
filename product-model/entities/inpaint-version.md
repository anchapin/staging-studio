---
references:
  - kind: code
    role: implementation
    target: prisma/schema.prisma
---

# InpaintVersion

A restorable snapshot of one completed inpaint run, scoped to a room's
variant slot. Version history is what lets a user compare and restore
earlier takes instead of losing them to the next refinement. Persisted as
the Prisma model `InpaintVersion` (`prisma/schema.prisma`), owned by its
`Room` (`InpaintVersion.room`, cascade on delete).

## Information kept

- **Variant slot** — `variantSlot`: `0` or `1` — which "after" slot this version occupies
- **Result image** — `resultUrl`: the full-resolution staged image
- **Thumbnail** — `thumbnailUrl`: the low-resolution thumbnail used in the version strip
- **Seed** — `seed`: the provider seed used for the run, so it can be regenerated
- **Prompt directives** — `promptDirectives`: the staging directives the run was given
- **When saved** — `createdAt`: when the version was saved

## Why it exists

- Every completed run is saved as a version
  (`src/app/actions/inpaint-versions.ts` → `saveInpaintVersion`).
- The editor's version strip browses them and restores one
  (`restoreInpaintVersion`); a restore never destroys the other versions.

## Notes

- A version is a snapshot, not a lifecycle-bearing record: it has no
  status field; its existence means "this run completed".
- Versions are the mechanism behind the
  [inpaint version history capability](../capabilities/inpaint-version-history/capability.md),
  and their restoration writes the selected variant slot's after-image —
  so that write is subject to
  [BR-03](../business-rules/br-03-two-variant-pairs.md) and
  [BR-13](../business-rules/br-13-preview-revalidation.md).
