# Plan — Provider abstraction (fal + Replicate)

## Charter check

```
CHARTER_CHECK:
- Clarification level: MEDIUM
- Task domain: feature (provider abstraction)
- Must NOT do: (1) switch providers unilaterally without a flag, (2) delete fal code, (3) remove FAL_KEY from env, (4) touch unrelated routes
- Success criteria:
  * `src/lib/inference.ts` wraps both fal and Replicate behind a single interface
  * The 3 in-flight callers (inpaint submit/status, furnishings detection) go through the new interface
  * `INFERENCE_PROVIDER` env flag selects fal (default) or replicate
  * All previously-passing unit tests still pass with INFERENCE_PROVIDER=fal
  * New tests cover the Replicate adapter (10 tests) and the abstraction's pure-logic surface (8 tests)
  * Documented: how to flip the flag, how the model names differ, the env vars needed
- Assumptions:
  * User approved "Plan the swap in detail" + "Both: short-term demo + long-term plan"
  * Replicate's REST API is the right surface (no SDK dependency added)
  * Dual-run behind a flag for safety, with fal as the default
```

## Status: COMPLETE

## What was built

A provider-agnostic inference layer that lets the project swap between fal and Replicate by changing an env var, with **zero call-site churn** at the route level.

### New files

| File | Purpose |
|---|---|
| `src/lib/inference.ts` | Abstraction: `InferenceClient` interface, `LogicalModel` constants, `resolveProvider()`, `assertInferenceConfigured()`, `getInferenceClient()`, `InferenceRequestGoneError` (provider-agnostic 404 detection). |
| `src/lib/fal-adapter.ts` | Fal adapter. Re-uses the existing `src/lib/fal.ts` client singleton + circuit breaker. Translates `LogicalModel` to `fal-ai/...` ids. Re-throws 404s as `InferenceRequestGoneError`. |
| `src/lib/replicate-adapter.ts` | Replicate adapter. REST API client (no SDK dependency). Polls `predictions.create` + `predictions.get`. Translates Replicate's lifecycle strings (`starting`/`processing`/`succeeded`/`failed`/`canceled`) to `NormalizedStatus`. |
| `tests/inference.test.ts` | 8 tests pinning `LogicalModel`, `resolveProvider()`, and the `NormalizedStatus` union. |
| `tests/replicate-adapter.test.ts` | 10 tests pinning the Replicate wire format (URL paths, request bodies, status normalization, 404 translation). Uses a `globalThis.fetch` mock — no real network call. |

### Modified files

