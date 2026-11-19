---
relations:
  - entity: inpaint-request
    verb: has
    cardinality: one-to-many
  - entity: inpaint-version
    verb: has
    cardinality: one-to-many
references:
  - kind: code
    role: implementation
    target: prisma/schema.prisma
---

# Room

A single room within a project — **the unit of work** in the staging
workspace. It carries the two before/after variant pairs, the AI copy, the
FineTune settings, and the reused material finish. Persisted as the Prisma
model `Room` (`prisma/schema.prisma`), owned by its `Project`
(`Room.project`, cascade on delete).

## Information kept

- **Name** — `name`: the room's name ("Primary Bedroom", "Kitchen"), also AI-detected at batch upload
- **Before images** — `beforeImageUrl` / `beforeImageUrl2`: the before photos of variant slots 0 and 1
- **After images** — `afterImageUrl` / `afterImageUrl2`: the staged results of variant slots 0 and 1
- **Selected variant** — `selectedVariantIndex`: `0` or `1` — the variant that reaches the PDF
- **Staging directives** — `rawDirectives`: the user's freeform staging bullets
- **Observed challenge** — `observedChallenge`: an AI room copy output
- **Recommendation** — `recommendation`: an AI room copy output; also the listing-copy fallback when the listing columns are unset
- **Buyer psychology** — `buyerPsychology`: an AI room copy output
- **Checklist items** — `checklistItems`: an AI room copy output
- **Lookbook headline** — `lookbookHeadline`: the listing copy the Lookbook shows beside the room spread
- **Lookbook body** — `lookbookBody`: the listing copy the Lookbook shows beside the room spread; falls back to Recommendation when unset (`src/lib/listing-copy.ts`)
- **FineTune strength** — `fineTuneStrength`: one of the three surviving FineTune controls
- **FineTune expand** — `fineTuneExpand`: one of the three surviving FineTune controls
- **FineTune seed** — `fineTuneSeed`: one of the three surviving FineTune controls
- **Sort order** — `sortOrder`: the room's position in the project's room order
- **Material finish** — `materialFinishId`: the saved MaterialSwatch this room reuses as its finish (`Room.materialFinish`, `onDelete: SetNull`)
- **Material finish directives** — `materialFinishDirectives`: the directives captured with the saved finish
- **Material finish concept label** — `materialFinishConceptLabel`: the concept label captured with the saved finish

## Why it exists

- Batch room upload creates every room of a property in one pass
  (`src/app/actions/room-batch.ts`).
- Each room holds **exactly two** variant pairs (slots 0 and 1); the
  selected variant controls what reaches the PDF
  ([BR-03](../business-rules/br-03-two-variant-pairs.md)).

## Notes

- `SelectionLog` is related to `Room` in the schema but is **not** modelled
  (training-corpus tooling — see [coverage.md exclusions](../coverage.md)).
