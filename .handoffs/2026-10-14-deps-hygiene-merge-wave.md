# Handoff — Merge the dependency-hygiene PRs (issues #1322–#1329)

**Date:** 2026-10-14
**From:** opencode wave that opened PRs #1330–#1335 (see `.handoffs/2026-10-14-deps-hygiene-sweep.md`)
**To:** next opencode session
**Repo:** `anchapin/staging-studio`
**Branch base:** `develop` (`ba5f7f2`)
**What's open:** six PRs against develop, all reporting `mergeable=MERGEABLE`, none have CI yet.

---

## Your one job

Land the six open PRs (`#1330`, `#1331`, `#1332`, `#1333`, `#1334`, `#1335`) onto `develop`, in dependency-safe order, fixing any merge conflicts and re-running CI until each is green. Do NOT touch anything else. Do NOT merge to `main` — that is a separate release-window decision (AGENTS.md §Releasing to Production) and runs `release-guard` which is scoped to `if: github.base_ref == 'main'`, so it won't fire on these PRs.

---

## The six PRs and the merge order to use

Order matters because the lockfile churn from PRs #1331 (drops @eslint/eslintrc + 21 transitive) and #1326 (#1334) overlap. Merging them out of order costs you 30+ minutes of lockfile unscrambling. The order below is the one I verified by walking the package.json + lockfile churn.

