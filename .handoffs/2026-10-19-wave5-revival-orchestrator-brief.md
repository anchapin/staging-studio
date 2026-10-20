# Squad orchestrator brief — Wave-5 revival (issue #1389)

This is the brief I am handing to `squad-orchestrator`. The 4-PR
sequence kicks off on acceptance.

## Goal

Issue **#1389**: revive the abandoned `wave5-issue933` work by landing
**4 missing route decompositions** as 4 sequential PRs against `main`.

The 4 routes are (in ascending order — see plan for context):

1. `/api/label-instances` — 221 lines → `src/lib/label-instances-service.ts`
2. `/api/segment/furnishings` — 298 lines → `src/lib/segment-furnishings-service.ts`
3. `/api/export-pdf` — 365 lines → `src/lib/export-pdf-service.ts`
4. `/api/generate-copy` — 444 lines → `src/lib/generate-copy-service.ts`

Total 1328 monolithic lines. After the revival: 4 thin handlers
(< 80 lines each) + 4 pure service modules + 4 vitest specs.

## Scope (strict — do not exceed)

- **Only the 4 decompositions above.** No orthogonal cleanup, no
  AGENTS.md updates, no sweeping renames, no closing of sibling
  issues, no decision-by-decision judgment calls surfaced back to
  the human.
- **One PR per route.** Per-PR scope: `src/lib/<service>.ts`,
  `tests/<service>.test.ts`, `src/app/api/<route>/route.ts`. PR
  number sequence: the next free numbers on this repo (after #1398).
- **Per-PR sequencing rule**: PR *n+1*'s branch must originate from
  the merged tip of PR *n* — the orchestrator may pause and inspect
  the PR-n merge to confirm tree before starting PR n+1.

## Required inputs (paths the orchestrator must read first)

- `.handoffs/2026-10-19-wave5-revival-plan.md` — full plan, function
  exports per route, test pins, constraints.
- `AGENTS.md` — primary. Especially:
  - "Layout" section (services convention, tests pins).
  - "Two mocking strategies" (E2E_HERMETIC seam for export-pdf).
  - "API versioning" (`/api/v1/export-pdf` 503→500 vs `/api/export-pdf` raw).
  - "Releasing to Production" (release-merge ritual, branch protection).
  - "Turn Budget" (40-50 turns max per session → 4 PRs need 4 budget
    rounds).
  - "Security advisories" (#1220 braces override; do NOT run
    `npm audit fix --force`).

## Inherited non-negotiables from AGENTS.md (verbatim constraints)

- `npm run lint`, `npm run typecheck`, and `npx vitest run` for the
  touched test file MUST pass per PR before opening. (AGENTS.md
  "Commands".)
- Pre-commit hook runs `scripts/check-tsconfig-flip.sh` (AGENTS.md
  "Toolchain quirks"). If it flags a tsconfig flip, revert with
  `git checkout HEAD -- tsconfig.json` BEFORE pushing.
- Quota counters live in `DailyApiUsage` Postgres rows, not an
  in-process Map. Service modules MUST go through
  `src/lib/api-quota.ts#consumeQuota` — never write to
  `DailyApiUsage` directly from a route.
- `E2E_HERMETIC=1` + `E2E_BROWSERLESS_PDF_URL` are scoped to
  `tests/e2e/env.ts` (mock test seam). The export-pdf service must
  forward `resolveBrowserlessPdfUrl()` (from `src/lib/browserless.ts`)
  for the seam to keep working — never hard-code the browserless
  URL.
- Don't open `vercel env pull .env.local` or any path under
  `.env.local` / `.env` (the closeout doc captured this footgun).
- Don't touch `.agents/`, `.opencode/`, `.planning/worktrees/` (they
  are gitignored runtime state). Don't commit them.
- Commit subjects: prefix `[AI-assisted]` and attribute the tool —
  in this case `(opencode:squad-orchestrator)`.

## Per-PR verification gates (each must pass before opening the PR)

| Gate | Tool | Threshold |
|---|---|---|
| Lint | `npm run lint` | 0 errors in touched files |
| Typecheck | `npm run typecheck` | 0 errors |
| New test file | `npx vitest run tests/<service>.test.ts` | 100% pass |
| Adjacent tests | `npx vitest run tests/` (full suite) | 0 regressions |
| Pre-commit hook | implicit on `git commit` | clean (no tsconfig flip) |

The `npm run e2e` hermetic Playwright suite is **not** run per-PR
(it's expensive — Docker + 62 specs). The executing session
relies on the merge-time `E2E (Playwright)` push-scoped CI job to
catch export-pdf regressions; AGENTS.md calls this out as
*intentional*.

## Self-report schema (end of run)

When each PR's CI is green and the merge succeeds, the orchestrator
appends a section to this file:

```
## PR-N report — <route>
- Branch: feat/wave5-issue933-revival-<route>-NNNN
- URL: <gh pr URL>
- Files touched:
  - src/lib/<service>.ts (added, N lines)
  - tests/<service>.test.ts (added, M lines)
  - src/app/api/<route>/route.ts (reduced from A to B lines)
- Verification:
  - lint: ok / warn / error (counts)
  - typecheck: ok / error
  - vitest: <new tests> pass / N total pass / 0 fail
  - CI: green / red (link to workflow run)
- Decision points hit (if any):
  - <none / describe>
- Risk observations:
  - <none / describe>
```

Repeat for all 4 PRs.

## Out-of-scope (do NOT do)

- Do NOT close issues #1393–#1397, #1389, or #1392. The user will
  do that after inspecting the PRs.
- Do NOT update AGENTS.md.
- Do NOT touch unrelated routes or non-route lib modules.
- Do NOT run `npm audit`, `npm audit fix`, or any package-update
  commands.
- Do NOT run `next build` / `next dev` outside of a `vercel build`
  CI context (the tsconfig-flip guard will reject the commit).
- Do NOT push directly to `main` — every merge is via PR.
- Do NOT skip the per-route ordering. Order matters because issue
  bodies and the wave-5-context in this repo make the smaller
  routes the easier ones to land first (the orchestrator builds
  muscle memory on the smaller routes for the larger ones).

## State at handoff

- Branch: `main` clean, at `3e04dc8` (local) / `b0b9ee2` (origin).
- Issue #1389: open, decision = "revive".
- Plan: `.handoffs/2026-10-19-wave5-revival-plan.md` (just merged).
- This brief: `.handoffs/2026-10-19-wave5-revival-orchestrator-brief.md`
  (about to be merged).
- All sibling issues (#1393, #1394, #1395, #1396, #1397, #1392):
  open and untouched.

## Termination condition

When all 4 PRs are merged (or any one fails and you can document
why), the orchestrator hands back to the user with the PR list
and any decision points that surfaced. **Do not sign off until
each PR has a `gh pr view --json state` confirming `MERGED`.**
