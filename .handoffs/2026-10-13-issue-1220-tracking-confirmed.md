# Session Handoff — 2026-10-13 (tracking: #1220 confirmed, AGENTS.md linked)

**Branch:** `fix/issue-1220-braces-cve-tracking` (forked from `develop`).
**Issue:** [#1220](https://github.com/anchapin/staging-studio/issues/1220) —
"Track GHSA-vfj7-8cjw-p6xm (braces stack-overflow DoS) — no upstream patch
available; do not run npm audit fix --force".
**Type:** documentation-only tracking issue (no source / `package.json` /
lockfile changes). The override resolution had already landed in a prior
session; this handoff exists to confirm that state and link the in-tree
advisory note in `AGENTS.md` to #1220 so future readers find the issue.

## TL;DR

- `package.json#overrides.braces` is in place and correctly aliased to the
  depth-guarded fork: `"braces": "npm:@dieub/braces-depth-guard@3.0.3-pn.3"`.
- `package-lock.json` resolves `node_modules/braces` → `@dieub/braces-depth-guard@3.0.3-pn.3`
  (verified by inspection; not by `npm ls`, since `node_modules/` is not
  installed in the wave-sprint worktree).
- All three prior investigation handoffs are committed at
  `.handoffs/2026-10-07-braces-cve-{dev-only,tracking-issue-and-dirty-tree,repair-complete}.md`.
- `AGENTS.md` "Security advisories" → `braces` entry now references #1220,
  restates the "do not run `npm audit fix --force`" prohibition, and lists
  the issue's resolution criteria as a revisit trigger.
- No source code touched. No `package.json` / `package-lock.json` touched.
  No CI-affecting change.

## Why this is doc-only

Issue #1220's "Resolution criteria" section spells out four conditions under
which the issue should be revisited (patched `braces` ships, or a transitive
chain swaps `fast-glob` for a `braces`-free globber, or `npm audit` reports
fewer than 9 advisories with `npm ls braces` resolving to `>3.0.3`). None of
those conditions are true today: the upstream `braces` maintainer has refused
to patch (per `micromatch/braces#70`), the depth-guarded fork
(`@dieub/braces-depth-guard`) is the working resolution, and removing the
override would force `npm audit fix --force` — which would re-open #1183's
CRITICAL `next/og` RCE patch by downgrading `next` back to `^16.3.5`. So the
correct posture is **track and accept**, which is what the issue body
recommends.

The override was applied in an earlier wave (see the chain in the issue's
"Source" section: commits `3d9e671`, `10d46c2`, `7488b0c` on 2026-10-07).
This session did NOT undo it, modify it, or reapply it. This session added
the cross-link from `AGENTS.md` → #1220 so the in-tree advisory note and the
GitHub issue don't drift.

## Change inventory

| file | change | rationale |
|------|--------|-----------|
| `AGENTS.md` | rewrote the `braces` Security-advisories bullet | add #1220 reference, restate the #1183-restore warning, list the four revisit criteria, link the three prior handoffs |
| `.handoffs/2026-10-13-issue-1220-tracking-confirmed.md` | **new** | this handoff |

No other files modified. `git diff --stat` against `origin/develop`:

```
 AGENTS.md                                            |  2 +-
 .handoffs/2026-10-13-issue-1220-tracking-confirmed.md | 51 ++++++++++++
 2 files changed, 52 insertions(+), 1 deletion(-)
```

## Verification (post-edit)

- `grep -n '"braces"' package.json` → matches the override key.
- `grep '"node_modules/braces"' package-lock.json` → the package entry
  shows `"name": "@dieub/braces-depth-guard"`, `"version": "3.0.3-pn.3"`,
  resolved from the public npm registry. No `braces@3.0.3` row remains.
- `grep -n '1220\|GHSA-vfj7' AGENTS.md` → matches inside the rewritten
  Security-advisories bullet.
- `git status --short` → only the two intended changes show.
- `git diff tsconfig.json` → empty (no Next.js `jsx: preserve` → `react-jsx`
  flip; the pre-commit guard would have caught one had it slipped in, but it
  did not).
- `bash scripts/check-tsconfig-flip.sh` → exits 0 (no flip to guard).
- `npx tsc --noEmit` (`npm run typecheck`) → not run; no TS files touched.
- `npm run lint` → not run; no lint-target files touched (AGENTS.md and
  `.handoffs/*.md` are not in the lint scope).

## What "revisit" looks like

When the issue is revisited, the only meaningful checks are:

```bash
npm view braces dist-tags        # is a patched 3.x or 4.x available?
npm ls braces                    # does our override still resolve?
npm audit                        # does it stay at 0 vulnerabilities?
```

If the first command shows a patch AND the second resolves to it AND the
third stays clean → drop the override (`npm uninstall @dieub/braces-depth-guard`
+ remove the `overrides.braces` row + commit the regenerated `package-lock.json`),
update this handoff with the resolution date, and close #1220.

If the first command shows no patch AND a transitive chain (`shadcn`,
`@shadcn/registry`, `ts-morph`, `@ts-morph/common`, `eslint-config-next`,
`@next/eslint-plugin-next`) has swapped `fast-glob` for a `braces`-free
globber → that swap independently closes the corresponding `npm audit` rows
for that branch; verify with `npm audit --json | jq '.vulnerabilities | keys'`
and confirm the count has dropped.

If neither has changed → leave the override in place, leave the bullet as is,
re-confirm at the next quarterly dependency review.

## Scope guard

This handoff touches only `AGENTS.md` and a new `.handoffs/*.md` file.

- **#1219** (Circle G LoRA spike) is owned by a parallel wave-sprint branch
  (`fix/issue-1219-circle-g-lora`); this session did NOT touch any LoRA
  artifacts, training data, or model-evaluation files.
- **#1214** (per-room aesthetic overrides) is owned by a parallel
  wave-sprint branch (`fix/issue-1214-per-room-aesthetic`); this session did
  NOT touch any per-room aesthetic selection logic, schema, or migration.

## Related

- Issue: https://github.com/anchapin/staging-studio/issues/1220
- GHSA: https://github.com/advisories/GHSA-vfj7-8cjw-p6xm
- Prior handoffs: `.handoffs/2026-10-07-braces-cve-{dev-only,tracking-issue-and-dirty-tree,repair-complete}.md`
- #1183 — the CRITICAL `next/og` RCE patch that this CVE's "wrong fix" would unwind
- #1184 — the eslint 9 → 10 migration that may incidentally close the `eslint-config-next` branch
