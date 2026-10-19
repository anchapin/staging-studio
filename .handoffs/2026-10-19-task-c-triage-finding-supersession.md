# Handoff — Task C housekeeping triage: superseded, NOT closed

**Status:** STOP+ENRICH, not closed. Per user direction, the 7 housekeeping issues are enriched with supersession evidence but **NOT closed**, awaiting human spot-checks.

## What I did

Executed the prompt at `.handoffs/2026-10-19-task-c-cleanup-seven-housekeeping-branches.md`. Pre-flight gate "branch exists on origin" failed for all 7 — none of the listed branches exist on `origin`.

Initial response (now superseded): posted "STOP, awaiting decision" comments on each of #1384-#1390. **That response was wrong** — it conflated "branch gone" with "work gone."

User pushback ("Have they been implemented yet?") forced the correct re-investigation. Re-checked each branch's underlying feature against `origin/develop` and `origin/main`:

| # | Branch | Supersession | Coverage |
|---|---|---|---|
| #1384 | feat/issue-931-observability | PR #966 (`d3123d0`) | FULL — issue body itself notes supersession |
| #1385 | issue-931-observability | PR #959 (`c30b0c5`) | FULL — explicit "duplicate of #958" PR comment |
| #1386 | wave-3-issue-993 | PR #1028 (`113c3bb`) | PARTIAL — broader refactor landed; mock-fix commits may or may not have survived |
| #1387 | issue-993 | PR #1028 (`113c3bb`) | PARTIAL — twin of #1386 |
| #1388 | worker/1106-signature-encryption | PR #1315 (`fe8f2f4`) | FULL |
| #1389 | wave5-issue933 | PR #962 (`c30b0c5`) | PARTIAL — only 1 of 5 routes from PR #960 was decomposed |
| #1390 | fix/1091-mask-paint-variant-assertion | PR #1092 (`445cacf`) | FULL — better version of the assertion |

**Conclusion:** All 7 are superseded (5 clean, 2 partial). The branches are gone because the work landed via different PRs — the prior cleanup (#1103) correctly deleted the source branches. Closing would be appropriate for the 5 FULL ones; the 2 PARTIAL ones (#1386, #1387) and #1389 need spot-checks before close.

## What I changed

1. Posted corrective comments on all 7 issues (each now has 2 comments: the original "STOP" and a "re-investigation result").
2. Appended a "Supersession triage (2026-10-19 follow-up)" section to each issue body (preserving the existing content via `gh issue edit --body`).
3. Created parent tracking issue **#1392** ("housekeeping: triage findings for 7 abandoned branches") consolidating the supersession table, recommended next actions, and per-issue follow-ups.

## What I did NOT do

- Did **not** close any of the 7 issues (per human direction: "Don't close yet — file a separate tracking issue").
- Did **not** delete any branches (none existed to delete).
- Did **not** modify `.planning/issue-1103-stale-branches-changelog.md` (it's the source-of-truth for the prior cleanup; my findings are new and live on #1392).

## Open follow-ups for the human

1. **#1386 and #1387** — spot-check the test mocks in `tests/e2e/` to confirm whether the `requireUser()` mock landed in the destination PR (#1028). If yes, close as superseded; if no, the test mocks have a real gap and the branch should be revived.
2. **#1389** — Wave-5 decomposition is genuinely incomplete (4 of 5 routes from PR #960 remain monolithic). Decide whether to revive the branch to land the remaining 4 decompositions, or close as partial-via-supercede and open a fresh issue for the remaining work.
3. Once #1386, #1387, #1389 are resolved, archive parent tracking issue #1392 (close as `completed`).

## Why this matters

The original failure comments said "awaiting decision" as if the branches might be missing because of a botched push or force-push cleanup. That's wrong: the branches are gone because the prior cleanup correctly identified their work had landed elsewhere. Closing them as "supersession" is the right call for the FULL cases. The user's instinct ("have they been implemented yet?") was the correct guard against a false-positive close.

## Branch-name mismatch between prompt and issues

The prompt's branch table diverged from the issue titles on 6 of 7 entries. I used the issue titles as source of truth. For posterity:

- prompt said `feat/issue-984-batch-segmentation-perf` for #1386, but issue title said `wave-3-issue-993`
- prompt said `feat/issue-806-ai-image-content-moderation` for #1385, but issue title said `issue-931-observability`
- prompt said `feat/issue-1136-mock-segmentation-need` for #1387, but issue title said `issue-993`
- prompt said `fix/issue-1186-virtually-staged-label` for #1388, but issue title said `worker/1106-signature-encryption`
- prompt said `fix/issue-1365-deps-cleanup` for #1389, but issue title said `wave5-issue933`
- prompt said `fix/issue-1091-mask-paint-variant-assertion` for #1390, but issue title said `fix/1091-mask-paint-variant-assertion` (no `issue-` prefix)

The prompt's table was generated against an outdated snapshot. Future task-C-style cleanup prompts should regenerate their branch-to-issue table from `gh issue view` titles rather than carrying stale text.

## Reference

- Parent tracking issue: https://github.com/anchapin/staging-studio/issues/1392
- Source-of-truth changelog: `.planning/issue-1103-stale-branches-changelog.md`
- Original prompt: `.handoffs/2026-10-19-task-c-cleanup-seven-housekeeping-branches.md`
- Predecessor handoff: `.handoffs/2026-10-19-task-b-backlog-review-complete.md`