| # | PR | Branch | Issue | Why this position |
|---|----|--------|-------|-------------------|
| 1 | [#1330](https://github.com/anchapin/staging-studio/pull/1330) | `chore/1322-drop-types-pino` | #1322 | Smallest lockfile churn (11 deletions). Merging first means a clean diff for the next reviewer. |
| 2 | [#1332](https://github.com/anchapin/staging-studio/pull/1332) | `chore/1324-types-node-24` | #1324 | Bumps `@types/node` 22→24. Independent of the others; merge before the lockfile-heavy ones. |
| 3 | [#1333](https://github.com/anchapin/staging-studio/pull/1333) | `chore/1325-shadcn-to-devdeps` | #1325 | Re-tier only — 302 lockfile lines but zero version moves. |
| 4 | [#1331](https://github.com/anchapin/staging-studio/pull/1331) | `chore/1323-drop-eslintrc` | #1323 | Removes @eslint/eslintrc + 21 transitive orphans. |
| 5 | [#1334](https://github.com/anchapin/staging-studio/pull/1334) | `chore/1326-drop-fal-script` | #1326 | Removes @fal-ai/client + 3 transitive deps + deletes `scripts/bake-off-prep-masks.mts`. |
| 6 | [#1335](https://github.com/anchapin/staging-studio/pull/1335) | `test/1327-room-reorder-contract` | #1327 | New `src/lib/room-reorder.ts` + `tests/room-reorder.test.ts` + 12-line refactor of `project-detail-view.tsx#handleDragEnd`. NO migration, additive only. |

The `chore/1326-drop-fal-script` branch also touched `scripts/bake-off-prep-masks.mts` (file deletion). If anything has been pushed to develop that re-touched that script path, you'll need to delete it from the merged tree (the file is gone from develop already, so a fresh sync should just work).

---

## Mandatory reading before touching anything

Read this **in full** before you do anything destructive:

- **`/home/alex/Projects/staging-studio/AGENTS.md`** — load-bearing. Specifically §Commands (Node 24 LTS, no `npm audit fix --force`, no `vercel env pull .env.local`), §Testing (vitest splits + the holistic-mask flake footnote, hermetic Playwright), §Routing & auth (preview-token flow), §Toolchain quirks (Next.js rewrites tsconfig.json on every build — `.githooks/pre-commit` catches it), §Releasing to Production (NOT in scope for this wave — only `develop` merges), §Vercel CLI env commands (the footgun footnote).
- **`.handoffs/2026-10-14-deps-hygiene-sweep.md`** — the wave that opened these PRs; contains the four-check baseline, the AGENTS.md-flagged overrides that must stay intact, and the historical-writeups note about `bake-off/RESULTS.md` and `bake-off/drift-results.md`.
- **`.github/workflows/ci.yml`** — confirm the `pull_request` scope covers these PRs and identify which jobs will run on each (`fast-checks` + `lint-baseline` + `release-guard` won't fire because it's scoped to `base_ref == 'main'`).

---

## Stand-up checklist (do all three before the first merge)

### 1. Use Node 24

Non-interactive shells don't auto-source nvm in this repo. Source the wrapper from the wave that opened these PRs:

```bash
. /home/alex/Projects/staging-studio/.agents/load-node-24.sh
node -v   # must print v24.x — refuse to proceed if it prints v22.x
npm -v    # must print v10+ (11 is fine)
```

The wrapper is at `.agents/load-node-24.sh`. If it's not present, source nvm yourself:

```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use 24
```

### 2. Sync state

```bash
cd /home/alex/Projects/staging-studio
git fetch origin
git checkout develop && git pull --ff-only   # must fast-forward cleanly
git status --short                           # should be clean apart from .handoff.md
```

If `develop` is behind the branches (it shouldn't be — they all branched from `545a725`), stop and `git pull --rebase` is **not** the move (those branches are PRs, not your work). Just `git checkout <branch> && git pull --ff-only` each one.

### 3. Confirm the Prisma client is fresh

`.agents/db-generate` warm-up tip from the wave that opened these PRs: the local Prisma client goes stale between opencode sessions. Run this **once** for your session:

```bash
cd /home/alex/Projects/staging-studio && npm run db:generate
```

Skipping this surfaces bogus type errors in `tests/sign-project-route.test.ts` about `clientConsentAttestedAt` and similar. Those are stale-client artifacts, not real failures.

---

## Per-PR merge routine (run for each PR in the order above)

### Step A — Local checkout and integrity check

```bash
cd /home/alex/Projects/staging-studio
git fetch origin
git checkout "<branch-from-the-table>"
git rebase origin/develop   # rebase onto current develop tip
```

If the rebase surfaces conflicts, solve them in this priority order:

1. **`package-lock.json`** — if both sides touched the lockfile, **always take develop's version** and re-run `npm install` from each branch's `package.json` to regenerate. Manually resolving lockfile entries is a trap.
2. **`package.json`** — merge the field-level edits; both branches should be touching **different** package names, so conflict means a real conflict (e.g. one branch deleting and the other modifying the same dep) — uncommon here, but if it happens, do not paper over, **stop and ask** Alex.
3. **`tsconfig.json`** — if it flipped `jsx: "preserve" → "react-jsx"` during a `next build` / `next dev` on the branch, restore from HEAD with `git checkout HEAD -- tsconfig.json` (the AGENTS.md-flagged tsconfig-flip guard). Re-run the build to confirm the flip really doesn't belong.
4. **Source files** — should be no overlap between these six branches because each touches a distinct concern. If you see a real conflict in `src/lib/` or `src/app/`, **stop and ask** Alex — that means two branches raced on the same surface and the wave's documentation missed it.

After solving (or running clean), `git add` the resolved files and `git rebase --continue`.

### Step B — Local four-check (the same one each PR's body claims is green)

```bash
. .home/alex/Projects/staging-studio/.agents/load-node-24.sh   # if not already sourced
cd /home/alex/Projects/staging-studio
npm run db:generate >/dev/null 2>&1    # silent; one-time only
echo "=== lint ===";       npm run lint >/tmp/l.out 2>&1; echo "exit=$?"
echo "=== typecheck ===";  npm run typecheck >/tmp/t.out 2>&1; echo "exit=$?"
echo "=== test (full) ==="; npm test >/tmp/te.out 2>&1; echo "exit=$?"
echo "=== build ===";      npm run build >/tmp/b.out 2>&1; echo "exit=$?"
git checkout HEAD -- tsconfig.json 2>&1 | head -1  # always — Next.js flips it
```

All four must be `exit=0`. **If any fails for a reason the four checks in the PR body don't predict, stop and ask.** The pre-existing flake noted in the wave handoff (`tests/holistic-mask.test.ts` timing out under the 193-worker pool load) may resurface — it doesn't block the merge because:

- It reproduces on `develop` with no edits applied (proven during the prior wave).
- The same files pass 100% in isolation.

If you see it, re-run only `tests/holistic-mask.test.ts` in isolation and confirm 26/26 green before declaring the four-check passes. Flag in your final report.

After any build, restore tsconfig:

```bash
cd /home/alex/Projects/staging-studio
git checkout HEAD -- tsconfig.json
git status --short
```

### Step C — Push the rebased branch and wait for CI

```bash
cd /home/alex/Projects/staging-studio
git push --force-with-lease origin "<branch>"
```

NEVER `git push --force`. Always `--force-with-lease`. (If the branch is still identical to origin, the push is a no-op and CI on the existing commit re-runs — which is fine.)

Wait for CI using `ci-wait <PR>` if your opencode has that tool, or fall back to:

```bash
gh pr checks <PR-number> --repo anchapin/staging-studio --watch
```

NEVER poll CI in a loop interactively (`gh pr view <PR>` then `sleep 5`). Use `--watch` / `ci-wait` and let it block.

What CI runs on each PR (per `.github/workflows/ci.yml`):
- `fast-checks` (Lint · Typecheck · Unit tests) — runs on `pull_request` opened/synchronize/reopened against develop. **This is the must-pass gate.**
- `lint-baseline` — runs on the same scope; tracks oxlint warning counts vs a baseline.
- `release-guard` — scoped to `base_ref == 'main'`, **will NOT fire on these PRs**.
- `e2e` — scoped to `push` on develop/main only, **will NOT fire on these PRs**.

So the only relevant gate is `fast-checks` (and `lint-baseline` which is non-blocking warning-count drift).

### Step D — Merge and proceed

When CI is green on the branch, merge:

```bash
cd /home/alex/Projects/staging-studio
gh pr merge <PR-number> --repo anchapin/staging-studio --squash --delete-branch
```

- Always `--squash` (each PR is one focused commit per the wave's working agreement; squash keeps develop history clean).
- Always `--delete-branch` (local cleanup; nothing else uses these branches).
- Do NOT use the GitHub web UI — there's no clean way to keep both the merged commit and the local branch deletion in sync.

After the merge:

```bash
cd /home/alex/Projects/staging-studio
git checkout develop && git pull --ff-only
git branch -d "<branch>" 2>/dev/null || true     # ignore if already deleted
```

Then proceed to the next PR.

### Step E — When something goes wrong

Three known failure modes; pre-decided responses:

1. **`fast-checks` fails on `tsconfig.json` flip** — `git checkout HEAD -- tsconfig.json` and re-run. The `.githooks/pre-commit` guard catches it on commits but not on a CI run. If the test job's checkout used the flipped tsconfig, the next run won't have the flip (CI regenerates types from `tsconfig.json` on every run, so a flipped tsconfig in a commit surfaces as type errors that vanish on the next push).

2. **`fast-checks` fails on holistic-mask flake** — re-run in isolation (`npx vitest run tests/holistic-mask.test.ts`); if 26/26 pass, the merge is still safe. Note in your final report. This is the same flake the prior wave documented in `tests/holistic-mask.test.ts`.

3. **`fast-checks` fails on a real regression** — STOP. Do not paper over. The four-check the prior wave claimed green was based on the same `package.json` + `node_modules/` state you have now (other than lockfile churn from earlier merges in this wave). If CI is red after the rebase, something in the developing tree is broken. Capture the failing job URL, the failing test name, and the failing assertion; write a comment on the PR linking them; ask Alex.

---

## Hard rules — do NOT violate

These are restatements of AGENTS.md rules that this wave will surface as temptations:

1. **Never run `npm audit fix --force`.** It would unwind the `next@^16.3.8` patch from #1183 (next/og RCE) AND downgrade `shadcn@4.21.4 → 1.0.0`. AGENTS.md §Security advisories has the full reasoning. Each lockfile delta has been verified to leave the `braces` / `deepmerge-ts` / `mysql2` overrides intact; if a future PR breaks that, stop.

2. **Never `vercel env pull .env.local`** with no path argument. It clobbers `.env.local` AND breaks the `.env → .env.local` symlink the Prisma CLI depends on. AGENTS.md §Vercel CLI env commands.

3. **Never `npm run e2e` interactively.** Hermetic Playwright, needs Docker + production build + single worker — too slow for this wave. CI's e2e job doesn't run on PRs against develop anyway.

4. **Never `git reset --hard`** on develop. If a merge goes sideways, `git revert -m 1 <merge-sha>` to undo it cleanly.

5. **Never commit `tsconfig.json` with `jsx: "react-jsx"`.** Always `git checkout HEAD -- tsconfig.json` after `npm run build` / `npm run dev`. The `.githooks/pre-commit` guard catches it; don't bypass it.

6. **Never push with `--force`.** Always `--force-with-lease`. The prior wave used `--force-with-lease` to amend #1326's commit, which is the only legitimate force-push scenario in this set.

7. **Do not run `release:check` or interact with the `develop → main` release guard this session.** That's a separate decision. If all six PRs land cleanly and `fast-checks` is green, you can stop there. The release-window decision (when to merge develop to main) belongs to a different planning cycle.

---

## When you're done

Write a follow-up handoff note to `.handoffs/2026-10-14-deps-hygiene-merge-wave-done.md` (or similar) with:

1. The merge order you actually used (if different from this prompt's recommended order, explain why).
2. Per-PR outcome: merged clean, merged with conflict (and how resolved), blocked-and-asked-Alex.
3. CI results per PR: which jobs ran, which were green, which needed re-runs. If the holistic-mask flake appeared, note the count.
4. Final state of `develop` (HEAD + log of the six merge commits).
5. Any leftover work (e.g. the `tsconfig-1101-baseline.tsbuildinfo` file that was untracked in the prior wave and remains untracked — harmless but mention it).
6. Whether you ran the release checks (`release:check`) — likely not, since the brief says not to. If you did, why.

That's the entire job. Six PRs in, six "merged" or "asked for human help" out.
