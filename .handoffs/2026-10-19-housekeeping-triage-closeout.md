# Housekeeping triage — closeout continuation (2026-10-19)

You are continuing a multi-session closeout of the abandoned-branch
housekeeping tickets (#1384–#1390, parent tracking #1392).

## Read first (in order)

1. `.planning/issue-1103-stale-branches-changelog.md` — the original
   investigation snapshot. Treat as **stale on details**; the
   spot-check findings in the next handoff supersede its narrative.
2. `.handoffs/2026-10-19-task-c-triage-finding-supersession.md` — the
   Task C1 enrichment pass, including the table of 7 housekeeping
   tickets × supersession status.
3. `.handoffs/2026-10-19-resolve-housekeeping-triage-decisions.md` —
   Task C2's enumerated decision list (6 items, all deferred to human).
4. `.handoffs/2026-10-19-resolve-housekeeping-triage-decisions-report.md`
   — **this session's authoritative baseline**. Read this last; it
   contains the spot-check corrections and the chosen plan.

## Confirmed baseline (do not re-derive)

7 housekeeping tickets: #1384 #1385 #1386 #1387 #1388 #1389 #1390
Parent tracking: #1392
All 8 are OPEN on `anchapin/staging-studio` as of the end of the
previous session.

3 fresh re-execution issues opened by the previous session:
- #1395 — `requireUser()` test mock helper (lost from #1386)
- #1396 — decompose `src/app/api/inpaint/route.ts` (304 lines)
- #1397 — decompose `label-instances/route.ts` (221) +
  `segment/furnishings/route.ts` (298)

Key spot-check corrections to the prior handoff (these are why some
of the original triage findings were wrong):
- PR #1093 (the merged successor of `wave-3-issue-993`) only touched
  `tests/e2e/specs/mask-paint.spec.ts`. The `requireUser()` auth-mock
  helper commit did NOT survive into it. Confirmed by `grep -rn
  "requireUser" src/ tests/` returning zero hits.
- Wave-5's decomposition (PR #958) DID land multiple routes. Three
  of those routes have grown back: `inpaint/route.ts` 304 lines,
  `segment/furnishings/route.ts` 298 lines, `label-instances/route.ts`
  221 lines. The "only 1 of 5 routes decomposed" framing in the prior
  handoff was misleading; the truthful framing is "3 routes still
  need work and `inpaint`/`status`/some others were successfully
  thinned."

## What the previous session declined to do

The previous session:
- Did NOT close any of #1384–#1390 or #1392.
- Did NOT post any comments on those tickets.
- Did NOT modify `develop` or any branch.
- Did NOT modify `.planning/issue-1103-stale-branches-changelog.md`.

Reason: explicit standing instruction in
`.handoffs/2026-10-19-resolve-housekeeping-triage-decisions.md` was
"don't post or push anything new without explicit human go-ahead."

## Tasks for this session

### Task 1 — Human signoff on the spot-check corrections

Before doing anything irreversible, confirm with the user that they
have read `.handoffs/2026-10-19-resolve-housekeeping-triage-decisions-report.md`
and accept the factual corrections it makes to the prior handoff. If
the user disagrees with any of the spot-check findings, your first
move is to re-verify with `git`/`gh` and revise the report.

### Task 2 — Close the 4 FULL-supersession tickets

Once signed off, close these as `not planned` with a single one-line
comment per issue:

- #1384 — `[housekeeping] abandoned branch: feat/issue-931-observability`
- #1385 — `[housekeeping] abandoned branch: spike/issue-916-toggle-design-system`
- #1388 — `[housekeeping] abandoned branch: fix/1091-mask-paint-variant-assertion`
- #1390 — `[housekeeping] abandoned branch: chore/issue-1080-experimental-modules`

Suggested close-comment shape (adjust the merged-PR number as the
spot-check confirms for each):

```
Superseded by PR #<merged-PR>. See tracking issue #1392 and the
resolution report in .handoffs/2026-10-19-resolve-housekeeping-triage-decisions-report.md
for spot-check evidence. Closing as part of the abandoned-branch
closeout batch.
```

Close reason: **not planned** (the work was done elsewhere; the
ticket was tracking the abandonment, not the work itself).

### Task 3 — Leave the 3 PARTIAL tickets OPEN until work lands

Do NOT close:
- #1386 and #1387 — these are waiting on #1395 to land.
- #1389 — waiting on both #1396 and #1397 to land.

Optional: add a one-line comment to each (per human preference) that
the work has been re-scoped to #1395/#1396/#1397 as fresh re-execution
issues. If the user prefers minimum commenting, skip this and let the
newly-opened issues cross-link themselves.

### Task 4 — Re-execution engineering work

Three real engineering tasks. Pick the order that matches the user's
preference (default: #1395 → #1396 → #1397 because each unblocks or
shares surface with the next).

#### #1395 — `requireUser()` test mock helper

Scope:
1. Read `src/lib/api-auth.ts` (`getAuthedPrismaUser`,
   `requireProjectOwnershipOrThrow`) and pick the shape: thin wrapper
   that throws `NotAuthenticatedError`, OR a `createAuthedRequestHandler(handler)`
   factory. Ask the user to pick if not obvious from the existing
   style.
2. Add the export to `src/lib/api-auth.ts`.
3. Add the e2e mock helper to `tests/e2e/` (suggest
   `tests/e2e/mock-auth.ts` to keep it separate from
   `mock-supabase.ts`).
4. Migrate one route as a canary — `src/app/api/inpaint/route.ts` is
   the natural candidate since #1396 is going to touch it anyway.
5. Add a Vitest pin if not already covered by `tests/api-auth.test.ts`.

Acceptance: per the issue body. Use a separate branch; do not commit
directly to develop.

#### #1396 — decompose `src/app/api/inpaint/route.ts`

Scope:
1. Read the full 304-line file, then read its matching
   `src/app/api/v1/inpaint/route.ts` (if it exists; verify) and the
   existing `src/lib/inpaint-*.ts` modules (`backoff`, `persistence`,
   `polling`, `completion`, `thumbnail`, `version-storage`, `webhook`)
   to find a clean landing spot.
2. Draw the seam between HTTP concerns and domain concerns. The
   domain seam should include at minimum: room validation, source-slot
   resolution, quota check, provider dispatch, result persistence,
   thumbnail upload, version-history stamping.
3. Extract into `src/lib/inpaint-submit-service.ts` (or extend an
   existing module if a clearer home emerges).
4. Reduce the route to under ~120 lines: thin shell using
   `buildDeprecationHeaders()` + `withRequestLogging()`.
5. Preserve every existing error-path status code and message —
   the test specs at `tests/e2e/specs/` pin them, and the v1 mirror
   must behave the same.

Acceptance: handler under 120 lines; no behavior change; vitest +
Playwright pass.

#### #1397 — decompose `label-instances` + `segment/furnishings`

Scope:
- Sub-task A (`label-instances`):
  1. Extract vision-label batch logic into
     `src/lib/label-instances-service.ts` (extend an existing module
     if a better home exists).
  2. Reduce route to thin shell.
  3. Preserve `src/app/api/v1/label-instances/...` behavior.
  4. Coordinate with `src/app/actions/room-batch.ts` so both call
     sites share the lib module.
- Sub-task B (`segment/furnishings`):
  1. Extract segmentation pipeline into a lib module (likely
     `src/lib/segment-call.ts`; verify what it currently does and
     extend or replace).
  2. Wire through `segment-cache.ts` and `segment-timing.ts`.
  3. Reduce route to thin shell.

Land as 2 separate PRs.

### Task 5 — Close the original 3 PARTIAL tickets + parent

Once #1395 lands → close #1386 and #1387 as `not planned`, comment:
```
Work recaptured as fresh re-execution issue #1395. See tracking #1392.
```

Once both #1396 and #1397 land → close #1389 as `not planned`,
comment:
```
Work recaptured as fresh re-execution issues #1396 and #1397. See
tracking #1392.
```

Once #1384 #1385 #1386 #1387 #1388 #1389 #1390 are all closed →
close parent #1392 as `completed`, with a final summary comment that
points at the 3 fresh issues (#1395 #1396 #1397) and the resolution
report.

### Task 6 — Write the closeout handoff

Append (don't overwrite) a final handoff at
`.handoffs/<today>-housekeeping-triage-closeout-complete.md`
that records:

- Whether each ticket closed cleanly or had follow-up.
- The PR numbers for #1395 #1396 #1397's actual merges.
- The merged SHAs for the post-decomposition state.
- Anything that surprised you (route files that grew between sessions,
  test specs that pivoted, etc.).
- The answer to the open question left in the previous handoff
  (about whether abandoned-branch spot-checks should be a standing
  rule). If undecided, leave the question in the closeout instead.

## Standing instructions (carry over from prior handoff)

- DO NOT close issues or open issues or modify files outside the
  three tasks above without explicit human approval.
- DO NOT run `npm audit fix`, `git rebase` against shared branches,
  or any other operation that could disturb other agents' work.
- DO NOT touch `.planning/issue-1103-stale-branches-changelog.md`;
  it is a static investigation snapshot.
- DO prefix any new commit subject with `[AI-assisted]` and attribute
  the tool (per the home-directory AGENTS.md).
- If you find new factual drift between the handoffs and current
  truth, STOP and tell the user before continuing — that is what
  the previous session's spot-check caught and what saved the work
  from being attributed to the wrong PRs.

## Tokens-and-tooling reminders

- Use `rtk` prefix on shell commands.
- Use `ctx_execute_file` (not `read`) for any file analysis >100 lines.
- Use `ctx_batch_execute` for 3+ related shell commands.
- Use `gh` (with `anchapin/staging-studio`) for all GitHub API calls.
  Do NOT use the Vercel CLI per the AGENTS.md warning.
- For numerical reasoning (e.g. "how much smaller is the route file
  after decomposition") use Python, not prose. `awk 'END{print NR}'`
  is fine for raw line counts.

## File-level summary of what THIS session should produce

- New files: `.handoffs/<today>-housekeeping-triage-closeout-complete.md`
- Modified files: **none** outside new branches for the 3 re-execution
  tasks, which must be merged before the closeout handoff.
- New GitHub issues: **none expected** (the 3 already exist at
  #1395 #1396 #1397).
- New PRs: one per re-execution task (#1395 likely 1, #1396 1,
  #1397 2 — confirm with user).
- Closed issues: #1384 #1385 #1388 #1390 first, then #1386 #1387
  after #1395 lands, then #1389 after #1396 and #1397 land, then
  #1392 last.
- `develop` HEAD: changes only via the merged re-execution PRs.
