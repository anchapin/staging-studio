---
relations:
  - entity: room
    verb: contains
    cardinality: one-to-many
  - entity: material-swatch
    verb: contains
    cardinality: one-to-many
  - entity: procurement-item
    verb: contains
    cardinality: one-to-many
  - entity: sign-off
    verb: owns
    cardinality: one-to-one
references:
  - kind: code
    role: implementation
    target: prisma/schema.prisma
---

# Project

One staging job for one property. It is the aggregate root of the core
journey: it owns the rooms, the firm branding context, the ROI figures, the
variation choices, and the sign-off. Persisted as the Prisma model
`Project` (`prisma/schema.prisma`).

## Information kept

- **Property address** — `propertyAddress`: the listing address, printed on the Lookbook cover
- **Client name** — `clientName`: the client's name as typed at intake; a free string, not linked to the sign-off attestation (see [SignOff](./sign-off.md))
- **Target buyer** — `targetBuyer`: the Target Buyer profile; drives copy tone and furniture choices
- **Buyer demographics** — `buyerDemographics`: JSON buyer profile for copy generation and ROI metrics
- **Staging aesthetic** — `stagingAesthetic`: the Staging Aesthetic; headlines the Lookbook cover
- **Staging package** — `stagingPackage`: the chosen staging package (`essential` / `premium` / `turnkey`)
- **Staging directives** — `stagingDirectives`: global project-wide AI staging directives
- **ROI sales price premium** — `roiSalesPricePremium`: one of the three ROI figures the ROI dashboard renders
- **ROI transaction velocity** — `roiTransactionVelocity`: one of the three ROI figures the ROI dashboard renders
- **ROI investment tier** — `roiInvestmentTier`: one of the three ROI figures the ROI dashboard renders
- **Virtually staged disclosure** — `virtuallyStagedLabelEnabled`: whether the "Virtually staged" disclosure mark renders; defaults ON, and a project created before the field existed reads as enabled
- **Cover photo** — `projectCoverImageUrl`: the property photo uploaded for the Lookbook hero and the OG/social-share card
- **Headline** — `ogHeadline`: the headline used for the OG/social-share card title
- **Share caption** — `ogCaption`: the stored social-share caption, shown truncated at 80 characters in the admin list
- **Project title** — `projectTitle`: the in-app title shown on the first workspace step and the report's summary header

## Why it exists

- Project intake creates it via the ownership-checked server action
  (`src/app/actions/project.ts`).
- The **Lookbook is a projection of this record** — the Lookbook has no
  lifecycle of its own; its sign-off state is the SignOff's state, carried
  on this record today.

## Notes

- Lookbook states are `Project` states. Do not model a separate Lookbook
  lifecycle.
- `Project` is the target of every ownership check
  ([BR-01](../business-rules/br-01-ownership-checked-writes.md)) and the
  scope of every preview token
  ([BR-07](../business-rules/br-07-preview-token-scoping.md)).
- The fields of the [SignOff](./sign-off.md) — signature, signature
  status, signature timestamp, consent attestation — are carried on this
  record today (`clientSignature`, `clientSignatureStatus`,
  `clientSignatureTimestamp`, `clientConsentAttested`,
  `clientConsentAttestedAt`); they are modelled as the SignOff's facts,
  not this record's.
