---
id: stagingstudio
summary: AI-assisted home-staging lookbook generator for Circle G Designs. Turns a property's "before" room photos into AI-staged "after" imagery plus persuasive copy and assembles them into a client-ready printable PDF Lookbook.
limitations:
  - The client who signs a Lookbook is reached only through a short-lived preview token; no identity is asserted between that signer and the client name recorded at intake.
---

# StagingStudio

StagingStudio is a single-tenant web app for one interior-design firm
(Circle G Designs). It exists to turn a "before" room photo into a
client-ready staging proposal — staged imagery plus persuasive copy — in
minutes.

## Intent

One core journey carries a staging job from property intake to a signed,
exported Hero Artifact (the Circle-G-branded PDF Lookbook).

## Product boundary

StagingStudio covers exactly one workflow: **property intake → staged rooms
→ assembled Lookbook → client sign-off → PDF export**. Everything outside
that path (settings/admin surfaces, evaluation tooling, operations) is
outside the modelled product and is listed in
[coverage.md](./coverage.md) under exclusions.

## Actors

| Actor | Description |
| --- | --- |
| Firm user | The Circle G Designs staff member who operates the app. Owns `User`, `Project`, `Room` records and performs every write. |
| The client (via preview token) | The homeowner who reviews the Lookbook on the cookie-less print surface and signs it. The client keeps no record in the product — the sign-off actor is "the client (via preview token)", modelled as an Entity that acts and keeps nothing. |
| Automated actors | The Browserless PDF renderer (cookie-less), and the wired inference providers (Alibaba DashScope by default, OpenAI GPT-Image via `INFERENCE_PROVIDER=openai`). |

## Domains

- [Intake](./domains/intake.md)
- [Staging workspace](./domains/staging-workspace.md)
- [Lookbook & delivery](./domains/lookbook-delivery.md)

## Core journey

[Core journey — sign-in to PDF export](./journeys/core-journey/journey.md)

## Supporting resources

- [Entities](./entities/) — the persisted things the product reasons about.
- [Interfaces](./interfaces/) — the surfaces a person or machine touches.
- [Capabilities](./capabilities/) — what the product can do, with scenarios.
- [Business rules](./business-rules/) — the grants and constraints that bind.
- [Edge cases](./edge-cases.md) — paths deliberately outside the modelled resources.
- [Coverage](./coverage.md) — scope, method, and what is unmapped.

## Model conventions

- **Lookbook is a projection of `Project`**, not an entity with its own
  lifecycle. Its "states" are the owning `Project`'s
  `clientSignatureStatus` / `clientSignatureTimestamp`.
- **Hero Artifact** is the Lookbook itself — the finished, Circle-G-branded
  PDF. The two terms name one resource; there is no distinct component
  (Alex's call, 2026-11-14, confirming the naming packet's N1 evidence).
- Every entity file names the persisted record and its code anchor.

## Staging aesthetic

The named design style of a project — e.g. "Vintage Modern". It headlines
the Lookbook cover and drives the AI's furniture and material choices.

- The curated set lives in `src/lib/staging-aesthetics.ts`; the project's
  choice is stored on `Project.stagingAesthetic`.
- A project-wide aesthetic is the default for its rooms; individual rooms
  can be re-assigned in the room matrix (bulk aesthetic assignment).

It is a value chosen once per project, with no lifecycle, no ownership
and no rules of its own beyond the choices it drives. It is not modelled
as an entity.

Effects in the model:

- Appears on the Lookbook cover ([lookbook assembly](./capabilities/lookbook-assembly/capability.md)).
- Feeds the staging directives in
  [brush-mask inpaint](./capabilities/brush-mask-inpaint/capability.md).

## Target buyer

The profile of homeowner the staged property is meant to attract — e.g.
"growing family". It drives copy tone and furniture choices.

