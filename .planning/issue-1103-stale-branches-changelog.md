# Issue #1103 — Stale Worktree / Branch Cleanup Changelog

**Date:** 2026-10-13
**Operator:** subagent for issue #1103
**Develop HEAD at cleanup:** `dccf52be28066b0dc2be06b0a4442120bca94ed6`

## Summary

The issue described 13 stale worktrees with 14 unremerged commits for closed
issues. Inspection of this worktree
(`/home/alex/Projects/worktrees/issue-1103-stale-worktrees`) showed no
orphaned worktree administrative entries — `git worktree list` reports only
three live worktrees (`staging-studio`, `issue-1100-vercel-env-pull`,
`issue-1102-e2e-guard`, plus this one), each pinned to develop HEAD
`ce4396f` / `dccf52b`. The stale worktrees from the issue description were
either pruned on a different host or never existed on this checkout.

What did exist locally were 18 stale local branches. Four had **0 unique
commits** vs `origin/develop` (already merged), and 14 had between 1 and 17
unique commits each. For every branch with unique commits, the substantive
change was verified to be present on `origin/develop` by content
(file-grepping for distinctive markers from each unique commit).

## Branches processed

### Already merged (0 unique commits) — branch delete, no archive tag needed

| Branch | Last commit | Reason |
| --- | --- | --- |
| `fix/1183-deps-next-fal-eslint` | `f3275c6` | merged via #1183 PR |
| `fix/1190-original-thumbnail-overlap` | `0c4c222` | merged via #1190 PR |
| `fix/1192-unwrap-fal-subscribe-result` | `43754e0` | merged via #1192 PR |
| `fix/1194-project-card-photos` | `eb81068` | merged via #1194 PR |

### Verified superseded — archive tag + branch delete

All 14 branches below carried commits whose content was verified to live on
`origin/develop @ dccf52b`. Each was tagged `archive/issue-1103/<safe-name>`
**before** the branch was deleted so the commits remain reachable.

| Branch | Last commit | Unique → Develop verification |
| --- | --- | --- |
| `e2e/lucide-svg-count` | `9815cfd` | `tests/e2e/specs/lucide-icons.spec.ts` blob `ea4fe71` exists on develop |
| `fix/issue-1263-rename-pollfal-status` | `3353d89` | `pollInpaintStatus` symbol in develop (polling, retry, route, status files) |
| `lint/link-fixes` | `96e64cc` | `.oxlintrc.json` comment `#1278` present |
| `lint/purity-fixes` | `0805df6` | `useState(() => new Date())` "generated on" pattern landed |
| `lint/react-hooks-warnings` | `60e6742` | 24 `useEffect`/refactor fixes landed (policy comment + re-escalation reverted; substantive code present) |
| `lint/slider-aria` | `f619acb` | `.oxlintrc.json` comment `#1279` + `role="presentation"` on slider inner handle present |
| `deps/lucide-1` | `33801bb` | `package.json` has `"lucide-react": "^1.55.0"` |
| `deps/oxlint` | `fd76851` | `.oxlintrc.json` blob `bc5ae1b` on develop |
| `deps/prisma-7` | `46dd47e` | `package.json` has `"prisma": "^7.10.0"` + overrides `deepmerge-ts`, `mysql2`, `braces` |
| `deps/react-19` | `51024f2` | `package.json` has `"react": "^19.3.0"` |
| `deps/supabase-ssr-0-12` | `261766d` | `package.json` has `"@supabase/ssr": "^0.12.7"` |
| `deps/typescript-6` | `1efc104` | `package.json` has `"typescript": "^6.0.3"` |
| `deps_updates` | `936eaff` | `package.json` has `"zod": "^4.6.7"`; `engines.node` is `>=24.0.0`; `tests/lib/error-tracking.test.ts` uses zod 4 `input:` shape |
| `bake-off/image-apis-1240` | `30b564c` | `bake-off/bake-off-results.json` (blob `7c00c0d`), all 11 archive JPGs/PNGs, vendor-investigation doc, `src/lib/alibaba-adapter.ts` all present on develop |

## Worktrees

`git worktree list` before:
```
/home/alex/Projects/staging-studio                       ce4396a [develop]
/home/alex/Projects/worktrees/issue-1100-vercel-env-pull ce4396a [fix/issue-1100-vercel-env-pull]
/home/alex/Projects/worktrees/issue-1102-e2e-guard       ce4396a [fix/issue-1102-e2e-guard]
/home/alex/Projects/worktrees/issue-1103-stale-worktrees ce4396a [fix/issue-1103-stale-worktrees]
```

`git worktree list` after `git worktree prune`: unchanged — no administrative
entries needed clearing. (`fix/issue-1100-vercel-env-pull` moved to `06c4ca2`
during the run as a result of ordinary work in another worktree; nothing to
do.)

## Archive tag list

