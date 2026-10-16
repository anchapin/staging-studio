# Handoff — Directions rehydration mini-slice (#1359), session of 2026-10-16

**From:** opencode session that picked up the priority-2/3 follow-up "Persistence
+ rehydration" mini-slice (triggered by `.handoffs/2026-10-16-rehearsal-selector-retarget.md`).
**To:** next session (priority 2: open the PR and ship #1359; priority 3:
FineTune persistence scope; priority 4: fix the autosave race uncovered this
session — see §3.4 below; priority 5: mask-paint toast timing).
**Repo:** `anchapin/staging-studio`
**Branch:** `develop`, now 4 commits ahead of `origin/develop`
(local commits `c9d51b5`, `95171e8`, `e9418ed`, `5c9e297` are all unpushed —
the 3 prior ones are merged PRs from this slice chain that never made it
back to `origin/develop`; `5c9e297` is this session's commit).

---

## 1. What this session delivered

The "directions rehydration gap" half of the persistence +
rehydration mini-slice — issue **#1359**. The Directions textarea on
the redesigned `<EditRoomStudio>` now restores the autosaved
`Room.rawDirectives` value on mount instead of presenting an empty
form.

The complementary "FineTune persistence" half is deliberately out
of scope (see §3.1 below). The original handoff's suggestion to
"take both together" turned out to be a scope-creep risk: FineTune
persistence needs a Prisma migration for 5 new columns, a
debate-with-product over which controls to persist, and reducer
migration work. This session shipped the higher-impact additive
fix and parked FineTune.

### Why this half was priority-A

The bug had a real, demonstrable, end-user-visible failure mode:

1. User types into Directions.
2. Autosave commits to `Room.rawDirectives`. ✓
3. User refreshes the page.
4. Directions textarea is empty. ✗
5. User opens the Listing copy tab → "Rewrite from directions" is
   disabled even though the directives are saved in the DB and the
   API route reads them; only the Studio's CTA gate is broken.

The mismatch (persisted → unread on remount) made user work vanish
from view, and dead-ended the second most-important tab in the
studio. This half of the mini-slice closes it with no schema
change.

### Test status

- **86/86 e2e tests pass** (full hermetic harness, production
  build, real handlers except where explicitly mocked). The
  previous handoff reported this number; this slice holds it. The
  rehearsal spec's main drill + both failure drills all green
  locally with my changes.
- **All 124 edit-room vitest tests pass** (5 new tests in this
  slice).
- **oxlint: no new findings.**
- **`tsc --noEmit`: clean.**
- **`npm run build`: ✓ Compiled successfully in 5.7s.**

## 2. What changed (and why)

**7 files, +207 / −7.**

| File | Lines | Why |
|---|---|---|
| `src/components/edit-room/types.ts` | +28 | New `initialDirections?: string` prop on `EditRoomStudioProps`, mirroring the `initialCopyHeadline` / `initialCopyBody` pattern |
| `src/components/edit-room/edit-room-reducer.ts` | +20 | New `createInitialEditRoomState(overrides?)` factory; `initialEditRoomState` stays as the canonical frozen default (the reducer test pins it) |
| `src/components/edit-room/EditRoomStudio.tsx` | +47 / −1 | Lazy reducer initializer that seeds `state.directions` from the prop; room-switch reset `useEffect` (mirrors `initialLookbookSlot`); `lastCommittedValue.current` initialised to the seeded value so the 900ms debounce doesn't fire on mount |
| `src/lib/edit-room-studio-props.ts` | +13 | `FocusedRoomLike.rawDirectives` opt; `initialDirections: focusedRoom.rawDirectives ?? ""` in the resolver |
| `tests/edit-room-studio-props.test.ts` | +62 | 3 new pins: verbatim, null → `""`, missing-field → `""` (legacy room rows) |
| `tests/edit-room-reducer.test.ts` | +31 | 2 new pins for `createInitialEditRoomState`: no-override equals default, override doesn't disturb unrelated slots |
| `tests/e2e/specs/rehearsal.spec.ts` | +9 / −3 | Updated the workaround comment to record why the spec still uses the explicit Directions re-fill (autosave race, see §3.4) |

### Architecture notes

- **Lazy reducer initializer:** `useReducer(reducer, null, () => createInitialEditRoomState({ directions: seededDirections }))`. React's canonical pattern for deriving initial state from a prop — the initializer runs once per mount, even under strict-mode double-render, with no effect race.
- **`seededDirections = initialDirections ?? ""`:** the prop is optional so existing test fixtures (pre-#1359 mounts) keep working. The shell coerces absent → `""` to match the canonical reducer default.
- **Room-switch reset:** `useEffect` on `seededDirections` change dispatches `SET_DIRECTIONS` + updates `lastCommittedValue.current`. Same pattern as the `initialLookbookSlot` reset at `EditRoomStudio.tsx:174-183` pre-this-slice. Trade-off: in-flight typed values on the prior room are silently overwritten by the new room's saved value (the autosave fires on blur/navigate, so the prior room's value lands in the DB anyway).
- **`lastCommittedValue.current = seededDirections`** on first render: prevents the mount-with-persisted-data case from firing a redundant 900ms debounce → autosave round trip. Without this fix, every page reload would round-trip the same value through `Room.rawDirectives` for 900ms + 600ms = 1.5s of pure debounce churn.

## 3. Open follow-ups

### 3.1 Bug B — FineTune persistence (Issue open question from prior handoff #3)

`EditRoomStudio.tsx:188-192` still declares the 5 FineTune values
(`strength`, `adherence`, `expand`, `shadows`, `seed`) as local
`useState` with hardcoded defaults. They autosave nowhere, restore
nowhere — same shape as the directions gap, but bigger.

**Decisions still needed before a fix can land:**

1. **Storage shape:** 5 nullable columns on `Room`? Or one JSON
   column? Or localStorage? Project uses per-row columns for
   similar fields elsewhere (`lookbookHeadline`, `lookbookBody`,
   `rawDirectives`), so the convention is per-column, not JSON.
2. **Which controls are user-meaningful to persist?** All five?
   Only the three "scalars"? Only the ones that materially change
   output across reloads? `#1341`'s design has the seed field as
   "Random" by default — persisting an empty seed probably isn't
   meaningful.
3. **Reducer state vs local useState:** the directions fix landed
   by promoting `directions` to a reducer slot; FineTune would
   follow the same pattern (`SET_STRENGTH`/`SET_ADHERENCE`/...).
   Cleaner than 5 useState hooks; lets a future persistence
   controller serialize one update.

The open scope question is what should persist at the product
level — answer that first, then re-shape the FineTune state the
same way. **Per the user's choice on this slice, this is its own
PR, not bundled with #1359.**

### 3.2 Carry-overs from prior handoff

From the prior handoff §6, still OPEN:

- **(4) mask-paint toast timing** — priority 5. Small interactive
  polish bug.
- **(5) rehearsal "Staged result" heading** — RESOLVED by #1358.
- **(3) FineTune persistence scope** — see §3.1 above.

### 3.3 Newly uncovered — autosave race unmasked by this session

**This is the most important follow-up.** This session ran the
full e2e suite locally (the prior session's "86/86 green" claim
wasn't verified by re-run before this slice shipped). When I
removed the workaround in `rehearsal.spec.ts` thinking my fix
subsumed it, the test failed — and the diagnostic trace revealed a
**pre-existing autosave race** that masked the bug:

**Symptom:** the rehearsal main drill times out at the
"Rewrite from directions" button (disabled because textarea is
empty after page reload).

**Root cause:** `project-detail-view.tsx:603` configures the
directives autosave controller with **`idleMs: 2000`** (2-second
idle). The test types DIRECTIVES, paints for ~1s, calls
`waitForDirectivesSaved` which waits up to 6s for "Saved" pill to
appear — but **`waitForDirectivesSaved` matches the default-idle
"Saved" text**, not the actual `"saved"` autosave state (TopBar's
`SAVE_LABEL` collapses `idle | dirty | saved` all to `"Saved"`,
so the helper returns immediately on the very first render before
the autosave timer fires). The test then clicks Run ~150ms in,
the inpaint mock returns in ~10ms, the first-pass wait is ~5s.
**The 2s autosave timer competes with `page.reload()` at line 129**
— sometimes fires before the reload (DB has the value), sometimes
doesn't (DB still empty). The prior session's run was a race win.

**Why this matters for shipping #1359:**

- The prior fix (#1358) deliberately kept the workaround
  (`fill(DIRECTIVES)` after reload) because the underlying autosave
  race was known. The workaround made the test deterministic.
- This session's production fix makes production rehydration work.
  The workaround can be removed in production usage patterns — but
  the e2e test continues to need the explicit refill **because the
  test's autosave race is unchanged.**
- I left the workaround in place in `tests/e2e/specs/rehearsal.spec.ts`
  and updated the comment to point at #1359 + the autosave race
  explanation. The test is green.

**Recommended fix (priority 4):** Fix `waitForDirectivesSaved` to
actually wait for the autosave controller's `"saved"` state rather
than the cosmetic "Saved" text. Concrete options:

- **(a)** Change `TopBar`'s `SAVE_LABEL` to show `"Saving"` for the
  dirty state (visual fidelity for users) AND change
  `waitForDirectivesSaved` to wait for a status transition past
  `"saving"`. Visual + test improvement, single PR.
- **(b)** Reduce `idleMs` from 2000 to 600 (matches the issue's
  copy-autosave spec) so the race becomes deterministic for
  fast-loading users + tests, with a one-line change in
  `project-detail-view.tsx:603`. Side-effect: faster saves for
  users (good). Confirm with product that 600ms is acceptable —
  the staging-directives haven't been measured for save frequency.
- **(c)** Have the Run button call `getDirectiveController().flush()`
  before submitting inpaint, so the autosave completes before the
  Run click. Requires threading `flush` through the studio's
  controlled runtime — same shape as the `onMaskChange` plumbing.
  Most surgical; only affects the test + user-experience of "click
  Run without losing your typed directives".

Option (c) is the most defensible — it makes the actual user flow
(directives → Run) race-free, which is what matters. The test
patch can be a 2-line helper.

### 3.4 Lower-priority

- **(5) mask-paint toast timing** — carry-over from the signoff
  handoff.

## 4. Ship checklist (for next session)

**To ship this PR (#1359):**

1. **Re-check tsconfig.json** before committing any follow-up. The
   Next 16 build/dev flips `jsx: "preserve"` → `"react-jsx"`
   unconditionally; the committed shape is `preserve`. Run
   `git diff tsconfig.json` after any `npm run build` / `npm run dev`
   and `git checkout HEAD -- tsconfig.json` if dirty.
2. **Push and PR.** Local `develop` is 4 commits ahead of
   `origin/develop`:
   - `c9d51b5`, `95171e8`, `e9418ed` (3 merged-PR-equivalent commits
     never pushed back)
   - `5c9e297` (this session)
   
   The cleanest ship shape:
   - Create a feature branch from this session's commit:
     `git checkout -b mp-redesign/issue-1359-directions-rehydrate 5c9e297`
   - Push: `git push -u origin mp-redesign/issue-1359-directions-rehydrate`
   - Open a `develop` ← feature PR via `gh pr create --base develop --head mp-redesign/issue-1359-directions-rehydrate --title "[AI-assisted] feat(#1359): rehydrate <EditRoomStudio> Directions from Room.rawDirectives" --body "Closes #1359. Restores Room.rawDirectives on <EditRoomStudio> mount via lazy reducer initializer + new initialDirections prop. Schema unchanged. 4 production files + 2 unit tests + 1 e2e spec (comment update only). 86/86 e2e suite green."`
   - Once merged, back-merge develop into develop's prior 3 commits.
     The `release-guard` CI job will catch any leak on the next
     `develop`→`main` release PR, but pushing directly without
     that back-merge is what created the stale-state problem in
     the first place (per the prior handoff's §1 warning).
3. **CI passes:** `Lint · Typecheck · Unit tests` should be green
   (locally confirmed). The `e2e` job runs on `push` to `develop`
   only — when the feature branch is pushed (not merged), e2e
   doesn't fire. Smoke-run locally if you want a pre-merge green
   light:
   ```bash
   PATH="$PWD/node_modules/.bin:$PATH" \
     DATABASE_URL="postgresql://e2e:e2e@127.0.0.1:39921/staging_studio_e2e" \
     npm run e2e
   ```
   Local hermetic harness took ~5 minutes for the full 86-spec run
   on this session's hardware.

## 5. Post-merge CI status (read this before debugging the red)

PR #1359 was merged via squash. The post-merge CI run on
`origin/develop` (run ID `38947706629`) reached the e2e job and
failed quickly. **The failure is a pre-existing CI infrastructure
bug** unrelated to this slice — the same `DATABASE_URL is unset`
error has fired on every develop-branch push since at least
2026-10-15 (verified against runs `38811410054`, `38836005074`,
`38838652155`, `38845853194` — all conclude `failure` with the
identical error).

**Root cause:** the e2e job in `.github/workflows/ci.yml` has no
job-level `env:` block, so `process.env.DATABASE_URL` is `undefined`
inside the Playwright runner process. The harness's defensive
guard at `tests/e2e/global-setup.ts:353`
(`assertEphemeralDatabaseUrl(process.env.DATABASE_URL, POSTGRES_PORT)`)
rejects the unset value. Local development masks the bug because
the runner is invoked with `DATABASE_URL=postgresql://e2e:e2e@...`
exported into the shell; CI doesn't pass it. **The hardcoded
`DATABASE_URL` constant in `tests/e2e/env.ts:198` would satisfy
the assertion if it were exported into the runner env — the fix is
a one-line `env:` block on the e2e job in `ci.yml`.**

**Recommended fix (independent follow-up):**

```yaml
e2e:
  # ...existing config...
  env:
    DATABASE_URL: postgresql://e2e:e2e@127.0.0.1:39921/staging_studio_e2e
```

That alone should restore CI e2e from "always red" to "actually
runs". AGENTS.md comments in `tests/e2e/env.ts:34-49` warn the
same way I describe it here — this is the legitimate fix the
existing harness was designed around.

**Why my PR isn't the cause:** I ran the full hermetic e2e suite
locally right before merging (86/86 green, ~5 minutes). The merge
itself was unblocked because the `Lint · Typecheck · Unit tests`
required check on `main`'s branch protection is green — and per
AGENTS.md, the e2e job's red does NOT block merges that caused
it (the e2e is `push`-scoped, fires on the push to `develop`
*after* the merge, and reports but doesn't gate). The merge was
correct; the CI red is a separate operational issue.

---

## 6. Local references

- **Working dir:** `/home/alex/Projects/staging-studio` (main
  checkout, on `develop`). The commit is `5c9e297` at HEAD.
- **The full handoff chain** is in `.handoffs/`:
  - `2026-10-15-edit-room-redesign-canvas-stage.md` (older context)
  - `2026-10-15-edit-room-redesign-real-run-wire.md` (slice 2 wire-up)
  - `2026-10-16-edit-room-redesign-e2e-unblock-and-merge.md` (PR #1355)
  - `2026-10-16-edit-room-redesign-listing-copy-route.md` (PR #1356)
  - `2026-10-16-e2e-upload-failure-diagnostic.md` (prior diagnostic)
  - `2026-10-16-e2e-failures-actual-roots.md` (`c9d51b5`)
  - `2026-10-16-signoff-e2e-fix-slice.md` (`95171e8`)
  - `2026-10-16-rehearsal-selector-retarget.md` (**prior handoff**)
  - `2026-10-16-directions-rehydration-mini-slice.md` (**this handoff**)

  All six of the untracked `2026-10-15/16` handoffs continue to
  be untracked. Whoever owns the commit that crosses the next
  line should decide whether to commit them (6 docs, ~95 KB total;
  they document work that's already in `git log`) or leave them on
  disk only.
- **Touched production code paths for the next session's grep:**
  - `EditRoomStudio.tsx:84-117` (lazy initializer + room-switch reset)
  - `EditRoomStudio.tsx:466-485` (lastCommittedValue initial value)
  - `edit-room-reducer.ts:90-108` (createInitialEditRoomState factory)
  - `edit-room-studio-props.ts:67-78` (FocusedRoomLike.rawDirectives)
  - `edit-room-studio-props.ts:193-198` (resolver forwards initialDirections)
  - `types.ts:90-117` (initialDirections prop doc + signature)

## 6.1. Updated priorities (post-merge)

The next session should now address, **in priority order**:

### 6.0 — CI e2e is red everywhere (infrastructure)

**RESOLVED** by PR #1360 (squash-merged as `5372645` on
`origin/develop`). The one-line fix:

```yaml
e2e:
  env:
    DATABASE_URL: postgresql://e2e:e2e@127.0.0.1:39921/staging_studio_e2e
```

ships inside `e2e:` job in `.github/workflows/ci.yml`. Post-merge
CI run `38953955638` confirmed the suite now actually runs end to
end: `E2E (Playwright)` completed **successfully** in 2m 57s (vs.
the old failure pattern of 30s with the `DATABASE_URL is unset`
error). The hermetic 86-spec suite is now signaling real
regressions on the merges that cause them, instead of always-red
boilerplate.

### 6.1 — FineTune persistence (Issue open question #3 from prior handoffs)

Same scope question as before: schema shape (5 columns vs JSON vs
localStorage), which controls to persist, reducer-state
migration. Worth its own conversation.

### 6.2 — Autosave race uncovered by this session

**RESOLVED** by PR #1361 (squash-merged as `fe61999` on
`origin/develop`). Threaded a `beforeRun?: () => Promise<boolean>`
flush hook through `<EditRoomRunCluster>`, exposed a new
`beginRun(maskDataUrl)` slot on the imperative handle, and
swapped the route's `beginEditRoomRun` to call it. The cluster
blocks on `flush()` before `submitInpaint` so typed directives
land in `Room.rawDirectives` first; on `flush()` reporting
unsaved work remained the cluster surfaces a Retry toast and
skips the submit. Post-merge CI run `38956787323` confirmed the
full 86-spec hermetic suite now runs end to end successfully in
~2m 33s (vs. previous always-red 30s). The rehearsal spec's
`fill(DIRECTIVES)` workaround at `tests/e2e/specs/rehearsal.spec.ts:142`
retired; the main drill now finishes in 6s end-to-end.

### 6.3 — Mask-paint toast timing

Carry-over from prior handoffs. Smaller interactive polish bug.

---

## 7. Environment notes (unchanged from prior handoffs)

```bash
# From /home/alex/Projects/staging-studio (or any fresh worktree)
npm install                                # one-time
DATABASE_URL="postgresql://e2e:e2e@127.0.0.1:39921/staging_studio_e2e" \
  PATH="$PWD/node_modules/.bin:$PATH" \
  playwright test tests/e2e/specs/<file>.spec.ts
```

The env hint is required because Turbopack rejects symlinked
`node_modules`. The e2e harness is self-sufficient — no manual env
exports needed.

**Node version note:** the host has v22.22.0 but the project's
pinned to v24 LTS (per `.nvmrc`, `Dockerfile`, `ci.yml`,
`package.json#engines.node`). Per the home AGENTS.md, don't `npm
install` on v22 without bumping the pin first. For this slice I
ran `npm test`, `npm run typecheck`, `npm run lint`, `npm run
build`, `npm run e2e` — all on existing deps, no install. Confirm
CI's v24 isn't surprised by anything tsc/oxlint didn't catch.

---

## 8. FineTune persistence — scope reframe (2026-10-16, abortive session)

**This session attempted the §6.1 FineTune persistence slice and
aborted mid-way through, leaving NO partial code on disk.** All
in-flight edits (`prisma/schema.prisma`, `src/lib/metadata-schemas.ts`,
`src/components/edit-room/types.ts`) were reverted with
`git checkout HEAD -- …` and Prisma regenerated. The repo is
back to the post-#1361 clean state. This section records the
research findings so the next session doesn't repeat the same
mistakes or re-do the product-conversation groundwork.

### What I found before aborting

**The FineTune controls don't currently reach the inpaint run.**
Per `src/components/edit-room/EditRoomStudio.tsx:223-227`, all
five FineTune values are local `useState`. Per
`src/app/(dashboard)/projects/[id]/project-detail-view.tsx:485-505`,
`editRoomGuidance` is hardcoded with the constants
`promptStrength: 0.6, maskBlur: 0, seed: undefined,
creativeMode: false, lockSeed: false` (also a **wrong**
`promptStrength` default — the schema doc claims 0.8, the
DashScope wire default is 0.5; details below). So:

> "persisting" FineTune values that don't reach the API is
> decorative-only — the user's selections survive a reload but
> still don't change anything.

The original handoff framed this as a "persistence + rehydration"
slice, but that framing assumed the wire existed. It didn't.

### The Gemini finding (2026-10-16) — bigger than the original framing

The user surfaced DashScope's parameter surface from an external
source (Google Gemini). The summary (the user relayed it; the
full text is on Slack) makes the picture substantially clearer:

**DashScope's `qwen-image-2.1-pro` and `wan2.1-image-edit` (the
example JSON in the notes) `parameters` block supports:**

- ✅ `seed` (integer 0..2147483647) — used by `qwen-image-2.1-pro`.
- ✅ `strength` (float 0.0..1.0, default **0.5**) — supported on
  image-to-image / editing tasks (Wan series). The note uses
  `wan2.1-image-edit`. **This is the actual wire field; the
  repo's schema's `promptStrength` is a wrong-name alias from
  fal/Replicate days.**
- ✅ `prompt_extend` (boolean) and `style` (string presets) —
  fine-mode controls, server-side. User has no surface for these.
- ✅ `negative_prompt`, `size`, `watermark`, `n` — already handled
  in the alibaba adapter's hardcoded `parameters` block.
- ❌ `temperature` — exposure is restricted to text/LLM endpoints,
  not image synthesis.
- ❌ `cfg_scale` / `guidance_scale` / `top_p` / sampling
  temperature — none exposed for image synthesis.
- ❌ **`mask_blur`** — not a provider parameter at all. DashScope
  uses binary B/W mask images, no feathering on the server side.
  Mask feathering is a client-side / pre-upload concern — apply it
  to the data URL before submitting.

**The repo's `alibaba-adapter.ts:187-193` hardcodes:**

```ts
parameters: {
  n: 1,
  watermark: false,
  prompt_extend: true,
  seed: 42,    // hardcoded
  size: "2048*1536",
}
```

— which doesn't even consume the `seed` parameter from the
caller, never mind the other 4 guidance fields. **The alibaba
adapter has been dropping `promptStrength`, `maskBlur`, `seed`,
`creativeMode`, `lockSeed` on the floor since #1240 landed the
DashScope migration.** The schema advertised them; the adapter
ignored them.

### Three drifts this slice has to fix together

1. **Schema doc** (`ai-route-schemas.ts:64-84`) documents 5 guidance
   fields (`promptStrength`, `maskBlur`, `seed`, `creativeMode`,
   `lockSeed`).
2. **Schema field names** — `promptStrength` is wrong; DashScope's
   wire is `strength`.
3. **Schema defaults** — even within the existing schema, the
   route's hardcoded values (`promptStrength: 0.6, maskBlur: 0`)
   disagree with the schema's documented defaults
   (`0.8` and `5`, though the Gemini notes say DashScope's
   `strength` default is `0.5` — the schema doc itself was wrong,
   not just the route).
4. **Adapter** — `alibaba-adapter.ts:187-193` doesn't read any of
   the above fields; it hardcodes its own 5-parameter block.

The schema is advertising a fal/Replicate-shaped surface that
neither the adapter nor the active provider ever implements. This
is an undocumented 2-year-old bug whose first observable symptom
would have been "FineTune controls do nothing."

### Decisions made before aborting (user input captured)

The four product-input questions were answered (some corrected
from the agent's first instincts):

1. **Q1 — `adherence` handling.** ✅ **Drop `adherence` from
   FineTune entirely.** UI control removed, no Room column.
   Originally the agent recommended mapping adherence →
   creativeMode via threshold; user correctly pointed out that
   `strength` and `adherence` both invert against `promptStrength`
   and would conflict in code. P2 wins.

2. **Q2 — Default reconciliation.** ✅ Adopt an `API_DEFAULTS`
   constant in `inpaint-submit.ts` (or `ai-route-schemas.ts`),
   with the **DashScope-correct default of 0.5** (NOT the
   schema's stale 0.8). `editRoomGuidance` derives from the
   API default + the FineTune overlay.

3. **Q3 — `lockSeed` semantics.** ✅ **`lockSeed: false` always
   (no special treatment).** User corrected the agent's first
   instinct (which had been "auto-set `lockSeed: true` when the
   user types a seed"). The user's sharper insight: locking the
   seed forces identical output across reruns, which means the
   user is paying for an API call that returns the same image
   they already have. A lock is a deliberate cost (e.g.,
   cross-room reproducibility), not a default. **Default
   `lockSeed: false`; the lock toggle is an opt-in if we ever
   ship one.**

4. **Q4 — Storage shape.** ✅ **3 nullable Int/String columns
   on `Room`** (one per knob, convention fit). Reduced from 4
   after Q1 dropped adherence. Adherence removed from the
   column set entirely.

### Recommended next-step shape (revised after Gemini finding)

The original §7 11-step list landed before the Gemini findings
came in. **The shape is materially different now** — the slice
is no longer "just persistence," it's "wire-up + persistence,"
which is what §7 originally noted in the directional lesson. The
revised shape, in order:

1. **Schema migration.** 3 nullable columns on `Room`:
   - `fineTuneStrength Int?` (0..100)
   - `fineTuneExpand Int?` (0..40)
   - `fineTuneSeed String?` (digits only, max 6)
   Run `npm run db:push` (per AGENTS.md: schema-first, no
   migrations dir). Add the `fineTuneStrength`/`Expand`/`Seed`
   columns to `prisma/schema.prisma`. Document the absence of
   `fineTuneShadows` with a TODO pointer to the follow-up that
   handles shadows properly (per the user's earlier choice).

2. **Renaming at the API surface.** The repo's
   `inpaintRequestSchema` (`ai-route-schemas.ts`) has been
   advertising the wrong field name since the #1240 migration:
   `promptStrength` should be `strength` per DashScope's wire
   (default **0.5** per Gemini). Update:
   - Field rename: `promptStrength` → `strength`.
   - Default: 0.5 (down from the schema's stale 0.8).
   - Drop `creativeMode`, `lockSeed` from the schema entirely
     — see Q3 above (no FineTune input that maps to them, no
     user-facing toggle).
   - Keep `maskBlur` for now as a *placeholder* — but rename it
     to clarify it's the pre-upload feathering pass (e.g.,
     `maskFeatherPx`), not a provider parameter. Or remove it
     entirely once the feathering helper is in place.

3. **Alibaba adapter wiring.** Replace the hardcoded
   `parameters` block in `src/lib/alibaba-adapter.ts:187-193`:
   - Drop `seed: 42` — read from the call's `input.seed`.
   - Add `parameters.strength` from the call's
     `input.promptStrength` (or `input.strength` if renamed
     per step 2).
   - Do NOT add `parameters.maskBlur` (DashScope doesn't
     accept it).
   - The `seed: 42` hardcode goes away in this slice — the
     user passing a seed should now actually pass a seed.

4. **Mask feathering utility.** New `src/lib/mask-feather.ts`
   helper:
   - Takes a base64 PNG mask + a pixel radius.
   - Returns a feathered base64 PNG (binary B/W, edges blurred
     by N px).
   - Implementation: `<canvas>` with `imageSmoothingEnabled` +
     a 2D canvas blur filter, OR a small in-memory box-blur.
   - Thread through `/api/inpaint` and `/api/v1/inpaint` to
     apply the user's `expand` value before POSTing.
   - This is the new home for the `maskBlur` → wire relationship.
     If the user's `expand: 25` is set, the mask is pre-blurred
     by 25 px before submit.

5. **`lockSeed` semantics — explicit no-op.** No schema field
   for it; no UI control. Persisted `fineTuneSeed` is
   *informational-on-the-next-run*: when the user types a seed,
   it's used for the next inpaint; subsequent reruns roll
   fresh. Document this in the `FineTune` tooltip ("type a
   number for reproducibility on the next run; leave blank for
   random").

6. **`editRoomGuidance` rewire.** Replace the current
   `useMemo(..., [])` (which holds hardcoded constants at
   `src/app/(dashboard)/projects/[id]/project-detail-view.tsx:496-505`)
   with a memo that depends on the in-memory FineTune values
   (parallel to `directives[roomId]` at line 1418). Replace the
   constants with:
   ```ts
   // Assumes rename: promptStrength → strength in step 2.
   strength: clamp((strength ?? 80) / 100, 0.0, 1.0),
   maskBlur: clamp(expand ?? 12, 0, 40),  // pre-upload feather px
   seed: parseSeedOrUndefined(seed),
   // (creativeMode + lockSeed removed per Q3)
   ```
   The `useMemo` deps array must include the focused room's
   fineTune values — this is a real correctness bug in the
   current code (a `useMemo(..., [])` deps array that should
   depend on changing state).

7. **`EditRoomStudio` migration.** Move FineTune from 5 local
   `useState` to 3 controlled values. Same shape as the
   existing `initialDirections` /
   `initialCopyHeadline`:
   - New `initialFineTune?: { strength, expand, seed }` prop
     on `EditRoomStudioProps`.
   - 3 `useState`, seeded from `initialFineTune ??` with UI
     defaults (`strength: 80`, `expand: 12`, `seed: ""`).
   - 3 onChange callbacks back up to the route's `editFineTune`.

8. **Drop `adherence` and `shadows` from UI.** Modify
   `src/components/edit-room/FineTune.tsx` and
   `StagePanel.tsx`:
   - Remove the `<Slider>` for adherence (FineTune.tsx)
     and the section that mentions "follow directions".
   - Remove the `<label>` for `shadows` (FineTune.tsx) and its
     prop in FineTuneProps + StagePanel.

9. **Zod extension.** Extend `roomMetadataSchema` in
   `src/lib/metadata-schemas.ts`:
   ```ts
   const fineTuneStrengthSchema = z.number().int().min(0).max(100);
   const fineTuneExpandSchema = z.number().int().min(0).max(40);
   const fineTuneSeedSchema = z
     .string()
     .regex(/^\d*$/, { message: "Seed must contain only digits" })
     .max(6);
   ```
   Add these three as `.partial().strict()` fields alongside
   the existing `name` + `rawDirectives`.

10. **Route wiring for persistence.** Add a parallel
    `fineTuneControllersRef` and `fineTuneStatuses` state at
    `project-detail-view.tsx` (alongside the existing
    `directiveControllersRef` / `directiveStatuses`). Same
    `AutosaveController<T>` shape:
    ```ts
    new AutosaveController<{
      fineTuneStrength: number;
      fineTuneExpand: number;
      fineTuneSeed: string;
    }>({ idleMs: 2000, save: ... })
    ```
    Add `editFineTune(roomId, patch)` and `getFineTuneController`
    that parallel the existing `editDirectives` /
    `getDirectiveController`. Same flow through `saveRoomMetadata`.

11. **Resolver + FocusedRoomLike.** Add the 3 nullable columns
    to `FocusedRoomLike` in `src/lib/edit-room-studio-props.ts`,
    and forward `initialFineTune` from
    `buildEditRoomStudioProps` (the existing call site already
    passed `focusedRoom` through — add the new forward).

12. **Tests + e2e.**
    - Unit: alibaba-adapter threading (assert `parameters.strength`
      and `parameters.seed` land on the wire when caller supplies
      them).
    - Unit: `mask-feather.ts` box-blur pixel-radius boundary.
    - Unit: `editRoomStudioProps` resolver forwards the 3 fields
      (verbatim + null-coalesced cases).
    - E2E: type `seed: 12345`, run inpaint, capture the
      DashScope mock body and assert `parameters.seed: 12345`
      (not the old hardcoded `42`).

13. **PR shape.** Squash-merge as `#1362`. Branch
    `mp-redesign/issue-1362-finetune-persistence-and-wire`.

### Pinned sticky notes for the next session

These three notes get paraphrased into a `// STICKY NOTE #NNNN`
comment at the relevant call site after the slice lands, so the
intentional design decisions don't get reverted as "dead code"
by a future "cleanup" pass:

> **STICKY NOTE Q1 (`adherence` drop):** The `<FineTune>` panel
> previously exposed a 5th `adherence` slider ("Higher sticks
> closer to your words") that had no API target. It was removed
> in #1362 because both UI sliders inverted against
> `promptStrength`/`strength` and conflicted in code. **Do NOT
> re-add `adherence` without first identifying an API field (or
> staging-package field) it lands on.** The follow-up issue for
> reintroducing `adherence` is filed but not yet scoped.

> **STICKY NOTE Q3 (`lockSeed` no-op):** The `lockSeed` field
> was removed from the schema, the alibaba adapter, and the
> route's `editRoomGuidance` in #1362. Default behavior is
> `lockSeed: false` — the user's `seed` is used once on the next
> rerun, then a fresh seed is rolled. The agent's first instinct
> (auto-set `lockSeed: true` on non-empty) was rejected for
> wasting API money on identical reruns. **If a lock toggle is
> ever added, it must be opt-in (not auto-defaulted).**

> **STICKY NOTE Gemini finding (2026-10-16):** The repo's
> `inpaintRequestSchema`'s `promptStrength` field was advisory
> theater — Alibaba DashScope doesn't accept it. The field is
> renamed to `strength` to match DashScope's wire
> (`parameters.strength`, float 0.0..1.0, default 0.5). `maskBlur`
> (FineTune's `expand`) is replaced with a *server-side mask
> feathering utility* — different shape entirely, since
> DashScope masks are binary. This slice landed both halves
> together: persistence alone would be decorative.

### Why the slice was aborted (engineering sin audit)

- The slice was committed to without enough pre-work — the
  "this is bigger than expected" revelation (wiring never
  landed, and then the DashScope parameter surface was
  nothing like fal/Replicate) came too late, when I already
  had three edited files.
- I pushed past **broken state mid-file** to stay inside the
  40-turn budget. `src/components/edit-room/types.ts` ended up
  with the `EditRoomStudioProps` interface declaration line
  missing and the `FineTuneValues` interface duplicated (once
  at module scope, once nested inside the broken interface). The
  fix would have been a clean rewrite of the affected section,
  but the cleaner call was to revert all three files and stop.
- The original FineTune slice was de-scoped by prior sessions
  for exactly this reason — the AGENTS.md "no scope creep" rule
  combined with the missing-fields-by-design FineTune wiring
  made it larger than it looked at first.
- A second sin: my first two recommendations on Q1 (adherence
  → creativeMode) and Q3 (auto-set lockSeed) were wrong. The
  user corrected both — adherence because of the
  conflict-with-strength axis, lockSeed because of the
  identical-rerun cost. The product-conversation step that
  §7 originally flagged as a 30-minute pre-slice investment
  was vindicated: those two corrections both came from the
  user, not the agent.

### What this session achieved instead

- §6.0 CI infra fix: PR #1360 merged (`5372645`).
- §6.2 autosave race fix: PR #1361 merged (`fe61999`).
- Working tree restored to clean state. No half-baked
  intermediate on disk. CI green (`bab1243` is HEAD of
  `origin/develop` until the next push).
- This handoff section records the abort cleanly so the next
  session doesn't lose the research findings.

The directional lesson: a "persist some fields" slice is always
preceded by a "wire those fields into the model they affect"
slice. The directions slice (#1359) worked because directives
already wired; FineTune's wire was de-scoped by the prior
redesign and never re-landed. Both halves were always going to be
one slice — the original handoff didn't see it yet, and neither
did the agent when this session started coding.

The **second-order** lesson: "DashScope has these parameters" is
not the same as "the schema field of that name lands at the
provider." `inpaintRequestSchema`'s `promptStrength` had been
documented and validated on every inpaint call for at least a
year; it never reached the wire. The slice that names a real field
after the wire's actual surface — not after what the schema doc
says — is the slice that lands.
