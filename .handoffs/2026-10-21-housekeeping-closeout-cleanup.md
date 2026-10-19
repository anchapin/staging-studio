# Next session — finish the 2026-10-19 housekeeping closeout

Pairing: this is the **follow-up** to
`.handoffs/2026-10-19-housekeeping-triage-closeout-COMPLETE.md`. The
previous session executed Task 1 (close 6 of 7 abandoned-branch
issues), Task 2 (delete 3 branches — all confirmed already absent on
origin), and Task 3 (revert `.planning/issue-1103-stale-branches-changelog.md`).

Three things were deliberately left for the next session — that's
what this prompt works on.

## Standing rule (do not violate)

Per the source closeout's standing rule 1: **"Do not close issues,
open issues, or modify files outside the three tasks below without
explicit human approval."** The three tasks are listed under "Tasks"
below. If a fourth becomes necessary (e.g., a stale issue needs
re-opening because the prior close was wrong), stop and ask first.

## Pre-flight (do this first, in this order)

Run **before anything else**. Each step has an expected outcome —
if it doesn't match, do not proceed without human input.

1. **Confirm HEAD is clean and on `main`** (or `develop` — see note).

   ```
   git -C /home/alex/Projects/staging-studio status --short
   git -C /home/alex/Projects/staging-studio rev-parse --abbrev-ref HEAD
   ```

   Expected: clean tree (the untracked `.handoffs/*` files from the
   prior session are expected to remain untracked; they are NOT in
   the diff). HEAD is `main`. If HEAD is `develop`, that's also fine
   — they were synced at `09a37e5` when this handoff was authored.
   If HEAD is anything else, stop and ask the user.

2. **Confirm the 6 issues are still closed and #1389 is still OPEN.**

   ```
   for n in 1384 1385 1386 1387 1388 1389 1390; do
     printf "#%s: " "$n"
     gh issue view $n --repo anchapin/staging-studio \
       --json state,stateReason | jq -c '{state,stateReason}'
   done
   ```

   Expected:

   - `#1384, #1385, #1386, #1387, #1388, #1390` → `{"state":"CLOSED","stateReason":"DUPLICATE"}`
   - `#1389` → `{"state":"OPEN","stateReason":""}`

   If anything regressed (a close got reverted, a new comment landed
   that changes the verdict), STOP and ask the user before doing
   anything else. The prior close comments are the audit record;
   don't make decisions that erase them silently.

3. **Confirm the changelog is in its reverted clean state.**

   ```
   git -C /home/alex/Projects/staging-studio diff --stat HEAD -- .planning/issue-1103-stale-branches-changelog.md
   ```

   Expected: empty output (file matches HEAD). If the diff is
   non-empty, the previous session's revert did not stick — check
   what changed and ask the user whether to re-revert or to leave
   whatever's there.

4. **Read** `.handoffs/2026-10-19-housekeeping-triage-closeout-COMPLETE.md`
   end-to-end. The next session hasn't seen the work; the closeout
   handoff is the only truthful record. Pay particular attention
   to the **Items deliberately NOT done** section.

## Tasks

### Task A — confirm #1389's tracking comment is still useful (or refresh it)

`#1389` is the one issue left open. The previous session posted a
tracking comment listing the 4 missing API-route decompositions:

- `/api/inpaint`
- `/api/inpaint/[requestId]/status`
- `/api/inpaint/submit` (etc. — confirm by re-reading #1389's body
  and the tracking comment itself)
- `/api/label-instances`
- `/api/segment/furnishings`

