# Session Handoff — 2026-10-18

> Copy/paste this entire file (minus the `# Session Handoff` header) into a fresh chat as the first message. The new agent will read it, then continue.

---

## Who you are

You are the solo maintainer of **StagingStudio** (`anchapin/staging-studio` on GitHub). It is a Next.js 16 / TypeScript / Prisma / Supabase / Tailwind v4 single-tenant app for **Circle G Designs**, an AI-assisted home-staging lookbook generator. Full project ground truth is in `/home/alex/Projects/staging-studio/AGENTS.md` — read it first; the rules there override anything in this handoff.

## Where things stand right now

**Working directory:** `/home/alex/Projects/staging-studio` (branch `develop`, HEAD `a42eaf6`).
**Origin/develop is 2 commits ahead of local develop.** Local is clean (no uncommitted changes, no untracked files). You should `git pull --ff-only` on arrival to sync.

**Last commit on develop:**
```
a42eaf6 [AI-assisted] fix(e2e): await ensureDockerPostgres + set process.env.DATABASE_URL (#1382)
f1c3555 [AI-assisted] fix(e2e): prevent Vitest node-options bleed into the dev brace (#1381) ...
#1380, #1364, #1382, plus several wave-2 merges from Oct 17
```

**Two open PRs / branches in flight on remotes:**
- `release/issue-1362c-develop-to-main` (worktree `/home/alex/Projects/staging-studio-feather-e2e`, HEAD `c247a20`) — FineTune e2e pin, ready to release to `main` once the `release-guard` job is green.
- `mp-redesign/issue-1344-e2e-unblock` (worktree `/home/alex/Projects/staging-studio-e2e-unblock`, HEAD `1d55203`) — e2e harness targeting the new `<EditRoomStudio>` surface; latest commit refreshes `.env.example` for the harness.

**Two other feature worktrees exist (older, may be stale):**
- `mp-redesign/issue-1343-copypanel-e2e` → `staging-studio-copypanel-e2e`
- `mp-redesign/issue-1343-listing-copy` → `staging-studio-listing-copy`

`git worktree list` to confirm on arrival. Don't touch a worktree you don't recognize — they are often the user's in-flight work.

**Open issues (only 2):**
- **#1380** — `fix(edit-room): state.viewing not synced from lookbookSlot on mount (flaky #1376 strip-spec)` — bug, **e2e flake** on the strip-spec. Labels: `bug, canvas, e2e`. **This is the single most important thing to fix in the next session.** Fix body says: "After [last refactor], the `lookbookSlot` prop is no longer synced into `state.viewing` on mount, so the strip-spec which relies on the initial `viewing` slot can flake." Pin a unit test in a new `tests/edit-room-*-viewing-init.test.ts`.
- **#1336** — `[mp-redesign] Edit Room UX redesign — parent epic` (Magic Patterns design `hVPYX2rJ2yawc1XTY2LTRJ`). Wave-3 frontend epic. Most child slices have already landed via the wave-2 merges (#1344, #1343, #1362 a/b/c). Only #1380 is currently open under it.

## Recommended next-session order of operations

1. **`git pull --ff-only`** to sync the 2 origin/develop commits.
2. **Fix #1380 first.** It is an active e2e flake and it is the only open bug. Read the issue body via `gh issue view 1380 --repo anchapin/staging-studio`. Likely locations: `src/components/canvas/` (the `inpaint-editor.tsx` / edit-room scope split that landed in #691/related issues). Add the pin test the issue body asks for (`tests/edit-room-*-viewing-init.test.ts`). Run `npm run lint && npm run typecheck && npx vitest run <new-test>` before committing.
3. **Then pick from this menu, in priority order:**
   - **(a) Ship #1362c release.** The `release/issue-1362c-develop-to-main` branch is at `c247a20` with the FineTune e2e pin merged in. Procedure from `AGENTS.md#Releasing to Production`: back-merge `main` → `develop`, push the release branch as a `develop`→`main` PR, wait for `Lint · Typecheck · Unit tests` + `release-guard` to be green, merge, verify the post-merge `E2E (Playwright)` job on `main`. Guard script: `npm run release:check`.
   - **(b) Land #1344 e2e unblock.** The `mp-redesign/issue-1344-e2e-unblock` worktree has a 5-commit stack ending at `1d55203`. Push it, open PR, let CI run.
   - **(c) Triage the stale worktrees.** `.planning/issue-1103-stale-branches-changelog.md` records how the 2026-09-28 sweep tagged-and-archived 14 stale branches. Re-run the sweep; `git worktree list` shows 5 worktrees now (down from 13) — any orphaned ones should be cleaned and archived the same way (tag branch tip → delete branch → leave a note in `.planning/`).
   - **(d) Drain the post-demo backlog** (`docs/post-demo-backlog.md`, last edited 2026-10-17). Tier 3 candidates — don't build speculatively, but it's worth re-scanning for any Tier 1/2 items that have matured.
   - **(e) New issues from `gap-issues`** if the user explicitly wants more queued tickets.

## Ground rules that must not be violated

These are repeated from `AGENTS.md` because the cost of forgetting them is high. The new agent MUST re-read `AGENTS.md` on arrival; this is just the highest-leverage subset:

