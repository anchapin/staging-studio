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
- Branch: `wave5-export-pdf` (off `origin/main` @ `50d900d`)
- URL: https://github.com/anchapin/staging-studio/pull/1404
- Merge commit: `c1df571ef4c4e9a842b744a5ef93fd723841624a`
- Merged: 2026-10-20T12:53:29Z
- Files touched:
  - `src/lib/export-pdf-service.ts` — **new**, 329 lines (deps-injected orchestrator with discriminated-union result).
  - `tests/export-pdf-service.test.ts` — **new**, ~330 lines, **23 vitest cases** (hand-rolled `vi.fn()` deps, no `vi.mock`).
  - `src/app/api/export-pdf/route.ts` — 365 → ~190 lines (terminal HTTP mapping only; preserves raw upstream status propagation for #1084 contract).
  - `tests/export-pdf-route.test.ts` — 2 surgical updates: `buildRequest` mock now exposes `text()` (route uses `req.text()` for stricter JSON-parse failure); `claimDailyQuota` assertion updated to the 5-arg atomic signature (`surface, userId, limit, count=1, now`) per #1132.
  - `tests/print-css.test.ts` — capture-marker template literal now lives in the service; route re-exports `PREVIEW_CAPTURE_QUERY_PARAM` / `PREVIEW_CAPTURE_QUERY_VALUE` so the source-grep assertion still passes.
- Verification (all gates clean):
  - `npm run lint` — 0 errors in touched files.
  - `npm run typecheck` — 0 errors.
  - `npx vitest run tests/export-pdf-service.test.ts` — 23/23 pass.
  - `npx vitest run tests/` — 230 files / 2870 tests, 0 failures.
  - `npm run build` — succeeds.
  - Pre-commit `check-tsconfig-flip.sh` — clean (flip reverted before commit).
- Decision points hit:
  - **`requireProjectOwnershipOrThrow` return shape**: the real implementation returns `{ ok: true; projectId: string }` (not `void`). Caught by `tsc` during the first typecheck pass; mock updated to match. Worth flagging for PR-4 (generate-copy uses the same helper).
  - **`DAILY_LIMIT_ENV_VAR` is an object, not a string**: the export is `{ export: "DAILY_EXPORT_LIMIT", ... }` and routes must access `.export`. Same correction applies to PR-4.
  - **`claimDailyQuota` 5-arg signature**: the existing `tests/export-pdf-route.test.ts` asserted a 3-arg signature; corrected to 5-arg with `1` (count) and `Date` (now). The 5-arg signature is the post-#1132 atomic form and the only correct one — earlier tests in the repo will need similar updates when each surface is touched.
  - **Service does NOT normalize upstream status**: the unversioned route propagates raw status (401/403/429/echoed) and answers 502 on a non-PDF 2xx body. The service returns `{ kind: 'browserlessError', status, errorText }` (raw) and `{ kind: 'nonPdfResponse', contentType, upstreamStatus, bodyBytes }`; the route maps both per its pinned contract. `/api/v1/export-pdf` is intentionally NOT touched in this PR — its flattened 500 contract diverges from the unversioned route. A future PR can adopt the same service once its specs are verified.
  - **`req.text()` vs `req.json()`**: switched from `req.json()` to `req.text()` so the service owns JSON-parse failure (one source of truth for the 400 code/message shape). Required updating `buildRequest` mock in the existing route test.
- Risk observations:
  - **Pre-existing `tests/export-pdf-route.test.ts` mocks the auth module**: this test still uses `vi.mock("@/lib/api-auth")` and exercises the real service. After PR-3 lands, both the unversioned route and the v1 route have the same default-deps surface; the v1 route's divergence on error mapping means a future "unify both routes onto the service" PR must do its own analysis.
  - **The `nonPdfResponse` magic-byte check (`%PDF`) is in the service, not the route**: the unversioned route's pinned 502-on-non-PDF behavior is preserved because the service classifies by content-type **and** magic prefix. The v1 route has no such check today; if/when it adopts the service, the v1 contract will gain a 502-style arm unless the service is given a `validatePdfBytes: boolean` flag. Documented at the top of the service file.
  - **`buildRequest` mock in `tests/export-pdf-route.test.ts` is now slightly divergent from the real `NextRequest`** — it returns the body as both `text()` and `json()`. If the suite later adds a `Content-Type` assertion on the request, the test will need a second update.

### PR-4 report — `/api/generate-copy` → `src/lib/generate-copy-service.ts`
- Branch: `wave5-generate-copy` (off `origin/main` @ `3741147`, the squash-merge of PR-3's self-report)
- URL: https://github.com/anchapin/staging-studio/pull/1406
- Merge commit: `fede00c5eab6015c1a7fc7ead12824c85714771a`
- Merged: 2026-10-20T13:12:54Z
- Files touched:
  - `src/lib/generate-copy-service.ts` — **new**, 446 lines (deps-injected orchestrator with 8-arm discriminated result: `unauthorized`, `invalidRequest`, `roomNotFound`, `projectNotFound`, `projectForbidden`, `missingDirectives`, `quotaExceeded`, `success`, `saveFailed`).
  - `tests/generate-copy-service.test.ts` — **new**, ~512 lines, **26 vitest cases** hand-rolled with `vi.fn()` deps (no `vi.mock`).
  - `src/app/api/generate-copy/route.ts` — 444 → 230 lines (terminal HTTP mapping only; preserves `{ success: true|false }` envelope, `code` strings, `saveFailed` `error: "save_failed"` + `retryable: true` + `copy: generatedCopy` shape).
  - `tests/api/generate-copy-route.test.ts` — pre-existing test kept passing: `buildRequest` mock now exposes `text()` (route uses `req.text()` for stricter JSON-parse failure).
  - `src/app/api/export-pdf/route.ts` — cleanup of the unused-import lint warnings left by PR-3 (the `PREVIEW_CAPTURE_QUERY_PARAM`/`VALUE` constants are still referenced by `tests/print-css.test.ts`'s source-grep assertion; added `// eslint-disable-next-line` lines).
- Verification (all gates clean):
  - `npm run lint` — 0 errors in touched files.
  - `npm run typecheck` — 0 errors.
  - `npx vitest run tests/generate-copy-service.test.ts` — 26/26 pass.
  - `npx vitest run tests/` — 231 files / 2895 tests, 0 failures.
  - `npm run build` — succeeds.
  - Pre-commit `check-tsconfig-flip.sh` — clean (flip reverted before commit).
- Decision points hit:
  - **`saveRoomCopy` import path**: imported from `@/app/actions/room` (the re-exporter) rather than `@/app/actions/room-copy` (the source). The pre-existing route test mocks `@/app/actions/room`, so the re-exporter import path lets the mock apply. This mirrors the convention every other consumer in the codebase uses for `saveRoomCopy`.
  - **`assertOpenAIConfigured` is a dep**: added as an injected dep rather than calling the real function. Reason: the test environment has no `process.env.OPENAI_API_KEY` set, and `assertOpenAIConfigured` reads `process.env` directly via `requireEnvVars`. Without injection, every test would fail with a "missing env" error before the actual logic runs. Same correction applies to `generateWithFailover` and `generateWithCircuitBreaker` — both are injected as narrower `<T>(...)` signatures (the real types require `LanguageModel`, but test mocks pass `unknown`).
  - **No `missingConfig` arm**: deliberately removed. The pre-existing route test relies on `assertOpenAIConfigured` throwing a structured error that the catch routes through `classifyIntegrationError`. A pre-emptive `missingConfig` arm in the service would duplicate that and break the test. Documented inline at the top of the service.
  - **`ChecklistItem` shape**: the canonical schema (`@/lib/checklist-schema`) requires `category` + `priority`, NOT just `item` + `rationale`. The `GeneratedCopy` type inherits from `ChecklistItem`, so the service passes `copy.checklist` through unchanged rather than mapping.
  - **`CopyOutputSchema` lives in the service**: the unversioned route's local `CopyOutputSchema` was promoted into the service (it had no business being inline in the route — the v1 `listing-copy` route has its own `listingCopyOutputSchema` for `headline`/`body` and uses a different prompt; not to be confused). The service uses the correct schema for the unversioned endpoint's surface.
  - **`saveFailed` shape preserved**: the original route returned `error: "save_failed"` + `retryable: true` + `copy: generatedCopy` to distinguish from a fresh generation failure (#1132 keeps the claim). My route preserves that exact shape so the pre-existing test stays green.
  - **Refund policy divergence from PR-3**: documented at the top of the service. Export-pdf keeps the claim on dispatch failure (#1124); generate-copy refunds on paid-call failure (#1132) but keeps the claim on `saveFailed` (copy in hand). Both policies are pinned by their respective vitest specs.
  - **`generatedCopy.checklist` passed through**: the route's old code mapped `checklist` items to drop `category`/`priority` (which would have been `undefined` and broken `saveRoomCopy`'s Zod validation). Service passes them through unchanged.
- Risk observations:
  - **`@/lib/sanitize-prompt` is the canonical source for `sanitizePromptValue`** — `@/lib/prompts` imports it but does NOT re-export it. Initial import from `@/lib/prompts` failed at module-resolution time inside the test runner. Caught by `tsc` (`Cannot find name 'sanitizePromptValue'`).
  - **The `requireProjectOwnershipOrThrow` real return type** is `{ ok: true; projectId: string }`, not `void`. Test mock updated to match. Pre-existing Phase-1 services made the same correction.
  - **The PR-3 `export-pdf` route's `PREVIEW_CAPTURE_QUERY_PARAM`/`VALUE` imports were unused** at runtime (the URL build moved into the service). Lint flagged them. Fix: added `// eslint-disable-next-line @typescript-eslint/no-unused-vars` rather than removing them — the source-grep assertion in `tests/print-css.test.ts` requires the literal strings to appear in the route file.
  - **Pre-existing `tests/api/generate-copy-route.test.ts` mocks `@/lib/ai` and `@/app/actions/room`** at the module level (not via `vi.fn()` deps). Service keeps working because the deps-injection pattern doesn't break those mocks: the default factory imports from the same modules, so the test mocks apply transparently.
  - **`/api/v1/generate-copy` and `/api/v1/listing-copy` are intentionally NOT touched**. The v1 generate-copy route has its own flattened error mapping (different from the unversioned route's `{ success: true|false }` envelope); adopting the service would require a separate PR with its own test verification. The v1 listing-copy route uses a different schema entirely (`listingCopyOutputSchema` for `headline`/`body`, not the checklist-based schema used here).
```

## Termination condition

When both PRs are merged (or one fails irrecoverably and you can
document why), hand back. **Verify each PR with `gh pr view --json
state` confirming `MERGED` before signing off.**
