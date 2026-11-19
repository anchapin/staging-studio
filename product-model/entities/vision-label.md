---
references:
  - kind: code
    role: implementation
    target: prisma/schema.prisma
---

# VisionLabel

A **detected furnishing instance** — one piece of furniture the vision
model saw in a photo, with its concept label ("sofa", "rug", "lamp"), the
instance index within that concept, and a confidence score. Labels are
**cached**: re-opening the editor does not re-bill the vision call.
Persisted as the Prisma model `VisionLabel` (`prisma/schema.prisma`).

## Cache key

The cache key is **image hash + concept + instance index**, scoped to the
paying user: `@@unique([userId, imageUrlHash, concept, instanceIndex])`.
`userId` scopes the cache so one user's billed labels are not served to
another user at no cost; `roomId` is a nullable denormalised filter
column only — not a foreign key, not cascade-linked — so labels survive
room deletes.

## Information kept

- **Image hash** — `imageUrlHash`: stable hash of the image URL — the image identity in the cache key
- **Concept** — `concept`: the furnishing category
- **Instance index** — `instanceIndex`: which instance of that concept in the image
- **Label** — `label`: the model's label text
- **Score** — `score`: confidence, nullable
- **Paying user** — `userId`: cache scope — the user who paid for the vision call
- **Room filter** — `roomId`: optional denormalised room filter only; not a foreign key

## Notes

- VisionLabel stands alone: it declares no owner relation, so it survives
  room deletes; `roomId` references a `Room` only as a denormalised
  filter.
- Producing labels is capped by `DAILY_LABEL_LIMIT`
  ([BR-04](../business-rules/br-04-daily-caps.md)).
- The label instance is what makes a furnishing **clickable** in the
  inspector (hit-testing in `src/lib/instance-hit-test.ts`) — the
  mechanism behind the
  [vision-label selection capability](../capabilities/select-vision-label/capability.md).
