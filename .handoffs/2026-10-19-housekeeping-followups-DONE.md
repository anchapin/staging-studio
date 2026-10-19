# Housekeeping followups — DONE (2026-10-19)

Session: `2026-10-19-housekeeping-followups-push-and-stale-handoff` — read
the [`2026-10-19-housekeeping-followups-push-and-stale-handoff.md`](./2026-10-19-housekeeping-followups-push-and-stale-handoff.md)
working draft and executed its three tasks in order.

Branch: `main` (clean, 2 ahead of `origin/main`).
Last commit: `763cf0d` (Oct 19 housekeeping closeout — `chore(closeout): 2026-10-19 housekeeping`).

## Tasks resolved

### Task 1 — `next.config.ts` allowlist for the DashScope (Alibaba) inpaint migration (#1240)

**Verdict: no change required.** AGENTS.md "Toolchain quirks" pinpoints the
constraint: `next.config.ts` allowlists `*.supabase.co` and `*.fal.ai`, and
the inpaint surface (Alibaba DashScope) "generates images on DashScope's
OSS and uploads to Supabase Storage within the 24h URL validity window, so
the browser never requests DashScope URLs directly — no allowlist change
needed for the migration." Confirmed at `next.config.ts:42`:

```
remotePatterns: [
  // ... *.supabase.co (line 45), *.fal.ai (line 49)
```

Replicate (`*.replicate.com`) is reachable only through the
`replicate-integration-probe.mts` (`.ts`-via-tsx, CLI probe, #1200), which
runs server-side and never renders into a Next `<Image>` — same exemption
class as DashScope.

### Task 2 — push develop→main back-merge PR

**Verdict: already executed.** No code action needed; the state the
handoff predicted (`git status`: clean, `git log` shows the previous
closeout's two commits as the local tip) matches *after* the back-merge
has run. Confirming evidence:

- `git ls-remote origin` shows `origin/main` at `09a37e5` ("Merge pull
  request #1391 from anchapin/develop") and `origin/develop` at
  `d47bb5e` ("docs(handoffs): add 2026-10-19 f…").
- `git cat-file -p` shows both refs share tree `69c997da` — the merge
  was a no-op merge, content already equal.
- `gh pr list --state all --limit 3` confirms **PR #1391** ("Release:
  develop → main (5 commits, post-#1382 cleanup)") is **merged**.

The developer has therefore already completed the back-merge. **Do not
try to open PR #1392** — the local-only closeout commits
(`a6c32f1`, `6ca49dd`, `763cf0d`) on top of `main` are housekeeping
state, not new release content; pushing them onto `develop` would
back-pollute the working branch.

If `release-guard` ever reports a divergence later, follow the
Ritual: back-merge `main` into `develop` on a release branch, not on
`main` directly. AGENTS.md "Releasing to Production".

### Task 3 — consume `.agents/housekeeping-closeout-2026-10-19.md` (stale state note)

**Verdict: filesystem move, not a commit.** The 1.8 KB file was the
gitignored memo pointing at its tracked sibling
`.agents/handoffs/archive-2026-10-19/2026-10-19-housekeeping-closeout-cleanup-COMPLETE.md`
(per `763cf0d` commit body, "30 + 8 + 1 … the archive stays out of git
per the `.agents/` ignore at `.gitignore:54`"). Its visible existence
is exactly the "stale handoff" signal the user-passed handoff wants
consumed.

Resolution: `mv .agents/housekeeping-closeout-2026-10-19.md
.agents/handoffs/archive-2026-10-19/2026-10-19-housekeeping-closeout-state-note.md`.

Precedent: matches `763cf0d`'s own move of 15 other files into the
same archive. The directory now holds **16** files (15 + 1). The
next session's housekeeping loop will see them as a single coherent
"done" set.

## Decisions surfaced back

None of the three "stop-and-ask" triggers in the user-passed handoff
fired. Specifically:

- The `.env.example` default-only copy clarification in `763cf0d`
  was inline (the comment says "operator-tunable only via override")
  — no revert needed.
- The 30 archived handoffs contained no live pointers beyond the
  ones the original closeout already opened issues for.
- `main` branch protection did not reject any push — no push was
  attempted in this session because the back-merge PR was already
  merged.

## Tsconfig-flip check

No `next build` or `next dev` ran in this session. `git status`
shows zero committed-but-not-pushed diffs. The `post-closeout`
guard is therefore still in a clean state — no
`git checkout HEAD -- tsconfig.json` was needed before any
amendment or commit.

## Refs

- Working draft: [`.handoffs/2026-10-19-housekeeping-followups-push-and-stale-handoff.md`](./2026-10-19-housekeeping-followups-push-and-stale-handoff.md)
- Predecessor closeout: [`6ca49dd`](https://github.com/anchapin/staging-studio/commit/6ca49dd) ("docs(handoffs): add Oct 19/21 housekeeping working drafts")
- Already-merited release PR: [#1391](https://github.com/anchapin/staging-studio/pull/1391) (was the back-merge the user-passed handoff predicted PR #1392 would do)
- Predecessor handoff body: `.agents/handoffs/archive-2026-10-19/2026-10-19-housekeeping-closeout-cleanup-COMPLETE.md`
- Predecessor state note (now consumed): `.agents/handoffs/archive-2026-10-19/2026-10-19-housekeeping-closeout-state-note.md`
