# Wave-5 revival — DONE (2026-10-20)

Session: `2026-10-20-wave5-revival-closeout` — closing the wave5-issue933
revival that two `squad-orchestrator` subagents drove across
2026-10-19/20, plus two fix-up PRs from this session.

Branch: `main`, clean, at `e03a6f2`.

## What landed on `origin/main`

A linear story of 8 commits:

```
e03a6f2 fix(export-pdf): drop code field from 403 forbidden envelope (#1409)
cc12fd9 fix(export-pdf): restore Browserless Authorization header + 403 wording (#1408)
4430b0d phase-2 PR-4 self-report (#1407)
fede00c refactor(api): decompose /api/generate-copy into thin handler + lib (#1406)
3741147 phase-2 PR-3 self-report (#1405)
c1df571 refactor(api): decompose /api/export-pdf (#1404)
50d900d phase-2 brief (#1403)
b982c53 phase-1 self-report (#1402)
72ee1a2 refactor(api): decompose /api/segment/furnishings (#1401)
dd3aaf1 refactor(api): decompose /api/label-instances (#1400)
```

(The plan and phase-1 brief handoffs before #1400 are also on the main
story via PRs #1398 and #1399.)

## What got decomposed

| Route | Pre-revival monolith | Post-revival handler | Service module | Tests |
|---|---|---|---|---|
| `/api/label-instances` | 221 lines | ~50 lines | `src/lib/label-instances-service.ts` (~365 lines drafted by subagent) | 17 tests |
| `/api/segment/furnishings` | 298 lines | ~80 lines | `src/lib/segment-furnishings-service.ts` | 17 tests |
| `/api/export-pdf` | 365 lines | 248 lines | `src/lib/export-pdf-service.ts` (342 lines) | 25 tests |
| `/api/generate-copy` | 444 lines | 230 lines | `src/lib/generate-copy-service.ts` (446 lines) | 26 tests |

Total: **1328 monolithic lines → ~608 thin-handler lines + 4 service modules + 85 new tests.**

## Verification (post-merge push-scoped CI on `main`)

| Check | Status | Time |
|---|---|---|
| Lint · Typecheck · Unit tests | ✅ success | 1m 11s |
| Docker image builds | ✅ success | 1m 38s |
| E2E (Playwright) | ✅ success | 3m 48s (62/62 specs after fix-ups) |
| Release guard | (skipped — push event) | — |

## Issues — disposition table (closeout from this session)

| # | Title | Disposition | Reason |
|---|---|---|---|
| **#1389** | [housekeeping] abandoned branch: wave5-issue933 | **close as `completed`** | All 4 missing decompositions landed, e2e clean, the abandoned branch's job is fully carried forward |
| **#1392** | parent tracker for 7 abandoned-branch tickets | **close as `completed`** | All 7 children closed (Phase 1 closed 6 as DUPLICATE on 2026-10-19; #1389 closing today) |
| **#1393** | Add `requireUser()` test-mock helper | **leave open** | NOT in wave5-revival scope; it's wave-3 mock-helper work |
| **#1394** | The 4 missing decompositions call-out | **close as `completed`** | 4 of 4 actually landed (#1400, #1401, #1404, #1406) |
| **#1395** | requireUser() test mock helper (lost from wave-3) | **leave open / decision-to-surface** | Effectively a duplicate of #1393's scope; the user should pick one to keep open |
| **#1396** | Re-execution: decompose POST /api/inpaint (lost from Wave-5) | **leave open / decision-to-surface** | The `src/lib/inpaint-*.ts` modules already exist (10 of them), but `/api/inpaint/route.ts` is still 304 lines of orchestration — partial work. AGENTS.md calls out the existing partial state. |
| **#1397** | decompose /api/label-instances + /api/segment/furnishings | **close as `completed`** | Identical-scope to #1393 in some re-execution framing, but #1397 is wave-5 specifically and is fully landed via #1400 + #1401 |

## Lessons learned (locked-in for future sessions)

These are the corrections the two subagents discovered; they're the
**rationale for the new tests** in PR #1408 (Authorization header,
403 envelope). Reading them tells the next session what's load-bearing.

1. **`claimDailyQuota` / `refundDailyQuota`** is the atomic quota pair (#1132). NOT `enforceQuota` (the test-side helper).
2. **`resolveDailyLimit(envVarValue, fallback)`** is 2-arg.
3. **`@prisma/client` `User` type** is imported directly, not via `@/lib/api-auth` (which doesn't re-export it).
4. **Inline narrow Prisma deps interfaces** (`Pick<typeof prisma>` is too strict for test mocks; use `interface Deps { prisma: { room: PrismaClient["room"] } }`).
5. **`getInferenceClient()` returns a Promise**; consumers must `await` before subscribing.
6. **`FAL_SPEND_CALL` regex** in `src/lib/fal-spend-guard.ts` matches helper-pattern function names; extend it when introducing new fal inference paths.
7. **`/api` vs `/api/v1/export-pdf` disagreement** is by design: unversioned propagates raw status; v1 flattens to 500.
8. **Error envelopes are pinned by e2e**. The orchestrator's "thin handler" refactor leaked a `code: API_ERROR_INVALID_REQUEST` field onto a 403 path the e2e spec had pinned to {error, message} only. Always include both an e2e-spec assertion pin AND a `vi.mocked(...).mock.calls[0]` header inspection when adding a service.
9. **AGENTS.md "Two mocking strategies"**: e2e is push-scoped only, NOT per-PR. Per-PR lint+typecheck+unit gates CANNOT catch envelope-drift regressions; those surface only in the post-merge push. The fix-up in this session shows the pattern.
10. **TSConfig-flip pre-commit guard** works correctly. `npm run e2e` triggered Next.js to flip the tsconfig; `git checkout HEAD -- tsconfig.json` was needed BEFORE `git commit`.

## Refs

- Plan: `.handoffs/2026-10-19-wave5-revival-plan.md`
- Briefs: `.handoffs/2026-10-19-wave5-revival-orchestrator-brief.md`, `.handoffs/2026-10-20-wave5-revival-phase2-brief.md`
- Predecessor: `763cf0d` (2026-10-19 housekeeping closeout)
- Own previous handoff: `.handoffs/2026-10-19-housekeeping-followups-DONE.md`
- This file committed as a single commit, on `main`, after the issue closures.

## Termination

The wave5-revival engagement is closed. The next session that picks up
issue triage will see #1389 / #1392 / #1394 / #1397 closed by this
session, with #1393 / #1395 / #1396 still open and ready for the next
initiative.
