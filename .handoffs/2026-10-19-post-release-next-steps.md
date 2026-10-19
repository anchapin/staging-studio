# Handoff — 2026-10-19 post-release: Vercel check + back[log + demo prep

**Source:** follow-up to `.handoffs/2026-10-19-close-1383-and-release-complete.md`. Release #1391 merged at 17:18:50Z, e2e green on `main` (run 39293042306), Vercel deploy was in flight when the session ended.

**Priority:** all three are operator-decisions, not blocking — pick the one that matches what's actually on the calendar.

## Pre-flight (always — before any task)

- `git fetch origin && git status` — confirm clean, on the right branch.
- `npm run release:check` — should still be clean.
- Read `AGENTS.md` "Releasing to Production" if any release-shaped work comes up.
- Do **NOT** create new branches, touch `main`, or edit worktrees. This handoff is observe/communicate/decide only — no code work expected.

---

## Task A — Confirm Vercel production deploy is READY (5 min, recommended)

**Why:** The merge of PR #1391 triggered a Vercel git-integration deploy, but the previous session ended before it was confirmed live. A pre-demo deploy that's still `BUILDING` is fine (the previous prod build is still serving) but you want to know — and a `ERROR` state would mean a hotfix is needed *now*, not at demo time.

**Steps:**

1. Check the Vercel dashboard / CLI for the latest production deploy:
   ```bash
   vercel list --prod
   ```
   Look for a deploy on commit `09a37e5` (the PR #1391 merge commit) with state `READY`.
2. If `READY`: nothing to do.
3. If `BUILDING`: wait. Poll with `vercel ls <deployment-url>` (or just refresh the dashboard) until it lands. Most Vercel Next.js builds complete in 1-3 minutes for this repo's size.
4. If `ERROR`: this is a deploy-time failure, not a code bug — the Vercel build logs will say what failed. Most common cause: a `next.config.ts` issue, an env-var that exists in the Vercel project but isn't typed in `.env.example`, or a `package.json#engines.node` mismatch (this repo pins `24.x` per AGENTS.md). Do not start a new release branch; surface the error in the next agent session instead.
5. **Termination:** write a one-line confirmation in the handoff log (e.g. "Vercel deploy 09a37e5: READY at 17:25Z, 2m12s build time"). Or, if it failed, paste the failing log snippet and the Vercel deploy URL.

**Note:** per AGENTS.md "Vercel CLI env commands", never run bare `vercel env pull` to a default path — it will silently clobber `.env.local` and break the `.env → .env.local` symlink Prisma depends on.

---

## Task B — Surface the actual open backlog and pick the next thing (15-30 min, only if there's no demo coming up)

**Why:** `develop` is equal to `main` at `d47bb5e`. There's no in-flight work to release. The mp-redesign branches (`mp-redesign/issue-1343-copypanel`, `mp-redesign/issue-1344-route-mount`, `mp-redesign/issue-1346-remove-legacy`) may be in-progress or may be abandoned worktrees from the issue-1103 sweep — needs a check before assuming.

**Steps:**

1. List open issues, sorted by recency or label:
   ```bash
   gh issue list --state open --limit 30 --json number,title,labels,createdAt,updatedAt
   ```
2. Spot-check the mp-redesign branches:
   ```bash
   git log origin/mp-redesign/issue-1343-copypanel --oneline -5
   git log origin/mp-redesign/issue-1344-route-mount --oneline -5
   git log origin/mp-redesign/issue-1346-remove-legacy --oneline -5
   ```
   If any tip is older than the last release and has no open PR, it's a likely abandoned branch — surface it (do not delete; the previous handoff established the pattern: push-delete + reflog archive + changelog entry).
3. If the open issues look thin: run the `gap-issues` skill. It spawns parallel persona-driven sub-agents (PM, designer, security, accessibility, etc.) that audit the repo against the PRD/AGENTS.md and open issues for gaps. Output: a fresh batch of issues + labels. Estimated 20-40 minutes wall time; the spawn is parallel.
4. If issues look dense: don't auto-pick. Surface the top 5 by priority (label `priority:high` or `P0`/`P1` if the repo uses them) and let the operator pick. **Do not** start coding on a top-picked issue without explicit operator sign-off — the previous handoffs established that release-shaped work needs hand-handoff, not autonomous execution.

**Termination:** either (a) the operator has chosen the next issue and a handoff handoff exists for it, or (b) the gap-issues sweep has run and its issue batch is the backlog to work from.

---

## Task C — Demo prep (only if a demo is on the calendar)

**Why:** The previous session's release shipped cleanly, but a staging-studio demo depends on more than just "the latest code is on prod" — it depends on Browserless, Supabase, DashScope, and OpenAI all being reachable from the live deploy, the daily API quotas being fresh, and the demo rooms being in the right state. AGENTS.md points to the standing demo material under `docs/DEMO_SCRIPT.md` and `docs/demo/uat-verification-runbook.md`.

**Steps:**

1. **Read first:** `docs/DEMO_SCRIPT.md` and `docs/demo/uat-verification-runbook.md`. Both are standing guides, not point-in-time.
2. **Run the rehearsal drill:**
   ```bash
   bash scripts/rehearsal-drill.sh
   ```
   This makes live assertions against the `PROD_URL` deploy (NOT the Playwright e2e suite — this is a separate, real-credentials check). The script's exit code is the readiness verdict.
3. **Quota sanity check:** the daily API caps (`DAILY_INPAINT_LIMIT` default 20, `DAILY_COPY_LIMIT` default 50, `DAILY_LABEL_LIMIT` default 50, `DAILY_EXPORT_LIMIT` default 20, `DAILY_SEGMENT_LIMIT` default 100) are enforced per-user from the `DailyApiUsage` table. Confirm the demo user hasn't burned through them — `DailyApiUsage` rows are the source of truth, not the env var. From a `npx prisma studio` (or a one-shot `npx tsx` query against `DATABASE_URL`):
   ```sql
   SELECT user_id, feature, count, usage_date
   FROM "DailyApiUsage"
   WHERE usage_date = CURRENT_DATE
   ORDER BY user_id, feature;
   ```
4. **Demo data check:** confirm the staging rooms in the demo project (per the script's UAT runbook) still have the right before/after pairs and that the inpaint versions haven't drifted.
5. **Operator presence:** a staging-studio demo is operator-driven (live staging edits, live AI generations). The agent's job is to confirm the system is ready, then step back. The operator runs the demo.

**Termination:** the rehearsal drill exits 0 AND the quota check shows headroom AND the demo data is in the expected state. If any of those fail, that's the work for the next session — don't try to push through it on demo day.

---

## Termination criteria for the session that picks this up

- Task A: Vercel deploy status is known (`READY`/`BUILDING`/`ERROR`) and recorded.
- Task B: backlog status is known (existing issues + any new from `gap-issues`).
- Task C: rehearsal drill verdict is known (`0` / non-zero) and quota headroom is confirmed.

Pick whichever task matches today's actual need. Don't try to do all three in one session unless the operator says so — each is a 5-30 minute unit of work, and a 3-in-1 sprint tends to run out of session budget (40-50 turn hard cap per AGENTS.md "Turn Budget & Session Scope") before the demos run.

## Files / artifacts to consult

- `AGENTS.md` — read the "Releasing to Production" and "Testing" sections before any release-shaped work.
- `docs/DEMO_SCRIPT.md` and `docs/demo/uat-verification-runbook.md` — standing demo material.
- `.planning/issue-1103-stale-branches-changelog.md` — context for the mp-redesign branch sweep.
- `.handoffs/2026-10-19-close-1383-and-release-complete.md` — this session's release completion record.
