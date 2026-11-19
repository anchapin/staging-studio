---
kind: primary
routes:
  web: Web app
steps:
  - text: "The firm user paints a mask over the region to restage in the mask layer; the mask is client-side state until submitted"
    kind: actor
    actor: user
    entities: []
    contexts:
      web:
        place: web-app
  - text: "The firm user submits the run for the room's variant slot; the slot must be 0 or 1, and the provider is chosen by deployment configuration (INFERENCE_PROVIDER), not by a variation"
    kind: actor
    actor: user
    entities:
      - { entity: inpaint-request, effect: creates, to: In queue, facts: [Variant slot, Source slot] }
      - { entity: room, effect: reads, facts: [] }
    contexts:
      web:
        place: web-app
  - text: "The Product runs the provider call — Alibaba DashScope Qwen-Image by default, OpenAI GPT-Image when INFERENCE_PROVIDER=openai — and the request advances"
    kind: product
    actor: user
    entities:
      - { entity: inpaint-request, effect: changes, from: In queue, to: In progress, facts: [] }
    contexts:
      web:
        place: web-app
  - text: "The Product persists the provider's result: the request completes, the room's after-image for the slot is written, and a version snapshot is saved"
    kind: product
    actor: user
    entities:
      - { entity: inpaint-request, effect: changes, from: In progress, to: Completed, facts: [Result image] }
      - { entity: room, effect: changes, facts: [After images] }
      - { entity: inpaint-version, effect: creates, facts: [Variant slot, Result image, Thumbnail, Seed, Prompt directives] }
    contexts:
      web:
        place: web-app
---

# Painting a mask and running an inpaint

## Trigger

A room with a before-image in the target variant slot.

## Edge cases

- The provider succeeds but persisting the result fails → the request moves to Persistence failed with the provider's own result URL memoized, so a retry never re-fetches or re-bills it
- The daily inpaint unit is charged after the provider call, so in-flight runs can overshoot the daily cap

## Outcome

The room shows an AI-staged after-image for that slot.
