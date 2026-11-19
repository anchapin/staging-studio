---
references:
  - kind: code
    role: implementation
    target: src/app/actions/project.ts
  - kind: code
    role: implementation
    target: src/app/actions/room-batch.ts
---

# Intake

Getting a signed-in firm user from an empty account to a Project with
rooms, before any imagery is staged.

## Boundary

Intake starts at sign-in and ends when a `Project` exists and the project
has rooms. It covers the first-run firm setup, the project intake form, the
batch room upload that creates a property's rooms in one pass, and the
before-photo upload that fills a room's variant slots. It does not own the
staging of rooms once their before-photos exist (Staging workspace), the
assembly or delivery of the Lookbook, the client's sign-off, or the PDF
export (Lookbook & delivery).

## What it contains

| Capability | Where |
| --- | --- |
| [Sign-in](../capabilities/sign-in/capability.md) | `/login`, `/auth/callback`, `middleware.ts` |
| [Firm setup](../capabilities/firm-setup/capability.md) | `/setup`, `src/app/api/setup/` |
| [Project intake](../capabilities/project-intake/capability.md) | `/projects/new`, `src/app/actions/project.ts` |
| [Batch room upload and room-type detection](../capabilities/batch-room-upload/capability.md) | `src/app/actions/room-batch.ts` |
| [Before-photo upload](../capabilities/before-photo-upload/capability.md) | `src/app/actions/room-photos.ts` |

## Entities touched

- [User](../entities/user.md) — created by first-run firm setup.
- [Project](../entities/project.md) — created by project intake.
- [Room](../entities/room.md) — created by batch room upload.

## Governing rules

- [BR-01 Ownership-checked writes](../business-rules/br-01-ownership-checked-writes.md)
- [BR-05 Setup flow IP rate limit](../business-rules/br-05-setup-rate-limit.md)
- [BR-07 Preview token scoping (project identity anchors here too)](../business-rules/br-07-preview-token-scoping.md)
- [BR-09 Signature encryption at rest](../business-rules/br-09-signature-encrypted-at-rest.md)
- [BR-14 "Virtually staged" disclosure default](../business-rules/br-14-virtually-staged-disclosure.md)

## Boundary notes

- The `clientName` typed at intake is a free string on `Project`. It is
  **not** linked to the SignOff actor — see the open note in
  [coverage.md](../coverage.md).
- Staging package selection at intake is a *variation*
  ([Staging package](../product.md#staging-package)), not a separate entity.
