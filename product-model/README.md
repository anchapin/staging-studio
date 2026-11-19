# StagingStudio — Product Model

This folder is the Product Model of StagingStudio: the git-tracked record of
what the product is and what it does today. It is written for people and
agents that need to know the product's meaning before touching code — the
person signing off on a change, the builder implementing one, and the checker
comparing the two.

## What lives here

- `product.md` — the product itself: what it is, why it exists, and the
  boundaries of its scope.
- `domains/`, `entities/`, `capabilities/`, `business-rules/`,
  `variations/`, `journeys/`, `interfaces/` — the modelled resources.
- `coverage.md` — which of the repository's code the model accounts for.
- `config.yaml` and `taxonomies.yaml` — the folder's format configuration.

## How to work with it

Implementation is the user's own workflow and stays that way. Only when the
user explicitly opts in does `pdd-verify` orchestrate implementation too; in
that case it owns the resolution of the findings the user chooses.

- **Checks** — send a check to `pdd-verify`. It compares the model with the
  implementation and routes what it finds.
- **Product changes** — send a change of product meaning to `pdd-ideate`.
  Approved meaning is written into this folder before the code changes.
- **Everything else** — the technical *how* of a change (specs, designs, task
  lists) belongs to the user's SDD tool of choice.

## Installing the tools

Install the pdd-kit skills and the `pdd-toolkit` CLI from the pdd-kit
distribution, then point them at this folder:

```
pdd-toolkit lint product-model/
```

`pdd-ideate` and `pdd-verify` are pdd-kit skills; install them for the agent
that will use them, the same way as any other skill of that distribution.

## What binds the code and what does not

- **Binds the code** — the modelled product meaning: capabilities and their
  observable behavior, business rules and their grants, the entities the
  product keeps, and the journeys that tie them together. A change to any of
  them is a change to the product, and needs approval before the code moves.
  Business rules carry `references` of `kind: code` naming the code that
  enforces them, so the binding is navigable.
- **Does not bind the code** — how the product looks and is built: layout,
  typography, colour, iconography, motion, component libraries, route shapes,
  API payload shapes and copy. Those live in the design system and in the
  code itself. `coverage.md` says which code areas the model accounts for;
  a change there is a change to the mapping, not to the product's meaning.

## One rule

The model holds current product meaning. It is not a place for deliberation
history, rejected alternatives or explanations of why an option was not
chosen: keep that in the conversation and record the approved result here.
