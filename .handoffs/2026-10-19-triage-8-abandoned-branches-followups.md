# Handoff — Follow-ups from the 2026-10-19 8-Branch Triage

You are a fresh AI agent picking up work after `.handoffs/2026-10-19-triage-8-abandoned-branches-complete.md`.
The previous session ran the prompt at `.handoffs/2026-10-19-triage-8-abandoned-branches.md` (now deleted), deleted 7 of 8 abandoned branches, and kept only `issue-924-env-tests`. The completion handoff above is the audit trail — read it first for context (2 minutes).

Your scope is **only the 5 follow-up items below**, in the order listed. Do not start other improvements.

## Pre-flight (single batch — verify state before acting)

Run this `ctx_batch_execute` up front; it confirms your starting assumptions in one round trip:

```bash
# 8 short commands, parallel:
echo '=== 1. workspace state ===' && git status --porcelain && git branch --show-current && echo '---'
echo '=== 2. 924 branch survives? ===' && git ls-remote --heads origin issue-924-env-tests
echo '=== 3. 1091 salvageable in reflog? ===' && git reflog --all --date=short | grep -i '1091\|variant-assert' | head -10
echo '=== 4. 924 PR exists? ===' && gh pr list --state all --json number,title,headRefName,state,url | jq -c '.[] | select(.headRefName=="issue-924-env-tests")'
echo '=== 5. issue 924 state ===' && gh issue view 924 --json number,title,state,url
echo '=== 6. .gitignore current contents ===' && cat .gitignore | head -50
echo '=== 7. typo handoff ===' && ls -la .handooffs/ 2>&1 | head -10 && head -20 .handooffs/2026-10-18-next-session-handoff.md 2>&1
echo '=== 8. active worktrees ===' && git worktree list --porcelain | grep -E 'worktree|branch HEAD'
```

Decide your path based on this output. **If step 2 returns empty (`origin/issue-924-env-tests` is gone), STOP — open the user, the branch was deleted and the task pivots.**

## Tasks (do these in order)

### Task 1 — Decision: `issue-924-env-tests` (the one surviving branch)

`issue-924-env-tests` was kept because issue #924 is still open. 4 env-test commits, no PR (old #1015 was closed-not-merged). Pick ONE:

- **Option A (recommended): open a fresh PR** — push the branch, open `develop` ← `issue-924-env-tests`. PR will go through CI + the normal review flow.
- **Option B: cherry-pick** the 4 commits onto the current release work if env tests are needed soon.
- **Option C: close out** — comment on #924 saying "env tests no longer needed; closing; delete branch", then `git push origin --delete issue-924-env-tests`.

**If Option A or B, you will leave branch and PR in place.** Write a one-line completion note in this handoff describing which option you took.

### Task 2 — `.handoffs/` cleanup (typo directory)

`.handooffs/` (note: extra 'o') exists, created 2026-10-18, contains a previous-session handoff unrelated to this work. Confirm the user wants it deleted before running `rm -rf`:

```bash
rm -rf /home/alex/Projects/staging-studio/.handooffs
```

If unsure (file may be intentional), ASK FIRST — single `question` call with options "delete", "leave for review", "show full contents first".

### Task 3 — `.gitignore` agent-runtime dirs

The standing rule from `~/.config/opencode/rules/05-git-and-worktrees.md` ("Never commit gitignored agent runtime dirs: `.agents/`, `.opencode/`, `.planning/worktrees/`") only works if those dirs are actually in `.gitignore`. Currently they're not (otherwise `git status` wouldn't show `.handoffs/` as `??`). Add to `.gitignore`:

```gitignore
# agent runtime dirs (per ~/.config/opencode/rules/05-git-and-worktrees.md)
.handoffs/
.handooffs/
.agents/
.opencode/
.planning/
```

