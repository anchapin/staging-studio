---
scope: The StagingStudio web application — the one core journey from sign-in through staged rooms and Lookbook assembly to client sign-off and PDF export (staging-studio issue #1542, Phase 1).
method: Static inspection of the repository (README.md, CONTEXT.md, prisma/schema.prisma and the code paths the model's resources cite as references), authored against the approved model delta of 2026-11-13; code was not executed. Scenario coverage is deliberately capped at three per capability; further paths are recorded as edge-case bullets outside the modelled resources.
covered:
  - description: Server actions implementing the core journey's writes — projects, rooms, photos, variants, copy, finishes, inpaint versions, swatches and procurement.
    paths: [src/app/actions/]
  - description: API routes for setup, sign-off, inpainting, segmentation, labelling and PDF export.
    paths: [src/app/api/]
  - description: Shared libraries for quota accounting, preview tokens and preview access, signature encryption, sign-off validation, setup rate limiting, the virtually-staged disclosure label, listing copy, staging packages and aesthetics, and engagement tiers.
    paths: [src/lib/]
  - description: Lookbook, room-editor and staging-package components.
    paths: [src/components/]
  - description: The persisted data model the model's entities are grounded in.
    paths: [prisma/schema.prisma]
  - description: Route protection for the authenticated surfaces.
    paths: [middleware.ts]
  - description: The firm's vocabulary of record, including the service contexts.
    paths: [CONTEXT.md]
exclusions:
  - description: SelectionLog and its find-and-replace training-corpus tooling — telemetry, deliberately not modelled.
    paths: [src/app/actions/selection-log.ts]
  - description: Settings and admin surfaces.
    paths: [src/app/actions/settings.ts, src/lib/settings-schema.ts]
  - description: Bake-off and evaluation tooling.
    paths: [bake-off/]
  - description: Documentation and evaluation artefacts.
    paths: [docs/]
  - description: Sentry and error-tracking operations code.
    paths: [sentry.client.config.ts, sentry.server.config.ts, src/lib/error-tracking.ts]
  - description: End-to-end test harness — test infrastructure, not a product surface.
    paths: [tests/e2e/]
  - description: The environment-variable inventory — configuration, not product surface.
    paths: [.env.example]
unmapped:
  - description: The versioned API surface and its deprecation handling — the model's interfaces describe the surfaces, not their URL versioning.
    paths: [src/app/api/v1/, src/lib/api-v1/]
limitations:
  - description: "Service contexts: no code represents either context today — Vacant Staging and Occupied Staging Consultation exist only as the firm's vocabulary in CONTEXT.md; there is no field, entity or branch selecting between them, and per-capability applicability is unmodelled (not invented)."
    paths: [CONTEXT.md]
  - description: Segmentation behaviour could not be established from a running provider — no wired provider implements SAM 3.1, so the segment route fails fast with a classified 501 before claiming quota and the segment daily cap is stated but inert.
    paths: [src/app/api/segment/]
  - description: The intake client name and the sign-off attestation are joined by no identity in the code; the model asserts no link between the person named at intake and the client who signs.
    paths: [src/app/api/sign-project/]
---

# Coverage
