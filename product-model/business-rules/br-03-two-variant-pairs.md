---
appliesTo:
  - type: entity
    id: room
    facts: [Before images, After images, Selected variant]
references:
  - kind: code
    role: implementation
    target: src/app/actions/room-photos.ts
  - kind: code
    role: implementation
    target: src/components/lookbook/room-spread.tsx
---

# A Room holds exactly two variant pairs; the selected variant reaches the PDF

A Room holds exactly two before/after variant pairs, in slots 0 and 1.
The room's selectedVariantIndex decides which pair is rendered into the
Lookbook and therefore which pair reaches the exported PDF.

**Grant.** A room has two and only two variant slots; the selection is a
slot index, not an arbitrary image pointer.

**Enforcing code.**

- `src/app/actions/room-photos.ts` — `getSignedUploadUrl` and
  `confirmRoomPhotoUpload` accept a `variantSlot` that must be `0` or `1`
  (`isVariantSlot`), map it to the column pair
  (`beforeImageUrl`/`afterImageUrl` for slot 0,
  `beforeImageUrl2`/`afterImageUrl2` for slot 1), and derive the storage
  path and extension from the slot. A slot outside {0, 1} is rejected, and
  `storagePathMatchesSlot` refuses a storage path that does not belong to
  the claimed slot.
- `src/components/lookbook/room-spread.tsx` — the room spread renders the
  **selected** variant's image pair, following `selectedVariantIndex`, and
  falls back A → B when the selection is unset or points at an incomplete
  slot.

**Effect on the model.** [Room](../entities/room.md) exposes exactly
four image columns (two pairs) and one `selectedVariantIndex`. The
PDF-export path inherits the selection because it renders the same Lookbook
projection.
