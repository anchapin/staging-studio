# Squad-orchestrator brief — Wave-5 revival PHASE 2 (PRs #3 and #4)

## Context

The first `squad-orchestrator` session (2026-10-19/20) closed 2 of 4
decompositions for issue #1389:

- **PR #1400** — `/api/label-instances` → `src/lib/label-instances-service.ts`
- **PR #1401** — `/api/segment/furnishings` → `src/lib/segment-furnishings-service.ts`

PRs #3 (export-pdf) and #4 (generate-copy) are NOT STARTED. The
first session hit its 40-50 turn budget and stopped cleanly per the
brief's "Don't keep iterating after the report is written" clause.

## Your goal — the remaining 2 PRs

In ascending order, both branched off current `origin/main`:

### PR-3: `/api/export-pdf` → `src/lib/export-pdf-service.ts`

- Branch: `feat/wave5-issue933-export-pdf`
- Two route siblings share the dispatch seam: `src/app/api/export-pdf/route.ts` AND `src/app/api/v1/export-pdf/route.ts`. They both call `resolveBrowserlessPdfUrl()` (in `src/lib/browserless.ts`) — the seam only rewires the endpoint when `E2E_HERMETIC=1` per AGENTS.md "Two mocking strategies".
- **The two routes disagree on upstream-error mapping by design.** The unversioned one propagates the provider's status verbatim (a 503 upstream stays 503). `/api/v1/export-pdf` flattens to a 500 with `error.code = "invalid-request"`. Both are pinned by `tests/e2e/specs/export-pdf*.spec.ts`. If your service interface normalizes errors, **the normalization must live in the route, not the service**, so the v1 behavior survives.
- The service returns: `{ status: number, body: unknown }` (or whatever shape export-pdf emits today — match it exactly).
- Functions (target exports, pure):
  - `resolvePreviewUrl(appUrl, projectId, deps)` — mints the HMAC
    preview token via `lib/preview-token.ts`, assembles the
    cookie-less print URL Browserless fetches.
  - `resolveBrowserlessEndpoint(deps)` — delegates to
    `lib/browserless.ts#resolveBrowserlessPdfUrl` (preserves
    the E2E_HERMETIC seam).
  - `exportProjectPdf({ projectId, userId }, deps)` — owns the
    ownership check (project belongs to user), Browserless
    dispatch, response shaping. Accepts deps so the test suite
    can hand-roll a mock without `vi.mock`.
  - `assertExportQuotaConsumed(userId, deps)` — calls
    `lib/api-quota.ts#claimDailyQuota(...)` (NOT
    `enforceQuota`; see "Corrections baked in" below).
- Test pin: `tests/export-pdf-service.test.ts` covering
  - happy path (`200/202` envelope)
  - ownership fail (`403`)
  - quota exhausted (`429`)
  - upstream Browserless 503 — once with the unversioned route
    semantics (`503` propagates) and once with the v1 route
    semantics (`500 invalid-request`)
  - `E2E_HERMETIC=1` flips to mock endpoint (verify the seam)

### PR-4: `/api/generate-copy` → `src/lib/generate-copy-service.ts`