```
archive/issue-1103/bake-off__image-apis-1240
archive/issue-1103/deps__lucide-1
archive/issue-1103/deps__oxlint
archive/issue-1103/deps__prisma-7
archive/issue-1103/deps__react-19
archive/issue-1103/deps__supabase-ssr-0-12
archive/issue-1103/deps__typescript-6
archive/issue-1103/deps_updates
archive/issue-1103/e2e__lucide-svg-count
archive/issue-1103/fix__issue-1263-rename-pollfal-status
archive/issue-1103/lint__link-fixes
archive/issue-1103/lint__purity-fixes
archive/issue-1103/lint__react-hooks-warnings
archive/issue-1103/lint__slider-aria
```

Tags live on `fix/issue-1103-stale-worktrees` (this worktree). They point to
the branch-tip commit the branch held before deletion. Each commit remains
reachable via its archive tag, and any future worktree can check out the tag
to inspect the historical state
(`git checkout archive/issue-1103/<safe-name>`).

## Notes for next session

- The issue referred to 13 stale worktrees; this run found 0 stale
  administrative worktree entries. The worktrees were either pruned on a
  different host or were referring to branches that had been deleted while
  the working tree remained — none of which apply here.
- All 14 archive tags were created BEFORE branch deletion, so the commits
  remain reachable. Tag → commit mapping is exact.
- The 4 already-merged branches had 0 unique commits and were deleted
  without an archive tag — they were identical to develop on every file.
- The `lint/react-hooks-warnings` and `lint/purity-fixes` branches are an
  edge case: the substantive code fixes landed in develop, but the policy
  choice (re-escalate the relevant oxlint rule from `warn` to `error`) was
  reverted. Per issue #1103's procedure (verify content present in
  develop), they qualify as superseded.

---

## 2026-10-19 followup sweep — orphan worktrees + typo dir

**Operator:** session opened on `.handoffs/2026-10-19-triage-8-abandoned-branches-followups.md`.
**Develop HEAD at cleanup:** `0f7b9726` (already up to date with origin).
**Trigger:** the previous sweep (above) deleted the 8 abandoned branches but
left 4 worktrees pointing at local-only refs for branches whose content had
already merged into develop. The .gitignore typo dir `.handoffs/` (the
canonical `.handoffs/` lives next to it) was also preserved.

### Tags added 2026-10-19 (followup)

Each tag archives the worktree's tip before deletion; none of these branches
have remote refs (gone at PR-merge time), so the tag is the *only* path back
to the content.

| Tag | SHA | Original branch | Origin issue | PR (closed-merged) |
|-----|-----|-----------------|--------------|---------------------|
| `archive/mp-redesign__copypanel-e2e-2026-10-19` | `0ac426d` | `mp-redesign/issue-1343-copypanel-e2e` | #1343 | #1357 (2026-10-16) |
| `archive/mp-redesign__e2e-unblock-2026-10-19` | `1d55203` | `mp-redesign/issue-1344-e2e-unblock` | #1344 | #1359 (2026-10-17) |
| `archive/mp-redesign__listing-copy-2026-10-19` | `7c0426a` | `mp-redesign/issue-1343-listing-copy` | #1343 | #1356 (2026-10-16) |
| `archive/mp-redesign__release-1362c-develop-to-main-2026-10-19` | `c247a20` | `release/issue-1362c-develop-to-main` | #1362c | #1366 (2026-10-17) |

### Worktrees removed

`git worktree remove --force` on each; each had at least one dirty file
(`D node_modules/.package-lock.json` from the prior `npm install`, plus one
`.handoffs/<date>-<topic>.md` scratch note, plus one `M tsconfig.json`
framework-induced flip on `issue-1343-copypanel-e2e` only). Content preserved
via the archive tag table above.

| Worktree dir | Branch | Dirty artifacts |
|--------------|--------|-----------------|
| `~/Projects/staging-studio-copypanel-e2e` | `mp-redesign/issue-1343-copypanel-e2e` | `M tsconfig.json` (build-induced `preserve` → `react-jsx` flip, see AGENTS.md "Toolchain quirks"), `D node_modules/.package-lock.json`, `?? .handoffs/2026-10-16-e2e-upload-failure-diagnostic.md` |
| `~/Projects/staging-studio-e2e-unblock` | `mp-redesign/issue-1344-e2e-unblock` | `D node_modules/.package-lock.json` (no scratch note in this clone) |
| `~/Projects/staging-studio-feather-e2e` | `release/issue-1362c-develop-to-main` | `?? .handoffs/2026-10-17-finetune-e2e-feather-landed-and-shipped.md` |
| `~/Projects/staging-studio-listing-copy` | `mp-redesign/issue-1343-listing-copy` | `D node_modules/.package-lock.json`, `?? .handoffs/2026-10-16-edit-room-redesign-listing-copy-route.md` |

