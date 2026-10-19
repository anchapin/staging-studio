# Handoff — Close stale #1383 + ship develop→main release (2026-10-19)

You are a fresh AI agent picking up work after `.handoffs/2026-10-19-triage-8-abandoned-branches-followups-complete.md`. The previous session (opencode) cleaned up the 8 abandoned branches (7 deleted by an earlier session, 1 archive-tagged-and-pushed-deleted by this session's prior iteration: `issue-924-env-tests`), pushed 5 commits to `origin/develop` (`fe7bb90` gitignore, the 2026-10-19 handoffs, two 1103-changelog commits, and `d47bb5e` adding `…followups-complete.md` + removing the consumed followups), and recorded everything in `.planning/issue-1103-stale-branches-changelog.md` §"2026-10-19 followup sweep — orphan worktrees + typo dir".

Read `.planning/issue-1103-stale-branches-changelog.md` (10 minutes) and `.handoffs/2026-10-19-triage-8-abandoned-branches-complete.md` (5 minutes) first for context. **Do NOT re-read the full `…followups-complete.md`** — it's literally what you're acting on and reads as a meta-summary; the changelog is the source of truth.

## What this session needs to do

Three ordered tasks, each has a verification gate before the next starts.

### Task A — Watch CI on the 5-commit push

The 5 commits on `origin/develop` (`fe7bb90` → `36ec03c` → `73d58c3` → `0e7c006` → `d47bb5e`) trigger CI run `39290700827`. **Do NOT poll in a loop** — use `gh run watch 39290700827` (blocks deterministically, returns 3-line result). Expected green: diffs are 100% `.gitignore`, `.planning/`, `.handoffs/`, all of which the lint job ignores. If it fails, **stop and surface to operator** — this session does not have scope to fix CI regressions.

**Verify before proceeding to Task B:** CI run `39290700827` shows `conclusion: success` in `gh run list --branch develop --limit 3 --json databaseId,conclusion,status`. Record the run id + conclusion in a one-line note appended to your session output.

### Task B — Close stale housekeeping issue #1383

**Pre-flight (5 minutes — required):**

- `gh issue view 1383 --json number,title,state,body,closedByPullRequests 2>&1` — confirm the issue is still OPEN.
- `gh issue list --state open --limit 5 --json number,title 2>&1 | jq -c '.[]'` — confirm the other 7 housekeeping issues (#1384–#1390) are still OPEN and DO NOT merge this work with them.
- `git rev-parse archive/issue-924-env-tests__branch-tip-2026-10-19` — confirm the archive tag exists locally.
- `git ls-remote --tags origin refs/tags/archive/issue-924-env-tests__branch-tip-2026-10-19` — confirm the tag is on origin.
- `gh issue view 1383 --json body` — re-read the body and the embedded "How to triage" list (4 options). The right close reason is `not planned` (option 3 — "Close as WIP - the work is stale") with a comment linking the audit trail. Use `completed` only if a strict superset via #942–#957 + #965 is byte-equivalent — it is, but the prevailing convention in this repo is `not planned` for "stale branch, work landed elsewhere", per the gap-issues skill's issue template.

**Action:**

1. Post a single comment on #1383 with this skeleton (flesh out the exact SHAs from `git log origin/issue-924-env-tests --not origin/develop --format='%H %s' --no-merges`):
   > Closing as `not planned` — the branch `origin/issue-924-env-tests` was archive-tagged + push-deleted on 2026-10-19 after this session's verification that **all N commits not on develop** are squash-merge commits of PRs that already shipped into develop independently. PRs #942–#957 carry the platform work (CORS, route decomposition, Sentry, retry-backoff, ratelimit, security sanitization, AI quotas, API versioning, room variant logic, e2e fixes) and PR #965 (`issue-924-v2`) carries the env-validation tests. Archive tag preserves the original branch tip:
   > - tag: `archive/issue-924-env-tests__branch-tip-2026-10-19`
   > - SHA: `<paste actual SHA from git rev-parse>`
   > - audit: `.planning/issue-1103-stale-branches-changelog.md` §"Issue 924 — orphaned env-tests branch (RESOLVED)"
   > Recovery path if this verification was wrong: `git branch issue-924-env-tests archive/issue-924-env-tests__branch-tip-2026-10-19 && git push -u origin issue-924-env-tests`. No evidence this is needed.
2. Close with `gh issue close 1383 --reason "not planned"`.

**Verify before proceeding to Task C:** `gh issue view 1383 --json state,stateReason` returns `state: CLOSED`, `stateReason: NOT_PLANNED`. Confirmation only — do not over-engineer. Do NOT close any of #1384–#1390 in this session; that's a future batch.

### Task C — Ship develop→main release (operator-driven)

**Pre-flight (10 minutes — required reading before doing anything):**

- `AGENTS.md` "Releasing to Production" section (re-read — explicitly, do not rely on memory).
- `npm run release:check` (defaults to `origin/main` vs `origin/develop`; exits non-zero + prints the diff if `main` holds commits `develop` lacks). At the time this handoff was written, **develop is 5 commits ahead of main**; the previous session's push IS those 5. The check should pass cleanly (no main-only-commits) — but **a `release-guard` job runs in CI on the PR base and will fail if any non-merge commits appear on main that develop lacks.** If release:check fails, the action depends on what it surfaces: merge commits are expected noise (ignore); non-merge commits mean a hotfix landed on main that was never back-merged — follow the AGENTS.md procedure, do NOT silently proceed.
- `git fetch origin` — ensure local refs are fresh before doing any back-merge.
- `gh pr list --state open --base main --limit 10 --json number,title,headRefName,baseRefName,createdAt 2>&1 | jq -c '.[]'` — confirm no release PR is already open. **If one is already open, stop and surface to operator.**

**This task produces THREE artifacts (one PR + one summary commit + the post-merge verification):**

1. **Open the release PR** (the user-facing title is yours, but the body should be:
   ```
   Release: develop→main (5 commits)
   
   Per AGENTS.md "Releasing to Production" procedure.
   
   `npm run release:check`: clean (no main-only commits).
   CI `release-guard` job: required (in PR base).
   Vercel deploy on merge: Production.
   
   ## Commits
   - <sha> <subject> (<pr_or_reason>)
   - <sha> <subject> (<pr_or_reason>)
   - ... (5 entries)
   
   ## Notable pre-merge side effects
   - `.gitignore` adds `.handoff*/**` ignore + negates `.handoffs/` (commit <sha>).
   - `.planning/issue-1103-stale-branches-changelog.md` records the 2026-10-19 followup sweep (commits <sha>, <sha>).
   - 4 orphan worktrees cleaned (mp-redesign/issue-1343-copypanel-e2e, mp-redesign/issue-1344-e2e-unblock, mp-redesign/issue-1343-listing-copy, release/issue-1362c-develop-to-main).
   - 5 archive tags pushed to origin (4 mp-redesign + 924-env-tests tip).
   - `origin/issue-924-env-tests` deleted.
   
   Refs: `.planning/issue-1103-stale-branches-changelog.md` (full audit).
   ```
   The exact commit list comes from `git log origin/main..origin/develop --format='%h %s'`).

2. **Wait for CI green on the PR** (use `gh pr checks <pr-number> --watch` — not a sleep loop). Both `fast-checks` AND `release-guard` must pass. The `e2e` job does NOT fire on PR scope (it's push-scoped on develop/main), so don't wait for it here.

3. **Merge the PR**: `gh pr merge <pr-number> --merge --delete-branch=false` (the standard merge button; no rebase/squash). Vercel auto-deploys main to Production.

4. **Post-merge verification (operator-driven; the operator may want to run these by hand):**
   - `git log origin/main --oneline -5` — confirm the release is on main.
   - `gh run list --branch main --limit 3 --json databaseId,status,conclusion,name 2>&1 | jq -c '.[]'` — confirm a fresh Vercel Production deploy succeeded.
   - `gh run list --branch main --workflow "E2E (Playwright)" --limit 1` — confirm the push-scoped e2e job fired (it only runs on `push` to develop/main per AGENTS.md, so this IS its expected trigger).

**This task is where the session most often goes wrong.** Do NOT push `--admin` or use a release branch; the AGENTS.md "Resolve merge conflicts *on a release branch*" caveat does not apply here because develop is strictly ahead (release:check passed). If `release:check` fails OR `gh pr create` conflicts with an existing release PR, **stop, surface to the operator, and do not invent a workaround**. The release-guard CI job exists to catch this class of mistake.

## Hard rules (carry over from prior sessions)

- Prefix commit subjects with `[AI-assisted]` and attribute the tool (per global `~/.config/opencode/AGENTS.md`).
- **`develop` only.** Do NOT create new branches, do NOT touch `main` directly, do NOT edit worktrees — do all work on the primary worktree's `develop` branch.
- **No handbook edits.** `.gitignore`, `AGENTS.md`, and the changelog only change via the planned commits; don't sneak in unrelated edits.
- **Pre-commit hook `.githooks/pre-commit` runs `scripts/check-tsconfig-flip.sh`.** Don't hand-revert the framework-induced `preserve` → `react-jsx` flip on `tsconfig.json` — the hook enforces this on every commit and will fail your commit loudly if you forget. (If `git status` shows `M tsconfig.json` and you didn't deliberately edit it, run `git checkout HEAD -- tsconfig.json` before committing.)
- **No `rm -rf` outside what was already documented.** Any new destructive action needs explicit operator OK.
- **No interaction with Vercel CLI** (the `AGENTS.md` "Vercel CLI env commands (#1100)" footgun section is real; the prior session's #1100 lost 4 credentials via `vercel env pull .env.local`).

## Termination criteria (all required)

- [ ] Task A: CI run `39290700827` reached `conclusion: success` (recorded in session output).
- [ ] Task B: issue #1383 shows `state: CLOSED`, `stateReason: NOT_PLANNED`, comment present with archive tag reference.
- [ ] Task C: release PR opened, CI green on `fast-checks` + `release-guard`, merged via standard merge, Vercel deploy confirmed.
- [ ] `.handoffs/2026-10-19-close-1383-and-release-complete.md` written AND committed on `develop`.
- [ ] This handoff file (`.handoffs/2026-10-19-close-1383-and-release.md`) **kept** (NOT deleted — unlike the previous handoff, this one is *future-state* by design: it documents both what was done and what remains for the next session to act on the remaining #1384–#1390 housekeeping batch). A fresh session should read it before opening any related work.
- [ ] The user's outstanding question (if any) is answered. **Likely open:** any post-merge verification the operator wants surfaced — e.g. did Vercel Production deploy succeed, is `gh run list --branch main --workflow "E2E (Playwright)"` showing the freshly-fired push-scoped job.

## Notes for the next session

- **7 housekeeping issues remain open (#1384–#1390).** Each is `[housekeeping] abandoned branch:` and most have an associated "Abandoned PR" reference. The triages are 4-option per the gap-issues template (Revive / Land via new PR / Close as WIP / Already landed differently). Consider loading the `github-wave-orchestrator` skill to batch. #1385 (`issue-931-observability`, **no PR**) and #1388 (`worker/1106-signature-encryption`, **no PR**) are the most important — they have no closing PR, so the work is genuinely orphaned and needs a "land via new PR" or "close as WIP" decision by the operator.
- **`.planning/issue-1103-stale-branches-changelog.md` should grow a new section** for the develop→main release (this session, once it's done). Format follows the existing section headers. Don't pre-write it before Task C — wait until merge is done so SHA list is final.
- **`ci.yml`'s `e2e` job fires on push to develop + main**; the release-merge will trigger it post-merge. Check that run's conclusion before declaring the release "complete" — a pushed e2e regression is far cheaper to find now than during the next demo.