- Branch: `feat/wave5-issue933-generate-copy`
- Largest monolithic route in the wave5 set (444 lines).
- Service uses the `ai` package (gpt-4o-mini via `lib/ai.ts#aiModel`) directly. NO fal inference — `FAL_SPEND_CALL` regex does NOT need updating for this PR. (See "Corrections baked in" #6 for when it WOULD need updating.)
- Functions (target exports, pure):
  - `validateCopyAccess({ projectId, userId }, deps)` — ownership check
  - `checkCopyQuota(userId, deps)` — calls `claimDailyQuota` for `'copy'` surface
  - `runCopyGeneration(prompt, roomState, deps)` — calls gpt-4o-mini via `lib/ai.ts`
  - `persistCopyResults(projectId, copy, deps)` — Prisma write
  - `parseGenerateCopyRequest(body)` — Zod parse against `ai-route-schemas.ts#copySchema`
- Test pin: `tests/generate-copy-service.test.ts` covering
  - valid request → copy payload
  - Zod payload rejection → `400 bad-request`
  - missing project → `404 not-found`
  - wrong owner → `403 forbidden`
  - quota exhausted → `429`
  - gpt-4o-mini returns invalid response → `502 invalid-request`

## Corrections baked in (from PR-1 + PR-2 — DO NOT rediscover)

These are facts the first session learned the hard way. Trust them; reverify only if a `git log` shows the relevant lib changed since.

1. **Quota API: `claimDailyQuota` / `refundDailyQuota`** (atomic, per
   AGENTS.md #1132). NOT `enforceQuota` / `enforceQuotaAtLimit` (those
   are the read-side names in the original e2e tests; the
   production-side is the claim/refund pair).
2. **`resolveDailyLimit(envVarValue, fallback)`** takes 2 args. The
   plan file referenced `resolveDailyLimit(surface)` — wrong.
3. **`@prisma/client` `User` type imported directly** from
   `@prisma/client`, not through `@/lib/api-auth` (which doesn't
   re-export it).
4. **Prisma deps use inline narrow interface**, e.g.:
   ```ts
   interface Deps {
     prisma: { room: PrismaClient["room"] };
     quota: typeof import('@/lib/api-quota').claimDailyQuota;
     falClient: typeof import('@/lib/inference').getInferenceClient;
   }
   ```
   `Pick<typeof prisma, "room">` was too strict for test mocks.
5. **`getInferenceClient()` returns a Promise** — `deps.subscribe`
   callbacks are async; await the client before using. (Applies to
   the fal-client usage in label-instances AND export-pdf-route if
   the env switch routes through it; copy-gen does not.)
6. **`FAL_SPEND_CALL` regex lives at `src/lib/fal-spend-guard.ts`
   and must be extended to match any new helper-pattern function
   name** that ends up wrapping a fal inference call. The first
   session extended it twice: `runFurnishingDetection(` (PR-2) and
   `runLabelGeneration(` (PR-1). The test that pins the regex is
   `tests/api/uncapped-fal-calls.test.ts`.
   **PDF export does NOT need a regex update** (Browserless only,
   no fal). **Generate-copy does NOT need a regex update** (gpt-4o
   via the `ai` package, no fal). If a future extension IS needed
   to support a paid-inference gpt-4o path, extend it the same
   way.
7. **`keepScoresForSurvivingMasks(settled, scores)`** is the
   partial-mask-tolerance helper for fal. Lives in the service
   module that owns the inference call. Pure function, unit-tested.

## Hard constraints (verbatim from the original brief)

- Read `/home/alex/Projects/staging-studio/AGENTS.md` BEFORE editing. Especially "Layout", "Two mocking strategies", "API versioning", "Releasing to Production", "Turn Budget", and "Security advisories".
- Per-PR verification (must pass before opening each PR):
  - `npm run lint` (0 errors in touched files)
  - `npm run typecheck` (0 errors)
  - `npx vitest run tests/<service>.test.ts` (100% pass)
  - `npx vitest run tests/` (no regressions)
- Pre-commit hook will check the tsconfig flip. If it flags, run `git checkout HEAD -- tsconfig.json` before retrying.
- DO NOT run `npm audit`, `npm audit fix`, or any package-update commands.
- DO NOT touch `.agents/`, `.opencode/`, `.planning/worktrees/`.
- DO NOT push directly to `main` — every merge is via PR.
- DO NOT close issues #1393–#1397, #1389, or #1392.
- DO NOT update AGENTS.md.
- Commit subject pattern: `[AI-assisted] (opencode:squad-orchestrator) <type>(<scope>): <description>`.

## Per-PR sequencing

- PR-3 branches off current `origin/main` (= `b982c53` at brief-write
  time, may have advanced).
- PR-4 branches off `origin/main` AFTER PR-3 merges. If PR-3 is not
  yet merged when you start PR-4's branch, you'll be racing the
  first PR. The orchestrator MUST pause and verify the merge before
  starting PR-4's branch.

## State files for context

- `/home/alex/Projects/staging-studio/.handoffs/2026-10-19-wave5-revival-plan.md` — full plan.
- `/home/alex/Projects/staging-studio/.handoffs/2026-10-19-wave5-revival-orchestrator-brief.md` — original brief + Phase 1 self-report.
- The `lib/fal-spend-guard.ts` regex with the two prior extensions.

## Self-report (append here)

```
### PR-3 report — `/api/export-pdf` → `src/lib/export-pdf-service.ts`
- Branch: feat/wave5-issue933-export-pdf
- URL: <gh pr URL>
- Merged: <iso8601>
- Files touched: [...]
- Verification: [...]
- Decision points hit: [...]
- Risk observations: [...]

### PR-4 report — `/api/generate-copy` → `src/lib/generate-copy-service.ts`
- ...
```

## Termination condition

When both PRs are merged (or one fails irrecoverably and you can
document why), hand back. **Verify each PR with `gh pr view --json
state` confirming `MERGED` before signing off.**