`api/inpaint` and `api/label-instances` are two I haven't yet
verified exist at exactly those paths. **Spot-check** the actual
file paths under `src/app/api/` before claiming them in any update.
If the routing tree has changed, update the tracking comment with
the correct paths and a brief one-line note about what changed
(e.g. "issue-label 'inpaint' was split into submit/status; both
listed above").

**Why the comment matters:** `#1389` will be invisible to most
searches (closed-by-default filters, no fresh activity). The
tracking comment is the only signal that surfaces during searches.
If the routes have shifted, this is the moment to fix the comment
before more time passes.

If the comment is still accurate, post a brief acknowledgement
("confirming the 4 routes listed in the previous comment are still
the open set as of YYYY-MM-DD") so future searches see a recent
timestamp. **Do NOT close #1389** — even if it feels redundant.
Closing it without 4 follow-up issues per route would erase the
signal.

### Task B — decide what to do with the untracked `.handoffs/*` files

The previous session left **9 untracked files** in `.handoffs/`:

```
2026-10-19-close-1383-and-release.md
2026-10-19-close-1383-and-release-complete.md
2026-10-19-housekeeping-triage-closeout.md
2026-10-19-housekeeping-triage-closeout-COMPLETE.md
2026-10-19-task-b-backlog-review-complete.md
2026-10-19-task-c-cleanup-seven-housekeeping-branches.md
2026-10-19-task-c-triage-finding-supersession.md
2026-10-19-triage-8-abandoned-branches-followups-complete.md
(exact list — confirm via `ls .handoffs/2026-10-19*`)
```

**Question for the human (one question, don't spawn more than one
round of clarification unless the user asks):**

> These 9 untracked handoff docs are the audit trail of the
> 2026-10-19 housekeeping sweep. Options:
>
> - (a) Commit them as one housekeeping-record batch with the
>   subject `[AI-assisted] (opencode) docs(handoffs): preserve
>   2026-10-19 housekeeping audit trail (9 files)`.
> - (b) Leave them untracked — they remain discoverable via the
>   filesystem and any `rg` search but don't bloat the index.
> - (c) Consolidate: collapse the 9 docs into 1-2 anchor files
>   (e.g. one "housekeeping audit trail" + one "task-c swap
>   rationale"), then commit those and remove the originals.
> - (d) Move them to an archive dir
>   (e.g. `.handoffs/archive/2026-10-19/`) and add a `.gitignore`
>   rule that ignores `archive/` only. Treat the untracked
>   filesystem copies as cold storage.

Don't pick (a)/(c)/(d) on your own. **Ask.** The repo's
housekeeping-policy precedent (per prior `docs(handoffs)` commits)
favors (a) for new anchor docs and (b) for ephemera, but the user
has been mixing both. One question, four options, no
opinion-overlay.

### Task C — re-author the stale-branches changelog (if Task A confirmed unchanged)

**Do this only if Task A's spot-check confirmed the 4 missing
routes have NOT shifted** — otherwise the changelog needs to
incorporate whatever Task A discovered, and Task C grows into a
slightly different shape.

`.planning/issue-1103-stale-branches-changelog.md` was reverted to
its pre-sweep clean state at the end of the prior session. It
therefore currently records **less** than what actually happened
this cycle. Tasks A's confirmation is the input; Task C is the
output.

The goal: replace the file's content with a concise ledger of
**what landed** in this cycle (6 closed issues, 0 branches deleted
since they were already gone, the spot-check, the swap
resolution). Keep the file ≤ ~200 lines — it's a ledger, not an
essay. Don't link to the closeout handoff from inside the ledger
(loop); reference it once and trust the reader.

Suggested structure:

```
# Issue #1103 — stale-branches changelog

## 2026-10-19 sweep (executed by .handoffs/...-COMPLETE.md)

Closed issues (6): #1384 #1385 #1386 #1387 #1388 #1390
Left open (1): #1389 (partial supersession; tracking comment posted)
Branches attempted delete (3): all 3 absent on origin (HTTP 422),
  so deletion was a no-op. Pruning happened earlier via #964 /
  #1016 / #1093.
Spot-check: src/lib/api-auth.ts `requireProjectOwnershipOrThrow`
  lives; tests/e2e/specs/export-pdf-v1.spec.ts:183 references it.
Swap resolution: source-prompt mapped #1390->chore/...-modules
  and #1388->fix/...-assertion; truth was opposite. Honored.
Working tree: clean at end (changelog was reverted to the
  pre-sweep snapshot during the original handoff). Fresh
  re-authoring done by .handoffs/2026-10-21-.../followup of the
  same prompt.

## (older entries below the divider — preserve verbatim from HEAD)
```

Concise. If the user prefers a different structure, ask before
re-writing.

## After the three tasks: state at handoff

- 6 issues still closed, `#1389` still open with a tracking comment
  that reflects the (possibly shifted) current route tree.
- `.planning/issue-1103-stale-branches-changelog.md` re-authored
  against the current cycle, ≤ ~200 lines.
- Resolution of the `.handoffs/*` files recorded in the closeout
  handoff's "State at handoff" section (or a successor).
- A new handoff file at
  `.handoffs/2026-10-21-housekeeping-closeout-cleanup-COMPLETE.md`
  capturing this session's work — that's the anchor for the
  *following* session, the same way `2026-10-19-...-COMPLETE.md`
  was the anchor for this session.

## What I will NOT do

- Re-open any of the 6 closed issues. If you conclude one was
  closed in error, ask the user, don't unilaterally reopen.
- Open new tracking issues for the 4 missing decompositions on
  this session (would compete with `#1389`'s umbrella).
- Modify `src/`, `tests/`, `prisma/schema.prisma`, `package.json`,
  env vars, or any other code/config.
- Run `git checkout HEAD -- anything` other than the changelog
  if its diff has accumulated during Task C.
- Touch `tsconfig.json` (Next.js rewrites it on `next build`,
  per `AGENTS.md`; pre-commit guard `.githooks/pre-commit` will
  catch accidental commits).
- Commit anything without `[AI-assisted]` prefix and `(opencode)`
  attribution per repo-wide rule.

## Pairing

- Predecessor: `.handoffs/2026-10-19-housekeeping-triage-closeout-COMPLETE.md`
- (this file's name): successor prompt

Both will exist together until the next cleanup cycle.
