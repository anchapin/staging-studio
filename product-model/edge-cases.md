---
type: EdgeCases
name: Edge cases
id: edge-cases
summary: >-
  Further paths that exist in the product but are deliberately not modelled
  as scenarios, because the format's resource types cap scenarios at three
  per capability.
---

# Edge cases

The format's resource types provide no home for "additional edge-case
paths" as a first-class resource, so they are listed here — outside the
modelled resources — deliberately. Every bullet names the capability it
extends and the rule it sits under.

## Sign in / firm setup

- A session exists but the Supabase email is unconfirmed
  (`email_confirmed_at === null`): the session resolves to no user and the
  visitor is routed to setup rather than the dashboard
  ([BR-01](./business-rules/br-01-ownership-checked-writes.md)).
- A valid session whose email has no `User` row at all: same routing.
- `PREVIEW_TOKEN_SECRET` unset: a fixed dev-only fallback is used so CI
  and local development keep working; production must set the variable
  ([BR-06](./business-rules/br-06-preview-token-ttl.md)).
- `SIGNATURE_ENCRYPTION_KEY` unset or not 32 bytes: encryption cannot run
  ([BR-09](./business-rules/br-09-signature-encrypted-at-rest.md)).

## Intake

- A staging package that is no longer in the catalogue: `getStagingPackage`
  returns `null`; the project keeps its stored `stagingPackage` string.
- A project created before `virtuallyStagedLabelEnabled` existed: `null`
  is read as **enabled** ([BR-14](./business-rules/br-14-virtually-staged-disclosure.md)).
- Batch upload where AI room-type detection is inconclusive: the room
  keeps the name the user gave it.
- A photo upload whose stored path does not match the claimed variant slot:
  rejected by `storagePathMatchesSlot`
  ([BR-03](./business-rules/br-03-two-variant-pairs.md)).
- Batch creation whose transaction fails after its photos were uploaded:
  the uploaded photos are reclaimed (the #1145 orphan rule), so a failed
  batch leaves no storage orphans behind; the reclaim is best-effort and
  never changes the returned error.

## Staging workspace

- An inpaint run that reaches `PERSISTENCE_FAILED`: the provider's own
  result URL is memoized so a retry never re-fetches (and never re-bills)
  it; `persistenceAttempts` caps the provider-touching retry loop.
- An inpaint request whose provider job id arrives by webhook: the
  `providerJobId` match lets the delivery path find the row even if the
  URL path was tampered with.
- An inpaint run that edits a variant's staged result in place
  (`sourceSlot` 0 or 1): the selection is untouched; only the slot's
  after-image is overwritten.
- A `PERSISTENCE_FAILED` request whose retry budget is exhausted: the
  request stays failed and the room keeps its previous after-image.
- A vision label whose room was deleted: the label survives (it stands
  alone, with `roomId` only a denormalised filter) and simply stops
  appearing in that room.
- A room with no `User`-owned project: no write path reaches it
  ([BR-01](./business-rules/br-01-ownership-checked-writes.md)).
- A mask covering the whole image, an empty mask, or a mask that the
  provider rejects: the request ends in `ERROR`; the daily inpaint unit
  is refunded only when the `InpaintRequest` pre-write itself failed
  ([BR-12](./business-rules/br-12-inpaint-quota-after-call.md)).
- A room switched to and back in the studio: the persisted FineTune
  values are re-seeded into the controls.
- A listing-copy body that is whitespace-only: treated as "not set", so
  the legacy `recommendation` is used; a set body's whitespace is
  preserved verbatim.

## Lookbook & delivery

- An expired, forged or malformed preview token: the print surface denies
  with **404**, never 403, so the route never leaks a project's existence
  ([BR-06](./business-rules/br-06-preview-token-ttl.md),
  [BR-07](./business-rules/br-07-preview-token-scoping.md)).
- A preview token minted for project A used against project B's URL:
  denied ([BR-07](./business-rules/br-07-preview-token-scoping.md)).
- A session-bearing caller who presents a valid token but does not own
  the project: the ownership check still runs as defence-in-depth and
  answers 403/404
  ([BR-01](./business-rules/br-01-ownership-checked-writes.md)).
- A signature PNG above the ~1 MB base64 cap: rejected with
  `invalidSignature` (400).
- A Prisma failure while saving the signature: the route logs
  `sign_project_save_failed` and answers 500; the encrypted value is
  computed outside the retry loop so the stored ciphertext does not depend
  on which attempt won.
- A project whose `clientSignatureStatus` is `null` (never signed): the
  conditional update matches it explicitly, because a Prisma `not` filter
  compiles to SQL `<>` and never matches `NULL`
  ([BR-02](./business-rules/br-02-sign-off-immutable.md)).
- Export with `NEXT_PUBLIC_APP_URL` pointing at localhost: the cloud
  browser rejects the navigation with 403 — a deployment condition, not a
  product defect.
- Export while the Browserless API key is missing: the route answers 500
  with `missingConfig`.
- A quota claim that loses the atomic race: the caller receives 429 with
  the remaining count
  ([BR-04](./business-rules/br-04-daily-caps.md)).
- A provider failure on the copy surface: the claimed unit is refunded;
  the inpaint surface does not refund except on a pre-write failure
  ([BR-12](./business-rules/br-12-inpaint-quota-after-call.md)).
- A swatch that a room's finish points at, deleted: the room's reference
  is nulled and its directive text survives (`onDelete: SetNull`).