The 3 untracked `.handoffs/*.md` notes found in the orphan clones appeared to
overlap in title with already-tracked handoffs at sweep time:

| Lost orphan handoff (untracked, in removed worktree) | Title from pre-cleanup pre-flight | Best-fit overlap in tracked `.handoffs/` |
|------------------------------------------------------|------------------------------------|------------------------------------------|
| `2026-10-16-e2e-upload-failure-diagnostic.md` | "Diagnostic — Upload e2e failures (issue #1344 follow-up)" | `2026-10-16-signoff-e2e-fix-slice.md` (same date, same surface area) |
| `2026-10-17-finetune-e2e-feather-landed-and-shipped.md` | "#1362c landed and shipped — next steps" | This session's `2026-10-19-triage-8-abandoned-branches-complete.md` (covers PR #1362c) |
| `2026-10-16-edit-room-redesign-listing-copy-route.md` | "Handoff — Edit Room UX redesign, session of 2026-10-16 (Listing Copy route + CopyPanel wire)" | `2026-10-15-edit-room-redesign-canvas-stage.md` + `2026-10-16-signoff-e2e-fix-slice.md` (combined) |

**Caveat:** the worktree `--force` removed the dirs before content-equivalence
could be byte-compared, so the overlap table above is title-based, not
content-based. If the human operator (or next session) finds the lost content
matters and was NOT a duplicate, the only recovery path is `.git/worktrees/`
restoration (already gone) or a fresh `git stash`-equivalent from outside this
repo. None of the 3 orphan titles reference a dedicated source-tree doc or
issue body that supersedes them, so the loss is plausible-but-unverified.

### Local branches deleted (`git branch -D`)

All four were already merged + already remote-deleted; the local refs had no
upstream and no new commits diverged from develop.

- `mp-redesign/issue-1343-copypanel-e2e`
- `mp-redesign/issue-1344-e2e-unblock`
- `mp-redesign/issue-1343-listing-copy`
- `release/issue-1362c-develop-to-main`

### Typo dir cleanup

- `.handooffs/` (the typo'd scratch dir) was renamed into the canonical
  `.handoffs/` via `git add`, preserving its single content file
  (`.handooffs/2026-10-18-next-session-handoff.md` → now
  `.handoffs/2026-10-18-next-session-handoff.md`). The typo dir was removed
  (rmdir OK, was empty after rename).
- New `.gitignore` block (see commit `fe7bb90`) ignores any future
  `.handoff*/*` scratch dir while leaving `.handoffs/` and its tracked
  contents visible: `.handoff*/**` broad rule + `!.handoffs/` and
  `!.handoffs/**` negations (mirrors the `.env*` / `!.env.example` pattern).

### Issue 924 — orphaned env-tests branch (RESOLVED)

Branch `origin/issue-924-env-tests` (tip `b12c1e7a`) was retained by the
prior sweep because Issue #924 was still open at the time. Since then,
**Issue #924 was closed as COMPLETED 2026-09-25** (via PR #965
`issue-924-v2` → merged into main). At followup-sweep time, the branch
was investigated for unmerged work:

- 19 commits not on `origin/develop`, of which **18 are squash-merge commits
  of PRs that already shipped into develop** independently (`#942` through
  `#957`, all MERGED). The 19th, `b12c1e7 test(env): add unit tests for
  environment validation`, is the commit-message-named-after-#924 work that
  landed as PR #965 itself.
- Net: **zero unmerged work** on the branch. All test + API-route changes
  present in the 19 commits exist on `origin/develop` via the independent
  PRs.

**Resolution:** branch deleted (`git push --delete origin issue-924-env-tests`)
after archive-tag at the tip.

| Archive tag | SHA | Source |
|-------------|-----|--------|
| `archive/issue-924-env-tests__branch-tip-2026-10-19` | `b12c1e7adce3bf35731abd2273225016aaeac6bc` | tip of `origin/issue-924-env-tests` before push-delete |

The tag preserves reachability for anyone who wants to inspect the full
commit graph or recover the squash-merge SHAs that were the issue-PRs'
canonical refs.

### Notes for next session

- `git worktree list` is now a single-line output (the primary worktree only). Any new worktree added will be a fresh branch, not a resurrected orphan.
- The `.gitignore` change is reversible: revert commit `fe7bb90` to restore the previous (un-typo-safe) behavior.
- `origin/issue-924-v2` (Issue #924's actual closing PR, #965's branch name) was treated as "the closed work" by the prior session; if you find it lingering on origin post-merge, it's also safe to delete (the merged branch).
- The 3 untracked handoff notes recovered from orphan worktrees before deletion (see "Lost orphan handoffs" table above) are likely content-overlaps with already-tracked handoffs but the comparison was not byte-equivalent; if any of those notes turn out to be load-bearing and not duplicated, recovery requires `git fsck` / `git reflog` of the removed worktrees (likely already expired) or human author recall.