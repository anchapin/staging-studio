# Wave-5 revival plan — `wave5-issue933` decomposed-route followup

Session: `2026-10-19-wave5-revive-plan` (planning only; execution deferred to a fresh session).

Branch: `main` (clean, synced with `origin/main` = `b0b9ee2`).
Last commit: `b0b9ee2` ("docs(handoffs): add Oct 19 housekeeping followups draft + DONE (#1398)").

## Context (read first)

Issue **#1389** ("`[housekeeping] abandoned branch: wave5-issue933`") flagged
an abandoned branch whose work was *partially* landed via PR #962 — but only
1 of 5 route decompositions made it onto `develop`. Per the user, the right
disposition is to **revive the branch** to land the remaining 4, not close
the ticket as `not planned`.

Both **PR #960** (the original closed wave-5 PR) and **PR #962** (the
followup that landed only 1 of 5 decompositions) are part of the `anchapin/staging-studio`
history — the abandoned branch tip `14d043d` from 2026-09-25 no longer
exists on `origin` (it was abandoned and pruned). **The revival must
re-derive the diff from `main`**, not cherry-pick from `wave5-issue933`.

## What's already landed (develop as of `d47bb5e`)

| Wave-5 service module | State | Source |
|---|---|---|
| `src/lib/inpaint-status.ts` | ✅ landed | PR #962 (c30b0c5: "decompose: split inpaint-status route into composable utilities") |
| `src/lib/inpaint-submit.ts` | ✅ landed | PR #962 (inpaint-route submit split) |

