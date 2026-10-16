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

## 6. Updated priorities (post-merge)

The next session should now address, **in priority order**:

### 6.0 — CI e2e is red everywhere (infrastructure)

`origin/develop`'s e2e job has been failing with
`DATABASE_URL is unset` on every push since at least 2026-10-15.
The fix is one line in `.github/workflows/ci.yml`. Until that
lands, **the e2e suite is effectively unobserved in CI** — local
runs catch regressions only when humans manually re-run them,
which is unsustainable. Land this before any further feature work.

### 6.1 — FineTune persistence (Issue open question #3 from prior handoffs)

Same scope question as before: schema shape (5 columns vs JSON vs
localStorage), which controls to persist, reducer-state
migration. Worth its own conversation.

### 6.2 — Autosave race uncovered by this session

Still applicable even after merge — production users will hit the
same race in real usage when typing fast and clicking Run before
the 2s autosave timer fires. Recommended fix: have the Run button
`flush()` the directive autosave controller before submitting
inpaint (threaded via `<EditRoomRunClusterHandle>`, same shape as
`beginEditRoomRun`). Once landed, the `fill(DIRECTIVES)` workaround
in `tests/e2e/specs/rehearsal.spec.ts:142` can retire.

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
