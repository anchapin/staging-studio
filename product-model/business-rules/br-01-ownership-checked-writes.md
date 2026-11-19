---
appliesTo:
  - type: entity
    id: project
    effect: creates
    contexts:
      - place: web-app
  - type: entity
    id: project
    effect: changes
    contexts:
      - place: web-app
  - type: entity
    id: project
    effect: removes
    contexts:
      - place: web-app
  - type: entity
    id: room
    effect: creates
    contexts:
      - place: web-app
  - type: entity
    id: room
    effect: changes
    contexts:
      - place: web-app
  - type: entity
    id: room
    effect: removes
    contexts:
      - place: web-app
permits:
  - actors: [user]
references:
  - kind: code
    role: implementation
    target: src/app/actions/project.ts
  - kind: code
    role: implementation
    target: src/app/actions/room-variants.ts
  - kind: code
    role: implementation
    target: src/app/actions/room-batch.ts
  - kind: code
    role: implementation
    target: src/lib/api-auth.ts
---

# Every write to a Project or Room is ownership-checked against the owning User

Every write to a Project or Room must be gated on an authenticated
session whose User owns the target record; a write that does not resolve
an owning User must not perform the mutation.

**Grant.** A firm user may mutate a `Project` or `Room` only when the
session resolves to the `User` that owns it.

**Enforcing code.**

- `src/lib/api-auth.ts` — `getAuthedPrismaUser()` is the shared session
  gate: it validates the real JWT via `supabase.auth.getUser()` (fails
  closed), looks the user up by session email, and rejects sessions whose
  `email_confirmed_at` is null. `requireProjectOwnershipOrThrow` and
  `requireProjectOwnershipSafe` build the ownership filter from the
  returned `user.id`.
- `src/app/actions/project.ts` — `saveProjectMetadata`,
  `saveProjectSignature` and `saveVirtuallyStagedLabelEnabled` resolve the
  session user and scope their writes to the owned project — for example
  `saveProjectMetadata` writes with the where clause
  `{ id: projectId, userId: user.id }`, so a write to another user's
  project matches no row.
- `src/app/actions/room-variants.ts` — `saveVariantSelection`,
  `getVariantTouchUpCounts` and `deleteVariantAfterImage` resolve the
  session user before touching a variant slot.
- `src/app/actions/room-batch.ts` — `createRoomsBatch`,
  `getBatchRoomUploadUrls` and `detectBatchRoomTypes` resolve the session
  user and check project ownership before creating or reading rooms.

**Scope note.** Server actions and API route handlers are **not** covered
by the root `middleware.ts`; the ownership check in the action/route layer
is the gate. The cookie-less preview-token path is the one deliberate
exception to session-based writes, and it is bounded by
[BR-06](br-06-preview-token-ttl.md), [BR-07](br-07-preview-token-scoping.md)
and [BR-02](br-02-sign-off-immutable.md) — which is why this Rule's targets
are scoped to the web app, where session writes happen.