So the `/api/inpaint` route is **already fully decomposed**. The 4 that are
NOT decomposed (per the wave-5 pattern of "thin route handler + pure
`src/lib/<service>.ts`"):

| Route handler | Lines | Decomposition status | Re-execution sibling issue |
|---|---|---|---|
| `src/app/api/export-pdf/route.ts` | **365** | monolithic | (none — `#1396` only covers inpaint) |
| `src/app/api/generate-copy/route.ts` | **444** | monolithic | (none — covered by AGENTS.md `ai-route-schemas`) |
| `src/app/api/label-instances/route.ts` | **221** | monolithic | `#1397` |
| `src/app/api/segment/furnishings/route.ts` | **298** | monolithic | `#1397` (re-execution covers both label + segment) |

Total: **1328 monolithic lines** across 4 handlers, holding all of:
- Session + ownership checks
- Quota enforcement
- Upstream provider calls
- Result normalization / persistence
- Response shaping / error envelopes

Per AGENTS.md, API routes and server actions are required to "enforce
sessions and ownership themselves (via `src/lib/api-auth.ts`); every new
mutation endpoint must do the same." Each monolithic handler concentrates
~6+ concerns, which makes them both long and dangerous to evolve.

## Target shape (the wave-5 pattern, derived from `room-variant-service.ts`)

For each route, decomposition yields:

```
src/lib/<service>.ts                          # pure logic, no I/O imports beyond Prisma + quota
tests/<service>.test.ts                       # vitest unit tests (existing pattern)
src/app/api/<route>/route.ts                  # shrinks to: request parse → ownership check → quota → service → respond
```

**Conventions** (per AGENTS.md "Layout"):
- Pure logic, named exports, no side effects beyond DB writes via Prisma.
- 1:1 test pinning: each `src/lib/<name>.ts` should be matched by
  `tests/<name>.test.ts` unless exempted. There are 63 such pinned pairs
  today.
- Reuse existing helpers: `src/lib/api-auth.ts` (`getApiUser`),
  `src/lib/api-quota.ts` (`enforceQuota`), `src/lib/error-classify.ts`
  (where it exists), and the unifying error-envelope pattern (added in
  PR #960 / #962).
- Errors should map to a normalized shape per the wave-5 unified handler
  (`{ error: { code, message, detail? } }`); preserve existing 4xx/5xx
  codes so the e2e suite (export-pdf suite in particular) does not regress.

## Per-route decomposition plan

### 1. `/api/export-pdf` → `src/lib/export-pdf-service.ts`

**Functions (target exports, pure):**
- `resolvePreviewUrl(appUrl, projectId)` → string. Mints the
  HMAC-signed preview token (`lib/preview-token.ts`) and assembles the
  cookie-less print URL Browserless fetches.
- `resolveBrowserlessEndpoint()` → URL. Pulls the E2E-override switch
  via `lib/browserless.ts#resolveBrowserlessPdfUrl` so the hermetic
  e2e suite keeps working.
- `exportProjectPdf({ projectId, userId }, deps)` → `{ status,
  body }`. Owns: ownership check (the project's `User` matches),
  Browserless dispatch, env validation. Returns the same envelope
  shape the current handler emits.
- `assertExportQuotaConsumed(userId)` → void. Calls
  `lib/api-quota.ts#consumeQuota('export', userId)`. Quota counts are
  `DailyApiUsage` rows; **NOT** an in-process map (AGENTS.md #784).

**Test pin (must exist before merging):**
- Happy-path `202/200` envelope.
- Ownership fail → `403` with `error.code = "forbidden"`.
- Upstream `503` (Browserless unavailable) → MUST flatten to `500
  invalid-request` for `/api/v1/export-pdf`; `/api/export-pdf`
  propagates raw `503`. **They disagree by design** (AGENTS.md "Two
  mocking strategies" §).
- Quota exhausted → `429` (uses `withExportUsageAtLimit` fixture).
- `E2E_HERMETIC=1` switch flips endpoint to mock — verify the seam
  works without changing tests.

### 2. `/api/generate-copy` → `src/lib/generate-copy-service.ts`

**Functions (target exports):**
- `generateCopyForProject({ projectId, userId, promptOverrides }, deps)`
  → `{ copy: CopyPayload }` or `{ error }`. Owns project lookup,
  quota enforcement (`'copy'`), gpt-4o-mini call via
  `lib/ai.ts#aiModel`, response validation against
  `ai-route-schemas.ts#copySchema`.
- `parseGenerateCopyRequest(body)` → `Result<{ projectId, prompt? }, ApiError>`.
  Thin Zod parse.

**Test pin:**
- Valid request → copy payload.
- Invalid Zod payload → `400 bad-request`.
- Missing project → `404 not-found`.
- Wrong owner → `403 forbidden`.
- Quota exhausted → `429`.
- gpt-4o-mini returns nonsense → `502 invalid-request` (response-shape
  mismatch).

### 3. `/api/label-instances` → `src/lib/label-instances-service.ts`

**Functions:**
- `labelInstancesInRoom({ roomId, projectId, userId }, deps)` →
  `{ labels: VisionLabel[] }`. Owns ownership chain (project → room),
  quota (`'label'`), gpt-4o-mini label-instance call, caching against
  `VisionLabel` (unique on `imageUrlHash + concept + instanceIndex` per
  AGENTS.md "Domain model").

**Test pin:**
- Cache hit → 1 provider call.
- Cache miss → provider call + cache write.
- Wrong owner → `403`.
- Quota → `429`.

### 4. `/api/segment/furnishings` → `src/lib/segment-furnishings-service.ts`

**Functions:**
- `segmentFurnishingsInRoom({ roomId, imageUrl, userId }, deps)` →
  `{ instances: DetectedInstance[] }`. Owns ownership, quota
  (`'segment'`), DashScope SAM 3.1 call (per AGENTS.md
  ALIBABA_INPAINT_MODEL notes), result normalization via
  `lib/segment-mask.ts` and `lib/segment-timing.ts`.

**Test pin:** analogous to label-instances.

## Execution outline (for the executing session)

1. **Branch.** `git switch -c feat/wave5-issue933-revival origin/main`.
   Optional second-branch strategy: one PR per route, all touching
   `src/lib/<service>.ts` and `src/app/api/<route>/route.ts` only.
2. **Per route, in this order** (smallest to largest, easiest to PR
   first):
   1. `/api/label-instances` (221 lines) → 1 PR.
   2. `/api/segment/furnishings` (298 lines) → 1 PR.
   3. `/api/export-pdf` (365 lines) → 1 PR.
   4. `/api/generate-copy` (444 lines) → 1 PR.
3. **For each PR:**
   - Create `src/lib/<service>.ts` with the exports above.
   - Create `tests/<service>.test.ts` (vitest).
   - Reduce `src/app/api/<route>/route.ts` to thin handler: parse →
     authenticate → quota → service → respond.
   - Run `npm run lint`, `npm run typecheck`, `npx vitest run
     tests/<service>.test.ts`.
   - Push branch, open PR. CI must pass: `Lint · Typecheck · Unit
     tests` (required) and `Docker image builds`. E2E is push-only
     so it doesn't run on PRs.
   - Squash-merge via the ritual in AGENTS.md "Releasing to
     Production" (this PR is a feature, not a docs handoff — go via
     the normal release flow).
4. **After all 4 PRs merged:**
   - Close #1389 as `completed` (the work landed).
   - Close #1394, #1396, #1397, #1395, #1393 as `superseded` (each
     one is now landing) — only the re-execution siblings need
     decision-by-decision review; some may stay open as
     historical-context carryovers.
   - Close parent #1392 as `completed`.
   - Open a fresh tracking issue if any of the PRs reveal a followup
     gap.

## Risks and constraints

- **The wave-5-original 50-file PR #962 left a complex error-envelope
  pattern.** If the revival reproduces it 4× across 1328 lines, the
  four new service modules must share **the same envelope shape** —
  extract it once (per AGENTS.md software-design-philosophy: "deep
  modules, not shallow utilities").
- **Export-pdf has E2E_SPECIFIC_OVERLOAD via `E2E_HERMETIC=1` +
  `E2E_BROWSERLESS_PDF_URL`** — must be wired through the service
  module, NOT just patched into the route. Otherwise the hermetic
  suite breaks. AGENTS.md "Two mocking strategies" §.
- **Two `/api/export-pdf` and `/api/v1/export-pdf` disagree on
  upstream-error mapping** (503 vs 500). Confirm which route each PR
  decomposes; `/api/v1/export-pdf` already exists per AGENTS.md
  "Domains: API versioning". If both routes hit the same service, the
  envelope normalization lives in the route, not the service —
  service returns the upstream status verbatim.
- **Quotas use the `DailyApiUsage` Postgres counter** (not in-process
  Map). Service modules MUST go through `lib/api-quota.ts`. Direct
  Prisma writes to `DailyApiUsage` from a route will race.
- **Max 40-50 turns per session** (AGENTS.md "Turn Budget"). This
  plan is a 4-PR engagement. Each PR is itself 1 session. **Do not
  try to do all 4 PRs in one executing session.**
- **Don't run `npm audit fix --force`** (AGENTS.md #1220 still
  applies — the `braces` override stays).

## Decisions to surface back to the human

- **One PR per route, OR one mega-PR for all four?** The mega-PR is
  faster to land (one merge cycle) but harder to review/revert. The
  per-route split is preferred — each is 200-450 lines of
  refactor with tests, which is right at the PR review-budget
  sweet spot.
- **Hold or update the [AGENTS.md "Layout"] bullet list** after
  each `src/lib/<service>.ts` lands, so the canonical module list
  stays current. Or defer until all 4 land (4 separate updates
  is noisy).
- **The two re-execution sibling issues (#1395–#1397)** that
  reframe this work in a different shape — keep them open as
  historical context, or close as `superseded` once revival lands?

## Refs

- Issue #1389: `[housekeeping] abandoned branch: wave5-issue933`.
- PR #960: closed wave-5 PR (decomposed 5 routes in spirit).
- PR #962: landed followup (only `inpaint-status` decomposition).
- AGENTS.md "Layout" — `src/lib/` conventions.
- AGENTS.md "Two mocking strategies" — export-pdf E2E seam.
- AGENTS.md "Turn Budget" — 40-50 turns per session cap.
- AGENTS.md "Releasing to Production" — release-merge ritual.
- AGENTS.md "API versioning" — `/api` and `/api/v1` disagreement
  on error mapping.
- Closeout: `.agents/handoffs/archive-2026-10-19/2026-10-19-housekeeping-closeout-state-note.md`
  (the consumed predecessor memo).

## State after this planning session

- No code changes.
- No branches created.
- No PRs opened.
- Issue #1389 remains open.
- Parent #1392 remains open.
- Re-execution issues #1393, #1394, #1395, #1396, #1397 unchanged.
- Local `main` synced with `origin/main` (`b0b9ee2`).
