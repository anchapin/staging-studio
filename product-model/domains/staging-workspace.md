---
references:
  - kind: code
    role: implementation
    target: src/app/actions/room-batch.ts
  - kind: code
    role: implementation
    target: src/app/api/inpaint/route.ts
---

# Staging workspace

The per-project editor where a firm's user turns before-photos into
staged after-images, chooses what to restage, and writes the copy.

## Boundary

The staging workspace is `/projects/[id]` — one workspace per property,
with `Room` as the unit of work. It begins with the rooms' before-photos and
ends with the room's selected variant and its copy being final. It does not
own the creation of projects or rooms (Intake), and it does not own the
assembly of the Lookbook, the client's sign-off, or the PDF export
(Lookbook & delivery).

## What it contains

| Capability | Where |
| --- | --- |
| [Brush-mask inpaint](../capabilities/brush-mask-inpaint/capability.md) | `POST /api/inpaint`, `src/components/edit-room/MaskLayer.tsx` |
| [SAM auto-segmentation](../capabilities/detect-furnishings/capability.md) | `POST /api/segment/furnishings` |
| [Vision-label selection](../capabilities/select-vision-label/capability.md) | `POST /api/label-instances` |
| [Inpaint version history](../capabilities/inpaint-version-history/capability.md) | `src/app/actions/inpaint-versions.ts` |
| [Two variants per room](../capabilities/two-variants-per-room/capability.md) | `src/app/actions/room-variants.ts` |
| [AI room copy](../capabilities/ai-room-copy/capability.md) | `POST /api/generate-copy`, `src/app/actions/room-copy.ts` |
| [Listing copy](../capabilities/listing-copy/capability.md) | `src/app/actions/room-copy.ts`, `src/lib/listing-copy.ts` |
| [Room finish reuse](../capabilities/room-finish-reuse/capability.md) | `src/app/actions/room-finish.ts` |
| [FineTune controls](../capabilities/finetune-controls/capability.md) | `src/app/actions/room-mutations.ts`, `src/lib/finetune-wire.ts` |

## Entities touched

- [Room](../entities/room.md) — the unit of work.
- [InpaintRequest](../entities/inpaint-request.md) — one persisted
  provider run per staging attempt.
- [InpaintVersion](../entities/inpaint-version.md) — a restorable
  snapshot of a completed run.
- [VisionLabel](../entities/vision-label.md) — a cached detected
  furnishing instance.

## Governing rules

- [BR-01 Ownership-checked writes](../business-rules/br-01-ownership-checked-writes.md)
- [BR-03 Exactly two variant pairs per room](../business-rules/br-03-two-variant-pairs.md)
- [BR-04 Daily caps](../business-rules/br-04-daily-caps.md)
- [BR-10 Quota units are never re-derived from a deletable table](../business-rules/br-10-quota-not-re-derived.md)
- [BR-12 Inpaint quota charged after the provider call](../business-rules/br-12-inpaint-quota-after-call.md)
- [BR-13 Preview revalidation on lookbook-rendered mutations](../business-rules/br-13-preview-revalidation.md)
- [BR-15 Segment daily cap (currently inert)](../business-rules/br-15-segment-cap-inert.md)

## Boundary notes

- `SelectionLog` and its training-corpus tooling are **not** modelled —
  see [coverage.md exclusions](../coverage.md).
- SAM auto-segmentation is modelled as a capability, but the segment route
  currently fails fast with a classified `501` before claiming quota
  ([BR-15](../business-rules/br-15-segment-cap-inert.md)).