**Verify before editing** — `.agents/` may already be tracked or intentionally NOT ignored. Run `git check-ignore -v .agents .opencode .planning 2>&1` to see what current rules say. Only add what is currently NOT ignored. Also confirm `!.env.example` and any other negation rules stay valid (re-read `.gitignore` end-to-end first per `~/.config/opencode/rules/04-bash-tooling.md`'s "after any shell edit, re-check `.gitignore`" principle).

> **Important Next.js quirk from AGENTS.md §"Toolchain quirks"**: `next.config.ts`'s git-flip on `tsconfig.json` will leave the tree dirty after any `npm run build`/`dev`. After this edit, do NOT run build/dev in this session unless needed for verification.

### Task 4 — Decide on the orphaned `#1091` assertion fix

`fix/1091-mask-paint-variant-assertion`'s single-commit `variantIndex` assertion fix was deleted from origin. It's now only retrievable from:
- Local reflog of any machine that interacted with it (see step 3 of pre-flight).
- Any local clone that pulled it before this session's triage.

If reflog shows the SHA, you can recreate:

```bash
git checkout -b recovery/1091-assertion <sha-from-reflog>
# inspect: git show HEAD, run the relevant test
```

If reflog is empty everywhere, the fix is gone. **Decision tree:**

- If issue #1091 ever re-flakes in production, search `.agents/` or your machine's reflogs for the SHA.
- Otherwise: mark as lost. Write one sentence in this handoff confirming the fix is unrecoverable OR pointing to the recoverable SHA.

### Task 5 — Write completion summary

After Tasks 1–4 are done, write a short completion note to `.handoffs/2026-10-19-triage-followups-complete.md` (under 25 lines) recording:
1. Which option was chosen for Task 1 (924 branch).
2. Whether `.handooffs/` was deleted (Task 2).
3. Exact `.gitignore` lines added (Task 3) and the diff snippet.
4. Task 4 verdict (fix recovered or lost; SHA if recovered).

Delete this handoff file (`.handoffs/2026-10-19-triage-8-abandoned-branches-followups.md`) only AFTER Task 5's completion note is committed.

## Hard rules (re-read every session)

- **Re-read this handoff before every batch.** Don't rely on session memory of the contents.
- **Tokens: prefer `ctx_batch_execute`** with descriptive labels for 3+ related commands; **prefer `ctx_search`** over `read`/`grep` for files already indexed; **use `rtk ` prefix** on raw shell per `~/.config/opencode/rules/04-bash-tooling.md`.
- **Never delete branches, directories, or push to `origin` without explicit user confirmation**, except where the user has already pre-approved this handoff (Tasks 1C, 2, 3, 5 — those are pre-approved scope). Task 4 is read-only / recreation only.
- **Never commit generated files** (Next.js flips `tsconfig.json` after build/dev — `git checkout HEAD -- tsconfig.json` before any commit per AGENTS.md §"Toolchain quirks").
- **Max 40 turns** for this session. If you hit 30, write what you've done and STOP — write a partial-completion note and terminate. Do not spawn sub-agents without the user explicitly asking; you are expected to do this work yourself in a single agent.
- **Poll CI ban**: never `sleep` loops around `gh pr checks`; never `gh run view --log`. Use `gh pr checks <PR> --watch` or `ci-wait <PR>` blocking (`~/.config/opencode/rules/04-bash-tooling.md` § "Polling is banned").
- **Server-side actions all live under `src/`** — never edit anything outside `src/` or `middleware.ts` without checking with the user first. `.gitignore` is the one allowed exception here (Task 3).

## Termination criteria (all required)

- Task 1 outcome recorded.
- Task 2 verdict recorded (deletion confirmed OR user-chose-not-to).
- Task 3 `.gitignore` line(s) added AND `git diff .gitignore` shows ONLY the intended lines (no Next.js tsconfig flip, no other noise). `git status` is clean except for the completion note.
- Task 4 verdict recorded.
- `.handoffs/2026-10-19-triage-followups-complete.md` written and committed (or staged + .gitignored).
- This handoff file (`.handoffs/2026-10-19-triage-8-abandoned-branches-followups.md`) deleted.
- The user's outstanding question (if any) is answered.
