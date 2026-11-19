---
actors: [user, client]
references:
  - kind: code
    role: implementation
    target: src/app/actions/project.ts
  - kind: code
    role: implementation
    target: src/app/api/export-pdf/route.ts
---

# Core journey

## Goal

A firm user takes a property from intake to a client-approved, printable Lookbook: they sign in, set up their firm once, intake a project, stage each room with AI, assemble the Lookbook and consultation report, and hand the client a link to review, approve and sign — ending with a PDF the firm downloads.

## Success criterion

A `SignOff` in state `Signed` for the project, and a PDF of the Lookbook exported.

## 1. The stager signs in

The journey begins with authentication. The firm user's session resolves to the
firm's `User` record; a user who has never set up the firm is routed to setup
instead. The actor here is [User](../entities/user.md).

→ [Sign in](../capabilities/sign-in/capability.md) (web surface)

## 2. The firm is set up (once)

The firm name and logo are captured, creating the `User` record that owns every
project. This happens once per firm. The firm also edits the Psychology page
and Sign-off page copy that appear in every Lookbook, at any later time.

→ [Firm setup](../capabilities/firm-setup/capability.md)

## 3. The firm intakes the project

The firm creates a `Project` from the intake form: property address, client
name, target buyer, staging aesthetic and staging package. The project is owned
by the firm user and its one `SignOff` is created at `Pending`.

→ [Project intake](../capabilities/project-intake/capability.md)

## 4. The rooms are bulk-created and photographed

The firm creates all rooms of the property in one pass (room types detected
from the photos if requested) and uploads the before-photos into each room's
two variant slots.

→ [Batch room upload](../capabilities/batch-room-upload/capability.md), [Before-photo upload](../capabilities/before-photo-upload/capability.md)

## 5. The firm stages each room

For each room, the firm paints masks or selects vision labels, runs inpaints in
variant slots, tunes the run and restores earlier versions when a take is
better, then writes the room's copy and listing snippet.

→ [Brush-mask inpaint](../capabilities/brush-mask-inpaint/capability.md), [Vision-label selection](../capabilities/select-vision-label/capability.md), [AI room copy](../capabilities/ai-room-copy/capability.md), [Listing copy](../capabilities/listing-copy/capability.md)

## 6. The Lookbook and report assemble

The firm reviews the Lookbook — room spreads with the selected variant pairs,
the swatch page, the procurement table, the ROI section and the room-by-room
consultation report — and prepares the client share.

→ [Lookbook assembly](../capabilities/lookbook-assembly/capability.md), [Consultation report](../capabilities/consultation-report/capability.md)

## 7. The client reviews and signs

The firm sends the client the preview link. The client opens it with no
session — a preview token scoped to this project alone — reads the plan,
checks off the options the firm already prepared, attests consent and signs.
The `SignOff` flips `Pending` → `Signed`.

→ [Client sign-off](../capabilities/client-sign-off/capability.md) (print surface)

## 8. The firm exports the PDF

With approval recorded, the firm exports the Lookbook as a PDF produced from
the same print surface the client saw.

→ [PDF export](../capabilities/pdf-export/capability.md)