- **All agent runtime dirs are gitignored: `.agents/`, `.opencode/`, `.planning/worktrees/`. Never commit them.**
- **Prefix commit subjects with `[AI-assisted]` and attribute the tool.**
- **Always run `bash scripts/check-tsconfig-flip.sh` (or just don't commit a `tsconfig.json` flip — Next 16.3.5 rewrites it on every build/dev).** The pre-commit hook `.githooks/pre-commit` runs this automatically; if you see `hint: ... hook was ignored because it's not set as executable`, re-run `bash scripts/enable-hooks.sh`.
- **Prisma uses `db push`, not migrations.** `DATABASE_URL` lives in `.env.local`, with a `.env → .env.local` symlink required for `prisma` CLI to find it.
- **Node 24.x LTS.** `.nvmrc`, `Dockerfile`, and `ci.yml` all pin `node:24-slim` / `node-version: '24'`. Don't run `npm` on Node 22 or 26 without updating all three plus `package.json#engines.node` together.
- **`npm audit` reports 9 high-severity `braces` advisories — that's the documented `#1220` state, kept clean by `package.json#overrides.braces = "npm:@dieub/braces-depth-guard@3.0.3-pn.3"`.** Do NOT run `npm audit fix --force` — it would unwind `#1183`'s `next/og` RCE patch.
- **Two mocking strategies in e2e tests, and the difference matters.** `page.route` only intercepts browser-context traffic, NOT server-side outbound fetches. The PDF export routes (`/api/export-pdf`, `/api/v1/export-pdf`) reach the Browserless provider from the **Next.js server process**, so their e2e specs use the env-gated `E2E_BROWSERLESS_PDF_URL` override instead. `playwright.config.ts` pins `workers: 1`.
- **`PREVIEW_TOKEN_SECRET` and the preview token system use Web Crypto (`crypto.subtle`), not `node:crypto`.** Required because middleware runs on Edge.
- **Every mutation endpoint (server action + API route) MUST enforce session + ownership.** Audit any new one against `src/lib/api-auth.ts`.
- **Every server action that mutates a lookbook-rendered field MUST call `revalidatePath('/preview/${projectId}')` alongside its dashboard path.** `/preview/[id]` also has `export const dynamic = "force-dynamic"`. Pinned by `tests/revalidate-preview.test.ts`.
- **Toolchain:** Tailwind v4 is CSS-first (`@import "tailwindcss"` in `globals.css`); shadcn `base-nova` style; oxlint (not eslint). `next.config.ts` allowlists images only for `*.supabase.co` and `*.fal.ai` — the inpaint surface (Alibaba DashScope) doesn't need an entry because the browser never requests DashScope URLs directly.
- **The `rtk ` prefix is injected by a global plugin — don't add it yourself, don't "fix" it, don't treat rewritten commands as bugs in the repo.** Preview any rewrite with `rtk rewrite '<cmd>'`; bypass with `rtk proxy <cmd>` for raw output.
- **`braces`/`micromatch`/`fast-glob` are dev-only transitive — never imported in `src/`, `middleware.ts`, or any route/action.**

## Cheap reads on arrival (do these first, before any work)

1. `/home/alex/Projects/staging-studio/AGENTS.md` — ground truth (~7KB, well-organized).
2. `gh issue view 1380 --repo anchapin/staging-studio` — the bug you are about to fix.
4. `gh pr list --repo anchapin/staging-studio --state open` — current PR queue.
3. `git worktree list` and `git status` — confirm the worktree map and clean state.
4. `git log --oneline -20` — recent context.
5. `docs/post-demo-backlog.md` head — backlog Tier 1/2 candidates.

## Useful one-liners

```bash
# Health
git -C /home/alex/Projects/staging-studio status && git -C /home/alex/Projects/staging-studio log --oneline -10
git worktree list

# Open work
gh issue list --repo anchapin/staging-studio --state open --limit 50
gh pr list --repo anchapin/staging-studio --state open

# Release guard (default: origin/main vs origin/develop)
npm run release:check

# Local verification (run after each meaningful change)
npm run lint && npm run typecheck && npx vitest run
# Single e2e spec (needs Docker + `npx playwright install chromium`)
npx playwright test tests/e2e/specs/<name>.spec.ts

# Stale-worktree sweep (same procedure as #1103)
git worktree list
git branch --list --remotes
```

## What to do if the user says "continue where you left off"

Default to **Fix #1380 first**. If the user names a different issue, switch to that. If they say "release", follow the release procedure in `AGENTS.md#Releasing to Production` against `release/issue-1362c-develop-to-main`.

## What NOT to do without asking

- Do not start a new feature without a corresponding GitHub issue.
- Do not delete a worktree you don't recognize — check with the user.
- Do not run `npm audit fix --force`, `prisma migrate`, or any Prisma migration commands (this project uses `db push`).
- Do not flip `tsconfig.json#compilerOptions.jsx` back to `"preserve"`; Next manages it and the pre-commit hook blocks the commit if you forget to revert.
- Do not add `eslint` config — oxlint replaced it (#1276); the old flat-config chain is intentionally gone.
- Do not run `vercel env pull` without an explicit non-`.env.local` path (the CLI silently overwrites the real env file — lost 4 credentials in #1100).

---

## Quick orientation summary (TL;DR for the rushed reader)

- App: Next 16 + TS + Prisma + Supabase + Tailwind v4. Single tenant, Circle G Designs. Two-step flow: dashboard → edit-room → lookbook → PDF.
- Branch: `develop` (HEAD `a42eaf6`). 2 origin/develop commits to pull.
- One open bug: **#1380**. One open epic: #1336 (most slices landed).
- Two in-flight PRs on worktrees: `release/issue-1362c-develop-to-main` (ready to ship), `mp-redesign/issue-1344-e2e-unblock`.
- Ground rules: AGENTS.md is law. Don't commit `.agents/`, `.opencode/`, `.planning/worktrees/`. Always `[AI-assisted]` + tool attribution. Don't `npm audit fix --force`. Don't `tsconfig.json#jsx` flip. Don't `prisma migrate`. Don't `vercel env pull .env.local`.
- Next: fix #1380, then ship the release, then land #1344.

Good luck. Re-read `AGENTS.md` on arrival.