| File | Change |
|---|---|
| `src/lib/inpaint-status.ts` | `pollFalStatus` now calls `client.status(...)` and `client.result(...)` through the abstraction. `isInferenceRequestGone(error)` (replaces `isFalRequestGone`) accepts `InferenceRequestGoneError` from any provider. Function name kept (`pollFalStatus`) to avoid touching the route handler signature; docstring notes the rename as a future cleanup. |
| `src/lib/inpaint-submit.ts` | `submitInpaintToFal` resolves the active client and calls `client.submit(LOGICAL_MODEL.FLUX_FILL, ...)`. Payload still built via `buildInpaintPayloadForActiveProvider` which selects `buildFalFillPayload` or `buildReplicateFillPayload` based on `INFERENCE_PROVIDER`. |
| `src/app/api/segment/furnishings/route.ts` | `assertInferenceConfigured()` + `inference.subscribe(LOGICAL_MODEL.SAM_3_1_IMAGE, ...)`. |
| `src/lib/prompts.ts` | Added `buildReplicateFillPayload` (Replicate's wire shape) and `buildInpaintPayloadForActiveProvider` (provider-aware dispatcher). |
| `src/lib/env.ts` | Added `REPLICATE_API_TOKEN` to `ENV_VAR_DOCS`. |
| `src/lib/fal-spend-guard.ts` | `FAL_SPEND_CALL` regex now also matches `inference.subscribe` / `inference.submit` (the abstraction's call paths). `LEGACY_SAM_MODEL` negative lookahead fixed (was matching the live `fal-ai/sam-3-1/image` model id's `fal-ai/sam` prefix by mistake). |
| `tests/inpaint-submit-route.test.ts` | Mocks `@/lib/inference` instead of `@/lib/fal`. |
| `tests/inpaint-status-route.test.ts` | Mocks `@/lib/inference` instead of `@/lib/fal`; `mockInferenceStatus` / `mockInferenceResult` replace `falQueueStatus` / `falQueueResult` references. |
| `tests/api/inpaint-route.test.ts` | Mocks `@/lib/inference`; aliases `falQueueSubmitWithCircuitBreaker` to the mocked abstraction `submit` for assertion reads. |
| `tests/api/segment-furnishings-partial-masks.test.ts` | Mocks `@/lib/inference` instead of `@/lib/fal`. |
| `tests/api/uncapped-fal-calls.test.ts` | Legacy-model scanner now strips comments before testing (so the new `fal-adapter.ts` docstring explaining the retirement doesn't false-positive). |
| `.env.example` | Documented `INFERENCE_PROVIDER`, `REPLICATE_API_TOKEN`, and the per-provider model overrides. |

## Verification

- **2194/2194 unit tests pass** across 160 files (was 2176/2176 across 158 files; +18 new tests, 0 regressions).
- `tsc --noEmit` clean.
- `eslint` clean (0 errors; 36 pre-existing warnings, 3 of which are in the new files and are non-blocking).

## How to flip the provider

1. Set `INFERENCE_PROVIDER=replicate` in `.env.local` (and `REPLICATE_API_TOKEN=<token>`).
2. Restart the dev server.
3. The route handlers pick up the new provider automatically — no code change.

## What's NOT done (and why)

- **Live integration probe against the Replicate API — done (#1200).** `scripts/replicate-integration-probe.mts` + `.github/workflows/replicate-probe.yml` (PR #1208). The first hand-run on 2026-10-03 surfaced two wire-format mismatches the mocked tests had silently approved: (1) the request body sent `{ model: modelId, input }` but Replicate's current `/v1/predictions` API requires `{ version, input }` and rejects `model`; (2) `buildReplicateFillPayload` had `safety_tolerance: "2"` (string literal) and Replicate expected an integer. Both fixed in PR #1209 (`fix/1200-replicate-version-hash`): `resolveReplicateModel` → `resolveReplicateDeployment` returning `{ model, version }`; new `REPLICATE_FLUX_FILL_VERSION` env override; `safety_tolerance: 2` as a number; 6 new unit tests pinning the wire body shape on submit + subscribe and the payload's integer field. **Verified wire format (PASS, 2026-10-03 03:18 UTC, requestId `ptq252jx7srmr0d0zz2tj43t20`):** submit latency 198ms, 4 status polls, 5.1s end-to-end, output shape `string` (a single URL — not the array shape the original bullet predicted), `extractInpaintImageUrls` returned 1 URL, download 200 / image/png / 48,733 bytes. Nightly workflow at 08:17 UTC will run automatically going forward; 90-day artifact retention for trend analysis.
- **The Replicate response shape for FLUX.1 Fill Pro.** Originally predicted as `[url1, url2]`. The probe actually saw a single URL string (`outputShape: "string"`). `extractInpaintImageUrls` (`src/lib/inpaint-output.ts:44-47`) already handles the string envelope, so the poller chain is end-to-end correct for the wire shape Replicate currently emits. The array case is still covered (`#1199` follow-up) in case a future model version switches back to `num_outputs > 1`.
- **`pollFalStatus` keeps its name.** Renaming to `pollInpaintStatus` would touch the route handler. The docstring notes the rename as a future cleanup.
- **The `submit` retry wrapper is unchanged.** Issue #831's logic (3 attempts, 200ms base delay, no retry on 401/403) is provider-agnostic and works as-is.

## Out-of-scope findings (for other agents)

- The `submit` retry wrapper is hard-coded to FAL_SUBMIT_ATTEMPTS and FAL_SUBMIT_BASE_DELAY_MS (constants in `inpaint-submit.ts`). These were named for fal but apply to any provider. A rename is cosmetic; not done in this round.
- The `submit` retry policy is conservative (3 attempts, 200ms → 400ms → 800ms). Replicate may want different defaults — but for v1, one shared policy keeps the abstraction simple.
- The fal adapter's `result` method only supports the `images: [{url}]` shape. If a future fal model returns a different shape, the adapter needs a per-model parser (the Replicate adapter already takes the output as-is).
- No retry on `InferenceRequestGoneError` in the submit phase. A 404 from `predictions.create` (rare but possible) propagates up. Worth a follow-up: retry once with the same payload in case the requestId format was rejected.