- A free-text `targetBuyer` on the project (e.g. "young professional
  couple", "growing family").
- A structured `buyerDemographics` JSON profile —
  `{ buyerType, designPreferences[], budgetMin, budgetMax,
  mustHaveFeatures[], sellTimeline }` — used for AI copywriting and ROI
  metrics.

It is a chosen profile carried on the project; it has no identity beyond
its value and no lifecycle.

Effects in the model:

- Shapes the AI room copy
  ([AI room copy](./capabilities/ai-room-copy/capability.md)).
- Feeds the buyer-persona page of the Lookbook
  ([lookbook assembly](./capabilities/lookbook-assembly/capability.md)).
- Informs the ROI dashboard figures
  ([ROI dashboard](./capabilities/roi-dashboard/capability.md)).

## Staging package

The curated bundle the firm sells for this property. It is chosen on the
project intake form as one of three cards.

| Id | Name | Rooms | Price | Includes |
| --- | --- | --- | --- | --- |
| `essential` | Essential | 2 | $12,000 | Living, Dining |
| `premium` | Premium | 4 | $28,000 | Living, Dining, Master, Guest |
| `turnkey` | Turnkey | All | $45,000 | Full delivery, Pickup |

Source: `src/lib/staging-packages-schema.ts` (`STAGING_PACKAGES`);
`premium` is the recommended card.

It is a single choice from a closed set, stored on the project
(`Project.stagingPackage`). It is not a separately owned record with its
own lifecycle.

Effects in the model:

- Set at [project intake](./capabilities/project-intake/capability.md).
- Its scope (room count, included rooms) shapes the batch room upload
  ([batch room upload](./capabilities/batch-room-upload/capability.md))
  and the procurement table
  ([procurement table](./capabilities/procurement-table/capability.md)).

## Service contexts

The two service contexts Circle G Designs offers, as defined in
`CONTEXT.md`:

- **Vacant Staging** — staging an empty property with the firm's curated
  inventory; the room goes from bare walls to furnished.
- **Occupied Staging Consultation** — advising on furniture removal and
  adjustment in a homeowner-furnished room; in StagingStudio, the AI
  replaces visible existing furniture with recommended pieces.

> **No code represents either context today.** There is no field on
> `Project` or `Room`, no entity, and no branch in the product code that
> selects between them. The contexts exist in the firm's vocabulary
> (`CONTEXT.md`) and shape how the firm talks about its work.

Consequences for this model:

- **Per-capability applicability is unmodelled.** No capability declares
  which contexts it applies to, because there is nothing in the code to
  ground such a declaration.
- The distinction is *observable in the workspace* but not *implemented*:
  the occupied-consultation reading is served by the existing before/after
  inpainting path (the AI replaces visible existing furniture), while the
  vacant reading is served by the same path applied to bare rooms. The
  model therefore does not assert a capability split.
- The contexts are recorded here so that a future implementation has a
  place to hang context-sensitive behaviour — and so that no one mistakes
  the absence of a modelled split for an assertion that the two contexts
  are identical.

It is a mode of service, not a record: it has no identifier, no
ownership, no persistence, and no lifecycle.

Vocabulary hygiene:

- Use the exact terms from `CONTEXT.md`: **Vacant Staging** and
  **Occupied Staging Consultation**.
- Avoid the terms CONTEXT.md marks as wrong: "model home furnishing" (for
  Vacant Staging) and "Redecorating" (for Occupied Staging Consultation).

## Engagement tiers

The commercial tiers Circle G Designs offers, as rendered in the client
consultation report. Source: `src/lib/engagement-tiers.ts`
(`ENGAGEMENT_TIERS`).

| Id | Name | Tagline | Price | Recommended |
| --- | --- | --- | --- | --- |
| `essential-virtual` | Essential Virtual | Virtual Declutter + AI Staging | $299 | no |
| `full-immersive` | Full Immersive | Complete Staging Package | $1,199 | **yes** |
| `enterprise` | Enterprise / Portfolio | Multi-Property Portfolio | Custom Quote | no |

Each tier carries its own `includes` list and CTA:

- **Essential Virtual** — virtual declutter consultation, AI staging
  renders, 2 revision rounds, digital delivery within 5 days.
- **Full Immersive** — full home staging consultation, AI staging
  renders, unlimited revision rounds, priority turnaround (3 days),
  material swatch recommendations, furniture procurement guide.
- **Enterprise / Portfolio** — unlimited property portfolio, dedicated
  staging director, and the remaining commercial terms.

It is a fixed catalogue of choices presented to the client, defined as
data in one module. It has no per-project identity, no lifecycle and no
persisted record.

Effects in the model:

- Rendered in the client-facing consultation report
  ([consultation report](./capabilities/consultation-report/capability.md)).

## Not variations (deliberately)

- `INFERENCE_PROVIDER` — deployment configuration, not a product axis.
- PDF capture mode — a rendering detail of the print surface.
