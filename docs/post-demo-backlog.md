# Post-Demo Backlog — Issue #204

> Tier 3 candidates. Do not build speculatively. Rank after observing Lauren's first solo sessions.

---

## 1. Variant History / Branching

### Current State

The system supports exactly **2 variant slots** per room (Variant A and Variant B). This is a fixed 2-slot model, not a general history/branching system.

**Data model** (`prisma/schema.prisma`):
- `Room.beforeImageUrl` / `Room.afterImageUrl` — Variant A
- `Room.beforeImageUrl2` / `Room.afterImageUrl2` — Variant B
- `Room.selectedVariantIndex` — which variant is used in the PDF (0 or 1)
- `InpaintRequest.variantSlot` — which slot (0 or 1) an inpaint run writes to
- `InpaintRequest.sourceSlot` — which slot the run edited *from* (null = original before photo, 0 = slot 0's staged result, 1 = slot 1's staged result — issue #170)

**Key files:**
- `src/lib/inpaint-source.ts` — `InpaintSource` type and `resolveInpaintSource()` / `applyInpaintResult()`; drives the "fresh run vs. edit-existing" branching logic
- `src/lib/staged-result.ts` — `resolveSelectionAfterDelete()` for post-delete selection logic
- `src/lib/variant-legibility.ts` — `resolveSelectionAfterDelete()` for selection landing after a slot is cleared
- `src/app/actions/room.ts` — `selectVariant()` (writes `selectedVariantIndex`), `clearVariantSlot()` (deletes staged result for a slot)
- `src/app/actions/room-photos.ts` — `getSignedUploadUrl()` / `confirmRoomPhotoUpload()` for uploading to slot 0 or slot 1
- `src/app/api/inpaint/route.ts` — accepts `variantSlot` and `sourceSlot` in the inpaint request body

**Limitations of the current 2-slot model:**
- No named versions or labels (e.g., "Kitchen — Option C" or "v3-final")
- No branching: submitting a new run from slot 1's result overwrites slot 1 in place; no "try a branch" workflow
- No version timeline: no way to see what slot 0 looked like at an earlier point
- No revert: clearing a slot is destructive; the staged result is gone

### What Would Need to Be Built

A proper variant history system would require:

1. **History table** — `RoomVariant` (or similar): `id`, `roomId`, `variantLabel` (optional user label), `beforeImageUrl`, `afterImageUrl`, `sourceVariantId` (for branching), `createdAt`. Each inpaint run produces a new row instead of writing to fixed slots. A `Room.selectedVariantId` FK replaces `selectedVariantIndex`.

2. **Schema changes** — Add `RoomVariant` model; add `selectedVariantId` FK to `Room`; deprecate `beforeImageUrl`/`afterImageUrl`/`beforeImageUrl2`/`afterImageUrl2`/`selectedVariantIndex` columns (keep during migration).

3. **Source tracking** — `InpaintRequest.sourceVariantId` replaces `sourceSlot`; `null` = original before photo.

4. **UI changes** — Editor timeline/version picker UI to browse and select from history; branching UI ("try another direction from v2"); version naming/labeling.

5. **PDF/lookbook changes** — `selectedVariantId` replaces `selectedVariantIndex` lookups throughout.

**Estimated complexity: High.** Requires schema migration, API changes across inpaint/submit/confirm flows, and a new UI component.

### Priority Recommendation

**Low for now.** The 2-slot model is sufficient for initial use. The real signal to watch: does Lauren ever want to compare more than 2 options per room, or ever want to "save" an exploratory result before overwriting? If she starts asking "can I keep both?" or "what if I try a third direction?", that signals the need. Hold until usage data confirms.

---

## 2. Real-Job Photo Intake Flow

### Current State

There is **no photo-intake flow** in the current system. The upload flow assumes the home stager (Lauren) is the one uploading photos directly into the editor.

**Current upload flow (`src/app/actions/room-photos.ts`):**
1. `getSignedUploadUrl(roomId, fileName, variantSlot)` — returns a Supabase Storage signed URL for direct browser → storage upload
2. Browser PUTs the file directly to the signed URL
3. `confirmRoomPhotoUpload(roomId, projectId, storagePath, variantSlot)` — called after upload completes; links the storage object into the `Room` row

**Limitation:** The upload URL is scoped to a specific `roomId`. There is no way to:
- Pre-register a batch of photos for a property before a room exists
- Associate listing-agent-submitted photos with a project before rooms are created
- Have a listing agent upload photos without needing access to the StagingStudio editor

### What Would Need to Be Built

A real-job intake flow would support a listing agent (or Lauren herself) submitting before-photos as a batch before or alongside room creation.

1. **Project-scoped intake bucket** — Supabase Storage bucket keyed to `projectId` (not `roomId`), with a structured upload manifest (CSV/JSON) listing `filename`, `roomName`, `slot` (0 or 1).

2. **Intake API** — `POST /api/intake` that accepts a batch of signed upload URLs for a project, and returns room stubs (or creates them lazily). Or: `POST /api/projects/[id]/rooms/intake` that accepts the upload manifest and creates room rows with `beforeImageUrl` populated.

3. **Room creation from intake** — Either pre-creates rooms with photos attached, or creates them lazily when a photo upload is confirmed and no room row exists for that `roomName`.

4. **Email/SMS invite link** — A shareable link (token-authenticated) for listing agents to upload photos to a specific project without a StagingStudio account.

5. **UI** — A minimal "drop photos here" intake page linked from the project, plus a project-level gallery before individual rooms are defined.

**Estimated complexity: Medium-High.** Storage reorganization, new API routes, auth scoping for unauthenticated intake, and a new UI surface.

### Priority Recommendation

**Medium-low for now.** The usage signal to watch: does Lauren ever mention having to chase listing agents for photos, or manually re-uploading photos she received via email/text? If intake friction becomes a regular complaint, it moves up. The spike worth doing early: a simple project-scoped upload page that creates room stubs — even before the invite link feature.

---

## 3. Multi-Tenant Hardening (Second Firm / Team Seats)

### Current State

The system is **strictly single-tenant today**. The data model encodes this:

**`User` model** (`prisma/schema.prisma`):
```
User: id, firmName, ownerName, logoUrl, email, psychologyPageContent, signoffContent
  └── projects → rooms → inpaintRequests
```

- One `User` = one firm (e.g., "Circle G Designs")
- One `Project` has exactly one `User` (via `userId` FK)
- No concept of team members, roles, or seats
- The `email` field on `User` is optional and not used for auth (auth is Supabase auth, which is also single-user per installation today)

**`src/lib/api-quota.ts`** explicitly notes this assumption: *"Single-instance deployments (single firm owner, low)"*

**No multi-tenant code paths exist today.** The entire codebase assumes `userId` on `Project` is a single human.

### What Would Need to Be Built

**A. Team seats (multiple users, one firm)**

1. **`Firm` model** — Split `User` into `Firm` (firm-level branding, subscription) and `TeamMember` (user account). `Firm` has `id`, `name`, `logoUrl`, `subscriptionTier`, etc. `TeamMember` has `id`, `firmId`, `email`, `role` (OWNER | EDITOR | VIEWER), `name`.

2. **Schema migration** — `Project.userId` → `Project.firmId`; `User` becomes `TeamMember`; `User.firmName` → `Firm.name` etc.

3. **Auth changes** — Supabase auth handles per-user accounts; add `firmId` claim to JWT or use a separate `firm_memberships` table joined via `getUser()` + DB lookup.

4. **API authorization** — Every API route and server action that currently checks `userId` must check `firmId` membership instead.

5. **Invite flow** — `POST /api/firm/invite` to email a colleague a join link with a role token.

6. **UI changes** — Team settings page; project list filtered by `firmId` (already works if all users share the same firmId); user avatar/name in nav.

**B. Second firm (true multi-tenant)**

1. **Row-level security (RLS)** on all Supabase tables scoped to `firmId`.

2. **Storage bucket per firm** — `project-assets-{firmId}` instead of a single bucket.

3. **API route isolation** — No shared mutable state across firms; all queries must include `firmId` filter.

4. **Onboarding API** — `POST /api/setup` already exists and creates a `User` row; extend or add `POST /api/firms` for self-serve firm creation.

**Estimated complexity: High.** Requires coordinated schema migration, auth refactor, RLS policy changes, storage reorganization, and UI for team management. Not a light lift.

### Priority Recommendation

**Low for now.** The signal: does Lauren ever mention needing to collaborate with an assistant or partner? Does she ask about accessing the system from a second location/device in a way that implies separate accounts? If she asks about a virtual assistant using the system, or mentions growing her business, that signals the need. Until then, the single-firm model is fine for a single-user SaaS product.

---

## 4. Per-Room Aesthetic Overrides — Issue #1214

> **Status: Deferred until after the Lauren demo by decision.** Tracked here so it is not lost. Revisit after the demo period when Lauren has had a chance to express the per-room aesthetic-mixing need in real client work.

### Current State

Rooms have **no aesthetic of their own today**. Every generation path reads `Project.stagingAesthetic` directly.

**Data model** (`prisma/schema.prisma`):
- `Project.stagingAesthetic` (String?) — the single source of truth for project-wide aesthetic.
- `Room.stagingAesthetic` does **not** exist.
- Every consumer (`holistic-prompt.ts`, `holistic-preset.ts`, the editor's `aesthetic` prop, `generate-copy`) reads from `Project.stagingAesthetic`.

**Resolution seam to extend:** `resolveRoomAesthetic` in `src/lib/project-aesthetic.ts` is the central helper. Today it returns the project's aesthetic unconditionally; the override would live behind the same function so every consumer picks it up automatically.

**Reference trace:** [#1189 (comment 5965187096)](https://github.com/anchapin/staging-studio/issues/1189#issuecomment-5965187096) for the original "all rooms inherit project" assumption.

### Scope (when implementation begins)

1. **Schema change** — Add nullable `Room.stagingAesthetic` (String?). Cascade-free. `db push` workflow (no migration history to maintain, per AGENTS.md).
2. **Prompt builder updates** — `holistic-prompt.ts`, `holistic-preset.ts`, the editor `aesthetic` prop, and `generate-copy` resolve `room.stagingAesthetic ?? project.stagingAesthetic` via `resolveRoomAesthetic`.
3. **Room card UI** — Show "Inherits project" (muted) when `room.stagingAesthetic` is null; otherwise show "Override: <name>" badge with a "Reset to project" action.
4. **Bulk toolbar** — "Apply aesthetic to selected rooms" action that writes the room column, with a confirmation step showing the room count before applying.
5. **Helper line** — Render a short "Room override > Project aesthetic" hint in the relevant editor surfaces.

### Acceptance Criteria

- [ ] Changing the project aesthetic updates **inheriting** rooms (no override) and leaves rooms with an explicit override **untouched**.
- [ ] Reset returns a room to the project aesthetic (clears the override).
- [ ] Tests cover all three paths: **inherit**, **override**, **reset**.
- [ ] Rooms with no override render **exactly as before** — no badge, no helper line, no behavioral drift for the 99% case that does not use overrides.

### Estimated Complexity

**Medium.** Requires a schema push, prompt-builder changes in 3-4 files, a focused UI addition, bulk-action surface, and tests. The trickiest part is making "rooms with no override render exactly as before" a hard contract — easy to break by accidentally rendering the badge when `null`.

### Files Reserved for Implementation

When this issue exits deferral, edits are expected in:
- `prisma/schema.prisma` — add `Room.stagingAesthetic String?`.
- `src/lib/project-aesthetic.ts` — extend `resolveRoomAesthetic` to honor `room ?? project`.
- `src/lib/holistic-prompt.ts` — read through `resolveRoomAesthetic`.
- `src/lib/holistic-preset.ts` — read through `resolveRoomAesthetic`.
- Room card components under `src/components/` — badge + reset affordance.
- Bulk toolbar surfaces — selected-rooms writer.
- Tests under `tests/` — inherit/override/reset coverage.

### Trigger to Revisit

The signal to unblock this: after the Lauren demo period, **does Lauren (or any prospect) ask to stage different rooms in different aesthetics within a single project?** Examples that would signal yes:
- "Can the great room be coastal and the primary bedroom be modern organic?"
- "I want to show the same house two ways — one warm traditional, one cool contemporary."
- Any conversation about *per-room* mood/tone flexibility.

Until that signal appears, the single-project-aesthetic model is the simpler default and the override surface is speculative.

---

## 5. `buildBatchPlan` Lift-vs-Defer Decision — Issue #1367 (closed 2026-10-17)

Closed as **deferred** (not wontfix) after the 2026-10-17 session-review re-verified that `buildBatchPlan` is a pure plan-shape transform: no I/O, no held state, only consumes and derives from its inputs. The unit pin (`tests/multi-select-batch.test.ts`, 11 cases) already covers the realistic per-room directive mixes; the sole production caller is `use-inpaint-runs.ts`'s batch runner (sequential, no fan-out). Lifting it without a measured reason would be speculative micro-optimization of a function that's already O(items × directives) over the small set of items the runner submits per batch.

### Current State

`src/lib/multi-select-batch.ts` exports `buildBatchPlan(input)`. It returns `{ plan, submissionOrder, summary }` describing which room/variant inpaint submits fire in what sequence. Today each room's directives are independently grouped into concepts, so a 5-room batch where every room asked for "swap the sofa" + "warm the lighting" submits ten near-identical requests serially. That is correct — but it is also the only thing that gets expensive at scale.

The function is already cheap. The deferral is not about today's pain; it is about preserving a *clear* revisit signal so we do not quietly entrench a slower path when the lift becomes worth doing.

### What Would Need to Be Built

1. A **microbenchmark** (`tests/multi-select-batch.bench.ts`) covering the realistic room-count range (1, 3, 5, 10, 25 rooms × the per-room directive sizes the unit pin already covers). The benchmark alone is not enough — see "Trigger to Revisit."
2. A **grouping algorithm**: cluster rooms by shared directive prefix, then issue one inpaint submit per cluster instead of one per room. Sequential runner, no fan-out — that ceiling is deliberate (see #1214's parallelization discussion for the rationale).
3. A **behavioral-regression test** pinned alongside the implementation, asserting the current return shape (order, `submissionOrder`, per-item `planId`) so the cluster-merge cannot silently change what `use-inpaint-runs` receives.
4. The lift is benchmark-driven only: implement iff the bench places `buildBatchPlan` in the top-3 hot spots of a representative batch run. Otherwise the issue stays closed.

### Files Reserved

- `src/lib/multi-select-batch.ts` — `buildBatchPlan`; JSDoc notes its purity contract, which the new code must continue to satisfy.
- `src/components/canvas/use-inpaint-runs.ts` — sole production caller; the new return shape must be additive, not breaking.
- `tests/multi-select-batch.test.ts` — existing 11-case pin.
- `tests/multi-select-batch.bench.ts` — new; gated by vitest's `--bench` flag, not part of `npm test`.
- `tests/multi-select-batch.behavioral-regression.test.ts` — new; pins the merged return shape so a future change cannot silently drop `planId` / reorder `submissionOrder`.

### Trigger to Revisit

Any **one** of the following:

- A Next.js dev-mode profile or production flame graph of a real 5+ room batch shows `buildBatchPlan` in the top 3 by self-time.
- A user-perceived latency report — not a one-off slow image upload, but a repeatable "editor hangs during batch planning" complaint from a demo or UAT session.
- A microbenchmark in the new bench file that exceeds the threshold we set when we land the bench. (Threshold itself to be defined at that time — the bench file ships with no pass/fail gate, just measurements.)

If none of these land within a quarter of meaningful staging-studio usage, the issue stays closed and this entry can be removed from the backlog entirely — its reason for existing was to keep the lift visible, not to keep it pending forever.

---

## Summary: Priority After First Solo Sessions

| Feature | Current State | Usage Signal to Watch | Recommended Priority |
|---|---|---|---|
| **Variant History** | 2 fixed slots, no branching | Does Lauren want to keep more than 2 options or "save" an exploratory result? | Low (hold until observed) |
| **Photo Intake** | Manual upload per room via editor | Does Lauren chase listing agents for photos or re-upload photos from email/text? | Medium-Low |
| **Multi-Tenant / Team Seats** | Single-firm, single-user | Does Lauren mention an assistant, partner, or growing her team? | Low (hold until observed) |
| **Per-Room Aesthetic Overrides (#1214)** | All rooms inherit project aesthetic | Does Lauren ask to mix aesthetics per room within a single project? | Low — deferred until after Lauren demo by decision |
| **`buildBatchPlan` directive-prefix clustering (#1367)** | Each room's directives independently grouped into inpaint submits | Does a 5+ room batch show `buildBatchPlan` in the top-3 hot spots of a real profile, or does batch planning become a user-perceived latency complaint? | Low — closed 2026-10-17 as deferred; revisit iff bench-driven or latency-driven |

**Tier 3 rule applies:** none of these should be built speculatively. Ship v1, observe Lauren's first solo sessions, then re-rank based on actual friction points.

---

*Last updated: post-demo research, issue #204; added #1214 (per-room aesthetic overrides) entry on its explicit deferral; added #1367 (`buildBatchPlan` lift-vs-defer) entry on its explicit deferral (closed 2026-10-17).*
