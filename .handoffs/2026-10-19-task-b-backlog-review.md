# Handoff — Task B: surface backlog & pick next work

**Date:** 2026-10-19 (post-release)
**Predecessor:** `.handoffs/2026-10-19-post-release-next-steps.md` (Task A complete: #1391 READY on production, commit `09a37e5` deployed, `staging-studio-kappa.vercel.app` returns 200 with real app HTML title `Login · StagingStudio`).
**Repo state at handoff:** on `main`, working tree clean except for `.handoffs/` artifacts (those are intentional). `npm run release:check` OK.
**Session budget:** 20–30 turns. This task is read/list/summarize, not write code.

## Goal

Confirm nothing in the open-issue + open-PR backlog demands attention **today**, then surface 3–5 candidates for the maintainer to pick the next active task from. Do NOT pick for them, do NOT start work on the chosen one — leave the pick in their hands before any branch is created or `gh issue edit` is run.

## Pre-flight (mandatory, single round)

1. `git fetch origin` (no edits). `git status` should remain clean apart from `.handoffs/` files.
2. `npm run release:check` — must remain OK. If it now fails, **stop and surface that to the user before doing anything else** (it would mean another merge happened since the previous session).
3. `gh repo view anchapin/staging-studio --json defaultBranchRef{name}` to confirm we still treat `main` as production.

## Investigation (parallel via `ctx_batch_execute`)

Run these in **one** `ctx_batch_execute` call (labels matter — they become the FTS5 chunks the follow-up `ctx_search` will hit):

```js
[
  { label: "open_issues_paged",
    command: "gh issue list --repo anchapin/staging-studio --state open --limit 100 --json number,title,labels,createdAt,updatedAt,author,comments,reactionGroups | jq -c '. | map({n:.number,t:.title,l:.labels|map(.name),c:.comments,u:.updatedAt}) | sort_by(.u) | reverse | .[0:25]'" },
  { label: "open_prs_paged",
    command: "gh pr list --repo anchapin/staging-studio --state open --limit 50 --json number,title,headRefName,baseRefName,isDraft,createdAt,updatedAt,author,reviewDecision,statusCheckRollup | jq -c '. | map({n:.number,t:.title,head:.headRefName,base:.baseRefName,draft:.isDraft,r:.reviewDecision,sc:.statusCheckRollup|map(.name)|join(\",\")})'" },
  { label: "mp_redesign_branches",
    command: "git fetch --all && for b in $(git branch -r | grep -E 'mp-redesign'); do printf '%-45s %s %s\\n' \"$b\" \"$(git log -1 --format=%ai origin/${b#origin/} 2>/dev/null)\" \"$(git log -1 --format=%s origin/${b#origin/} 2>/dev/null)\"; done | sort -k2,2" },
  { label: "recent_merged_pull_requests",
    command: "gh pr list --repo anchapin/staging-studio --state merged --limit 8 --json number,title,mergedAt,baseRefName | jq -c '. | map({n:.number,t:.title,m:.mergedAt,b:.baseRefName})'" },
  { label: "stale_mp_branches",
    command: "git fetch --all && for b in $(git branch -r | grep -E 'mp-redesign'); do last=$(git log -1 --format=%ai origin/${b#origin/} 2>/dev/null); age=$(age_of_last_commit \"$last\"); printf '%-45s %s ago\\n' \"$b\" \"$age\"; done | sort -k2" },
  { label: "daily_quota_headroom",
    command: "psql \"$DATABASE_URL\" -A -t -c \"select user_id::text||' | copy='||coalesce((select count from \\`DailyApiUsage\\` where user_id=u.id and feature='copy' and window_date=current_date),0)||'/'||coalesce(nullif(current_setting('DAILY_COPY_LIMIT',true),''),'50')||' | export='||coalesce((select count from \\`DailyApiUsage\\` where user_id=u.id and feature='export' and window_date=current_date),0)||'/'||coalesce(nullif(current_setting('DAILY_EXPORT_LIMIT',true),''),'20')||' | label='||coalesce((select count from \\`DailyApiUsage\\` where user_id=u.id and feature='label' and window_date=current_date),0)||'/'||coalesce(nullif(current_setting('DAILY_LABEL_LIMIT',true),''),'50')||' | inpaint='||coalesce((select count from \\`DailyApiUsage\\` where user_id=u.id and feature='inpaint' and window_date=current_date),0)||'/'||coalesce(nullif(current_setting('DAILY_INPAINT_LIMIT',true),''),'20')||' | segment='||coalesce((select count from \\`DailyApiUsage\\` where user_id=u.id and feature='segment' and window_date=current_date),0)||'/'||coalesce(nullif(current_setting('DAILY_SEGMENT_LIMIT',true),''),'100') from (select id from \\\"User\\\" order by created_at desc limit 5) u\" 2>&1 | head -20" },
  { label: "beads_progress_snapshot",
    command: "cat .beads/__systemsjournal.json 2>/dev/null | jq -c '.activeTask,(.completedTasks // [] | length),(.failedTasks // [] | length)' 2>/dev/null || echo 'no beads index'" },
]
```

Then follow up with one `ctx_search` round only against these indexed chunks:

```
"which open issues have no assignee and most recent activity"
"which open issues have failing CI in their PR"
"which open PRs are blocked by branch protection"
"which mp-redesign branches have not been touched in >14d"
"what is DailyApiUsage headroom per user today"
```

## Stop / surface, do not decide

After the searches, the agent MUST do exactly two things and then stop:

1. **Print a one-page table** summarizing the open backlog: top 5 by `updatedAt`, top 5 by `comments`, any with failing CI on attached PR, the mp-redesign branch staleness table from `.planning/branches.md` if present, and the quota headroom. **No prose opinions on which to pick.**
2. **Ask the user to pick.** Use the `question` tool with `multiple: false` and 3–5 candidates drawn from the table. Do NOT call `gh issue edit`, `git checkout -B`, or any code-writing tool before the user answers.

## What's already been ruled out (do not re-litigate)

- The `mp-redesign/*` work is deliberately **on hold** per the predecessor handoff (#1383 was closed without merging those branches). Treat any `mp-redesign` PR as stale-by-policy, not as a candidate to revive unless the maintainer brings it up.
- `develop` is the work landing, **not** the production deploy target. Main is production.
- The dual-track `tasks/<n>-<name>.md` / `tests/<name>.test.ts` convention is project-wide default; do not introduce new patterns.
- Do NOT touch `tsconfig.json`'s `"jsx": "preserve"` — Next.js flips it on every build/dev and `.githooks/pre-commit` reverts it; if a flip appears, `git checkout HEAD -- tsconfig.json` and continue.
- Vercel CLI env footguns: never `vercel env pull` without a path arg other than `.env.local` / `.env`; never `vercel env pull .env.local` itself.

## Definition of done (terminal state)

- The user has selected at most one task to start.
- A short handoff file `.handoffs/2026-10-19-task-b-backlog-pick.md` is written recording: `gh issue list` snapshot hash (if available) or date, the surfaced candidates, the user's pick (or "deferred"), the `release:check` status.
- Session ends.

## Explicit non-goals

- No code edits, no new branches, no PRs opened or edited, no `gh issue edit`.
- No `npm run dev`. No Playwright run.
- No second iteration of the question — if the user wants more candidates, they'll ask.

## Failure modes to surface immediately

- `release:check` fails → print the missing-commit list verbatim, ask the user whether to back-merge.
- Any `mp-redesign` branch updated within the last 24h → print that fact; do not assume the hold is still in effect.
- An open issue with a `priority:` label of `P0` or `critical` → list it first regardless of sort order.
