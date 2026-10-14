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