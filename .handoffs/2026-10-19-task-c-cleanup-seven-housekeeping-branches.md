# Handoff — Task C: Pre-emptive Cleanup of Seven Housekeeping Branches

> **Predecessor:** `.handoffs/2026-10-19-task-b-backlog-review-complete.md`
> (the review that surfaced the 7 open rows below and produced the default
> "wait for signal" verdict; this task forces pre-emptive action).
>
> **Companion complete:** `.handoffs/2026-10-19-task-b-backlog-review-complete.md`
> (read first — it has the full provenance: pre-flight checks, why nothing
> else is in flight, the inspect-before-delete rule, and the changelog
> template).

## TL;DR

Close the seven `[housekeeping] abandoned branch` issues opened on 2026-10-19
(`#1384`, `#1385`, `#1386`, `#1387`, `#1388`, `#1389`, `#1390`) by deleting
the seven underlying branches on `origin`. Two of them (#1386, #1390) need
**inspection before deletion** because their commit counts or their names
hint at carry-over signal the predecessor review surfaced. The other five
are routine and can be deleted + closed as a batch.

**Do not touch any other branch, tag, release, or backlog item.** This is
pure housekeeping. No deploy. No `develop → main` release.

---

## Pre-flight (run these first; abort if any fail)

1. `git fetch origin` — confirm `origin/main`, `origin/develop`, and all
   seven `origin/feat/*` / `origin/fix/*` rows in the table below are
   reachable.
2. `git status` — must show a clean working tree on `main`, in sync with
   `origin/main`. If anything else is dirty, **abort and ask the user** —
   this task is not allowed to co-mingle with other work.
3. `npm run release:check` — must pass (`develop` contains every non-merge
   commit on `main`). If it fails, the predecessor release is incomplete;
   stop and ask the user before deleting anything.
4. `gh issue list --repo anchapin/staging-studio --state open --label tech-debt`
   — must return exactly the seven issues in the table below. If there are
   *more* housekeeping rows, **stop and ask the user** — the rank order in
   this handoff assumes the seven listed are the only ones in flight. If
   some have already been closed upstream, skip them and proceed with the
   remainder (note the skip in the changelog entry).
5. Confirm `opencode.worktree_list` shows zero worktrees. If any exist,
   they're not from this task — stop and ask the user.

## The seven rows (in execution order)

Each row is one branch + one issue. Execute top-to-bottom. **Do not reorder.**

| # | Issue | Branch | Commits ahead | Special handling |
| -: | --- | --- | ---: | --- |
| 1 | **#1386** | `feat/issue-984-batch-segmentation-perf` | **18** | **INSPECT FIRST** — see below. |
| 2 | **#1390** | `fix/issue-1091-mask-paint-variant-assertion` | 1 | **INSPECT FIRST** — see below. |
| 3 | #1384 | `feat/issue-931-observability` | 6 | routine |
| 4 | #1385 | `feat/issue-806-ai-image-content-moderation` | 4 | routine |
| 5 | #1387 | `feat/issue-1136-mock-segmentation-need` | 1 | routine |
| 6 | #1388 | `fix/issue-1186-virtually-staged-label` | 4 | routine |
| 7 | #1389 | `fix/issue-1365-deps-cleanup` | 2 | routine |

### Special handling: inspect before delete

For rows 1 and 2 only:

```
# Show what the abandoned branch has that develop doesn't
git log --no-merges origin/<branch> --not origin/develop --oneline
```

**Decision rule per branch:**

- If the log shows **only supersession** (typical: "WIP", "draft",
  "address review feedback", "address rebase", merge-conflict resolution,
  CI-fix commits, commits whose subject is literally the branch-name issue
  the housekeeping row already declares superseded) → proceed with delete.
- If **any commit subject looks like it carries live signal** the
  predecessor issue didn't cover — e.g. an unrelated perf fix, a real bug
  fix not in the branch-name issue, a one-off that doesn't appear
  elsewhere in `develop` or `main` → **stop**. Write a comment on the
  housekeeping issue describing the carry-over commit, then ask the user
  whether to (a) cherry-pick onto a fresh branch and PR it, (b) extract a
  new issue for follow-up, or (c) ignore and delete anyway. **Do not
  delete a branch that has unaccounted-for signal.**

### Delete + close pattern (one branch at a time)

For each row, after the inspect step (when required) returns "no carry-over":

```bash
# 1. Confirm no one else is on the branch (predecessor confirmed this
#    in the review, but check anyway — branches do not get deleted if
#    a PR is open against them)
gh pr list --repo anchapin/staging-studio --state all --head <branch> --json number,state
# Expected: []  (no PRs — these are abandoned branches, never had PRs).
# If a PR appears: stop and ask the user.

# 2. Delete on the remote (irreversible; preceded by the inspection log
#    above being saved in this handoff's companion changelog).
git push origin --delete <branch>

# 3. Close the issue with a one-line comment citing this handoff and
#    noting whether the inspect step was needed.
gh issue close <issue#> --repo anchapin/staging-studio --comment "..."
```

### Comment template (paste, fill the blanks)

For routine deletes (rows 3–7):

> Deleted `origin/<branch>` (<n> commits ahead of `origin/develop`).
> Branch has no open PR; tip inspection shows only supersession /
> CI-fix / rebase commits — no live signal to carry over. Companion
> cleanup log: `.planning/issue-1103-stale-branches-changelog.md`.

For inspect-first deletes (rows 1 and 2), use:

> Deleted `origin/<branch>` (<n> commits ahead of `origin/develop`).
> Pre-delete inspect (`git log origin/<branch> --not origin/develop`) showed:
> <one-line summary, e.g. "5× WIP, 2× CI-fix, 11× superseded by #984's
> actual perf work — no live signal">. No open PR. Companion cleanup
> log: `.planning/issue-1103-stale-branches-changelog.md`.

---

## Changelog entry (mandatory)

Append a new section to
`.planning/issue-1103-stale-branches-changelog.md` titled
`## 2026-10-19 — Pre-emptive cleanup of #1384–#1390` with:

- The date.
- The seven `(branch → issue → commit count)` triples.
- For #1386 and #1390: the one-line inspect verdict.
- A "verified by" footer with the fresh `git fetch origin && git status`
  output showing clean main, and the `gh issue list --state open --label tech-debt`
  output showing the seven rows are now closed.

Use the existing changelog's tone and template — read it once before
writing the entry so the section style matches.

---

## Constraints (hard)

- **No new branch, no new PR, no new release.** This task does not push
  to `develop` or `main`. It only deletes seven remote branches and
  closes seven issues.
- **No commits to this repo.** Deletions are remote-side; the only
  on-disk write is the changelog entry (and any new files you need to
  track inspection output, if you choose to).
- **Never run `git push origin --delete` on a branch you have not
  personally inspected or that has an open PR.** Use `gh pr list
  --state all --head <branch>` first.
- **Never `git push --force`, never `git branch -D` locally** for these
  branches — local deletion isn't required and the safety cost of a
  wrong force-push is too high.
- **Never skip the inspect step on #1386 or #1390**, even if you think
  "it's routine." #1386 is the largest in the queue (18 commits) and
  #1390 is named after a regression in live code; the predecessor
  explicitly flagged both.
- **Never close an issue before the underlying branch is deleted.** The
  comment should reference the deletion, and the order should be:
  inspect (if required) → `git push origin --delete` → `gh issue close`.

## Out of scope (do NOT do these in this session)

- Re-opening any of these branches.
- Cherry-picking any commit from these branches. If inspection finds
  carry-over signal, **stop and ask the user** — that's the whole point
  of the inspect step.
- Touching any other housekeeping branch, any `feat/*` / `fix/*` not
  listed above, or any branch with an open PR.
- Re-running `release-guard` or opening a release PR. The predecessor
  release is already caught up; this task adds no new commits.
- Editing `docs/post-demo-backlog.md`, AGENTS.md, README.md, or any
  other standing document.
- Working on any Tier 3 backlog item. The handoff's standing rule
  (Tier 3 stays dormant until usage signal) is unchanged.

---

## Exit criteria

The session is done when **all** of the following are true:

1. `git push origin --delete <branch>` has been run for all seven branches
   (with inspect output recorded for #1386 and #1390).
2. `gh issue list --repo anchapin/staging-studio --state open --label tech-debt`
   returns the seven rows as `CLOSED`.
3. `.planning/issue-1103-stale-branches-changelog.md` has a new
   `## 2026-10-19` section matching the existing tone.
4. `git status` is still clean on `main`.
5. `npm run release:check` still passes (deletion is structurally a
   no-op for `develop`/`main` content, but confirm it).
6. A short handoff file `.handoffs/2026-10-19-task-c-cleanup-seven-housekeeping-branches-complete.md`
   has been written summarizing: which seven (or fewer) rows were
   processed, the inspect verdicts for #1386 and #1390 verbatim, any
   stop-and-ask moments, and the final `gh issue list --label tech-debt
   --state open` output (which should now be empty or near-empty).

If any exit criterion is not met, **do not declare done**. State the
specific failing criterion and the partial progress in the handoff file.

---

## Reproducibility / provenance

- Predecessor review: `.handoffs/2026-10-19-task-b-backlog-review-complete.md`
- Predecessor changelog (template + style reference):
  `.planning/issue-1103-stale-branches-changelog.md`
- Issue source: all seven rows opened 2026-10-19 by the just-completed
  branch sweep; see the issue body of any one of them for the auto-template.
- The seven issues/branch pairs are pinned in the table at the top of
  this handoff. If `gh issue view <n>` disagrees with the table on the
  branch name or the commit count, treat the live `gh` data as truth and
  note the discrepancy in the changelog entry.

Date: 2026-10-19. This prompt assumes Task B's review is the most recent
context; if the repo state has shifted since the review was authored
(new open issues, new abandoned branches, dirty working tree, a new
in-flight session), re-read Task B's review and **update or replace this
prompt** before running it.