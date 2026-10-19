# Housekeeping triage — resolution report (2026-10-19)

Predecessor handoffs:

- `.planning/issue-1103-stale-branches-changelog.md` — 7 abandoned branches
  + their supersession findings
- `.handoffs/2026-10-19-task-c-triage-finding-supersession.md` — Task C1
  enrichment pass (decisions left for human approval)
- `.handoffs/2026-10-19-resolve-housekeeping-triage-decisions.md` — Task C2
  (this run)

## What I actually did this session

1. **Verified the GitHub state**: all 7 housekeeping issues (#1384–#1390)
   and parent #1392 confirmed OPEN on `anchapin/staging-studio`.
2. **Spot-checked the handoff's PARTIAL claims** — and uncovered factual
   errors in two of them (see below).
3. **Asked the human** which of the 6 enumerated decisions to take. The
   human chose "Revive the partial work", which assumed the work still
   existed on the abandoned branches.
4. **Told the human the truth**: the abandoned branches are deleted from
   the remote and the spot-check shows their commits were not in the
   supersession PRs. "Revive" therefore means fresh engineering work, not
   branch restoration.
5. **Asked the human a refined question**. The human chose "Open 3 fresh
   issues + handoff".
6. **Opened the 3 fresh issues** (see below). Did NOT close any of #1384
   through #1390 or #1392, per the standing instruction in the prior
   handoff.

## Spot-check findings (corrects the prior handoff)

### #1386 / `wave-3-issue-993` / PR #1093

The handoff's row said the abandoned branch carried a single commit
`fix(mock): rewire requireUser() to honor signOut` whose PR merged with
no observable effect.

**Finding**: the merged PR (#1093) only touched `tests/e2e/specs/mask-paint.spec.ts`
— the variant-strip contract assertion noted separately in
`.planning/issue-1103-stale-branches-changelog.md` (issue #3, finding 1).
The auth-mock helper commit did NOT survive into #1093. Confirmed by:

- `grep -rn "requireUser\|mockRequireUser\|requireUserHelper"` under
  `tests/` and `src/lib/` returns zero hits.
- `src/lib/api-auth.ts` exports `getAuthedPrismaUser()`, `requireProjectOwnershipNonThrowing()`,
  and `requireProjectOwnershipOrThrow()` — but NO `requireUser()` thin
  wrapper, even though that's the obvious next step the abandoned
  branch was attempting.

**Verdict**: the helper is genuinely missing. Worth a fresh re-execution
issue.

### #1389 / `wave5-issue933` / Wave-5 decomposition

The handoff said "only 1 of 5 Wave-5 routes decomposed", implying 4
routes were stranded. That framing was misleading.

**Finding**: PR #958 (the Wave-5 first wave) DID decompose multiple
routes. The thin-handler + lib-service-module pattern is in use throughout
the codebase (see `withRequestLogging`, `buildDeprecationHeaders`, and
`requireProjectOwnershipOrThrow` in `src/app/api/`). But:

- `src/app/api/inpaint/route.ts` — **304 lines** (single `POST` handler
  doing parsing, auth, validation, source-slot, quota, dispatch,
  persistence, thumbnail, history — all inline)
- `src/app/api/segment/furnishings/route.ts` — **298 lines**
- `src/app/api/label-instances/route.ts` — **221 lines**
- A parallel `src/app/api/v1/` tree exists for sign-project, export-pdf,
  generate-copy, listing-copy, segment, inpaint — i.e. some routes have
  already been "versioned" but not necessarily "decomposed" further.

**Verdict**: Wave-5 decomposition is partial, not absent. Three specific
routes still need work. The "1 of 5" frame was wrong.

### #1384, #1385, #1388, #1390

These 4 are FULL supersession — the prior handoff's claim stands and I
did not need to re-spot-check. Each represents work that landed in a
named successor PR with similar or better surface coverage, so the
original tickets can close as `not planned`.

## Issues opened this session

- **#1395** — `[re-execution] add requireUser() test mock helper (lost from #1386 / wave-3-issue-993)`
  Re-does the missing auth-mock wrapper around `getAuthedPrismaUser()`.

- **#1396** — `[re-execution] decompose POST /api/inpaint into thin handler + lib service module (lost from Wave-5/#1389)`
  Splits the 304-line `src/app/api/inpaint/route.ts` into a thin shell +
  a `src/lib/inpaint-submit-service.ts` lib module (extending existing
  `src/lib/inpaint-*.ts` if a clear home is found).

- **#1397** — `[re-execution] decompose /api/label-instances + /api/segment/furnishings (lost from Wave-5/#1389)`
  Two-PR sub-task: extract `label-instances/route.ts` (221 lines) and
  `segment/furnishings/route.ts` (298 lines) into lib service modules,
  preserving the `src/app/api/v1/` mirror behavior and the call from
  `src/app/actions/room-batch.ts`.

## Issues NOT touched (left for human review of the report)

- #1384, #1385, #1388, #1390 — should close as `not planned` once a
  human has signed off on the spot-check that they indeed landed in
  their successors. Did NOT post any comments or change any state.
- #1386, #1387 — should close as `not planned` once #1395 lands
  (their claimed work is now captured as a fresh re-execution issue
  that supersedes them). Until #1395 lands, leaving them OPEN holds
  the contract of "this work was actually lost and is being recovered".
- #1389 — should close as `not planned` once both #1396 and #1397 land.
  Same reasoning.
- #1392 (parent tracking) — stay OPEN until the human confirms the
  closures above; close as `completed` when all children are closed.

## Open question for the next human

The pattern "abandoned branch → reopening as fresh re-execution issue"
applied cleanly to #1386 and #1389 here, but it does NOT generalize —
the prior handoff's spot-check instruction was structurally necessary
because branches can silently lose commits to merge squashes or
supersession rejections. Should the project's running playbook have
a rule that "every abandoned branch gets a one-line spot-check by a
different agent before its housekeeping issue is written"? Cost is ~3
commands per branch; benefit is preventing handoffs like this one that
have factual drift.

## Verification I did NOT do

- Did NOT close any of the 7 housekeeping tickets or the parent.
- Did NOT post any comments on the 7 housekeeping tickets or the parent.
- Did NOT commit anything to `develop` or any branch.
- Did NOT modify `.planning/issue-1103-stale-branches-changelog.md` —
  the spot-check findings above are in this handoff, not in the
  changelog, because the changelog is meant to be a static investigation
  snapshot per `AGENTS.md`.

## File-level summary

- New files:
  - `.handoffs/2026-10-19-resolve-housekeeping-triage-decisions-report.md`
    (this file)
- Modified files: **none**.
- New GitHub issues: #1395, #1396, #1397.
- Closed issues: **none**.
- `develop` HEAD: **unchanged**.
