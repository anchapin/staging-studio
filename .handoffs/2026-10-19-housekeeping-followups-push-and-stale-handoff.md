# Housekeeping followups — push and stale-handoff consumption

Session: 2026-10-19 housekeeping-closeout-followups
Predecessor: .agents/handoffs/archive-2026-10-19/2026-10-19-housekeeping-closeout-cleanup-COMPLETE.md (commit 763cf0d on main)

## Context (read first)

The 2026-10-19 housekeeping closeout landed on `main` as commit
`763cf0d` ([AI-assisted] (opencode) chore(closeout): 2026-10-19
housekeeping). It:

- Fixed one drift in `.env.example` (added missing `DAILY_COPY_LIMIT=50`).
- Archived 15 working drafts into
  `.agents/handoffs/archive-2026-10-19/` (gitignored, no git tracking).

The predecessor commit body lists everything, and
`.agents/housekeeping-closeout-2026-10-19.md` (gitignored state note)
has the same content in a different shape. The handoff recipe itself
is now consumed; only followups remain.

## Tasks (in order)

### 1. Push `main` to origin

The local `main` is **2 commits ahead of `origin/main`** (both from
the Oct 19 housekeeping cycle: `6ca49dd` "docs(handoffs): add Oct 19/21
housekeeping working drafts" and `763cf0d` "chore(closeout): 2026-10-19
housekeeping"). The predecessor handoff did not ask for a push, so
the closeout session held off.

Confirm the branch state, then push:

```bash
rtk git status
rtk git log --oneline origin/main..main
rtk git push origin main
```

If the push is rejected (e.g. someone else pushed in the interim), do
NOT force-push. Pull, re-run the pre-flight checks, and decide whether
to rebase or merge. `main` is protected: force-pushes and deletions
stay blocked (per AGENTS.md), so a `--force-with-lease` is also out
of scope here -- the push should succeed cleanly.

After the push, `rtk git status` should report "clean" with no "ahead"
indicator.

### 2. Consume the stale Oct 18 next-session handoff

`.handoffs/2026-10-18-next-session-handoff.md` (created 4 days before
the Oct 19 closeout) was left untouched by the predecessor session
because "per repo convention I do not proactively remove another
session's hand-off." That convention still applies -- but **this
session** is now the explicit successor chosen to consume it, so it
IS in scope.

Open the file, read it, and decide between:

- **a) It is fully superseded** by work already merged to `main`
  between Oct 18 and today. In that case, move it to
  `.agents/handoffs/archive-2026-10-18/` (gitignored, no commit),
  note in the commit body which commits superseded each of its
  pointers (if findable), and remove.

- **b) It still has live pointers** (open issue references, followup
  notes, code TODOs). In that case, do not move the file. Instead,
  open follow-up issues for any action items still in flight, file
  the rest as "superseded by <sha>" comments on the corresponding
  issues, and then move the file to the archive with a one-line
  state-of-each-item summary appended.

- **c) Mixed** (some pointers resolved, some still open). Split the
  file in the archive: keep a `.resolved.md` containing the parts
  already addressed, and a `.open.md` for any still-actionable
  notes; flag the `.open.md` in the commit body as a followup for
  the next session to action or close.

### 3. Triage the older handoffs (.handoffs/2026-09-28-* and 2026-10-07/13/17)

There are ~30 handoffs in `.handoffs/` predating the Oct 19 closeout
(see `ls .handoffs/` for the full list). The predecessor session
flagged these as "out of scope" and left them.

You are now explicitly tasked with one of:

- **a) Audit pass.** For each file, check whether its pointers are
  resolved (by `rtk git log --oneline --grep=<keyword>` or by
  reading it). Files with all pointers resolved get moved to
  `.agents/handoffs/archive-<date>/`. Files with open pointers get
  a one-line annotation at the top: `# OPEN <date> — see <issue#>`
  and remain in `.handoffs/`.

- **b) Bulk-archive everything older than 7 days** (i.e. anything
  before 2026-10-12). Document in the commit body that this is a
  "no live work found" assumption; if a followup session finds an
  open pointer in an archived file, it can resurrect by `git mv`-
  equivalent (`mv` from `.agents/`) back to `.handoffs/`.

- **c) Do nothing.** Out of scope again; document why.

Default to **(a)** if time permits (probably <30 minutes total --
most are <100 lines and just reference resolved issues). Fall back
to **(b)** only if audit shows 95%+ are already resolved.

## Pre-flight gate (do this first)

Before any commit or push:

```bash
rtk git status                    # must be clean
rtk git rev-parse --abbrev-ref HEAD  # must be main
rtk git log --oneline -3          # orient on the predecessor
rtk gh pr view 1392               # confirm still no PR; if one
                                  # exists, re-evaluate task 1
                                  # (push may now need rebase)
```

If `rtk git status` is not clean, **stop**. Something from a prior
session leaked; do not stack this cycle's commits on a dirty tree.

If `rtk gh pr view 1392` returns a real PR (the predecessor
recorded it did not exist; that may have changed), note the PR number
and add a "PR #N to be merged before push" subtask to task 1.

## State file

Write `.agents/housekeeping-followups-2026-10-19.md` as the working
state note. It is gitignored, so keep it terse:

- Predecessor commit (`763cf0d`) and what it covered
- Push outcome (success / rejected + why)
- Oct 18 handoff decision (a / b / c, with file move targets)
- Older-handoffs decision (a / b / c, with totals)
- Final state of `main` vs `origin/main`
- Anything unresolved that the *next* session should pick up

Update the state file as each task completes. Do not commit it (it
lives under `.agents/`).

## Commit discipline

- One commit per task, all prefixed `[AI-assisted] (opencode)` per
  AGENTS.md.
- Push is its own atomic step (task 1); do not bundle it with the
  handoff-consumption commit.
- Do not amend the predecessor (`763cf0d`); it is already on the
  local branch and would force a rewrite if you wanted to include
  followup work in it.
- Pre-commit hook (`.githooks/pre-commit`) checks the tsconfig flip
  (AGENTS.md "Toolchain quirks"); the closeout already cleared
  it; if any `next build`/`next dev` ran in this session, run
  `git checkout HEAD -- tsconfig.json` before committing.

## Decisions to surface back

If at any point you find:

- The drift in `.env.example` was actually intentional (e.g. a
  comment explaining "copy uses default-only and is not
  operator-tunable"), revert that one line of `763cf0d` in a fresh
  commit, do not amend.
- The 30 older handoffs contain live work I missed, file issues
  for each open pointer and link them in the state file.
- The `main` branch protection rejected your push for a reason
  you cannot resolve (e.g. required check is failing), stop and
  ask -- do not bypass branch protection.

## Refs

- AGENTS.md "Routing & auth" / "Releasing to Production" (push rules)
- AGENTS.md "Toolchain quirks" (tsconfig flip guard)
- `.agents/handoffs/archive-2026-10-19/2026-10-19-housekeeping-closeout-cleanup-COMPLETE.md`
  (predecessor handoff, full body)
- `.agents/housekeeping-closeout-2026-10-19.md` (predecessor state note)