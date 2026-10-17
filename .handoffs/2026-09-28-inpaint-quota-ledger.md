# Session Handoff Checkpoint

**Timestamp:** 2026-09-28T19:05:00Z
**Branch:** `develop` — pushed `e0d63fec`, CI green (run `36490393866`: `Lint · Typecheck · Unit tests` ✓, `E2E (Playwright)` ✓, `Release guard` correctly skipped on a push).
**Task:** Fix **#1131** (critical) — done, pushed, closed. **#1157** (critical) is next, nothing in flight.

## 1. Accomplished This Session

**#1131 fixed and closed** (`e0d63fec`): `DAILY_INPAINT_LIMIT` was enforced by COUNTING today's `InpaintRequest` rows, which cascade-delete with the room (`prisma/schema.prisma:102`), so `deleteRoom` (or a project delete) restored the whole cap at zero cost, repeatably, destroying the only durable record of the spend.

- **No schema change was needed** — the obvious reading of the issue ("add a ledger table") is already satisfied: `DailyApiUsage.surface` is a plain `String` and the model declares **no relation at all**, so no delete in the app can reach a counter row. The fix was to add `"inpaint"` to `QuotaSurface` and move the surface onto the existing table. The `.env` symlink / `db push` step in the old plan was unnecessary — do not pay that cost on a future issue that turns out to be a `surface` key.
- **Read**: `checkDailyQuota` (`src/lib/inpaint-submit.ts`) → `getDailyUsage("inpaint", userId)`; same swap in the two v1 stubs (`api/v1/inpaint/route.ts`, `api/v1/inpaint/[requestId]/route.ts`), which spend nothing and so only read.
- **Charge**: new `recordInpaintQuotaWithRetry(userId)` in `lib/inpaint-submit.ts`, called from `submitInpaintRequest` once the fal job is queued and billed — deliberately **before** the `InpaintRequest` record write, with #688's bounded-retry/degrade discipline, and surfacing `quotaChargeDegraded` on the response so an uncharged bill is visible instead of silently free. `submitInpaintRequest` now takes `userId` in params.
- **Deleted, not gated**: `inpaintDailyUsageWhere` and its test — leaving it exported would keep the bug one import away.
- **Docs**: `AGENTS.md` and `.env.example` described the row count as exact; corrected. The remaining in-flight check-then-act window is stated and stays tracked (#1111, #1132).

**Guards added, each verified by reinstating the bug (this found real holes; budget for it):**

| Guard | What it pins | Reinstating the bug gave |
| --- | --- | --- |
| `tests/api-quota-ledger.test.ts` (9) | behaviour (cap ignores deletable rows both ways), code (no `inpaintRequest.count` in `src/`; every cap reader **calls** `getDailyUsage`; the submit path charges), schema (`DailyApiUsage` cannot cascade-delete) | row count → 5 fail; cascade relation → 1 fail; charge removed → 1 fail |
| `tests/e2e/specs/inpaint-quota-ledger.spec.ts` (2) | real handler: ledger at cap + rooms deleted → 429 with the ledger's `used`; one below → 404 | 429 test failed with **404**, control still passed |
| `tests/inpaint-submit-route.test.ts` (+4) | charge happens, ordered before the record write, degrades without losing the requestId | 4 fail with the charge removed |
| `tests/api/inpaint-route.test.ts` (+2) | cap reads the ledger, never counts rows; a blocked request charges nothing | — |

The e2e spec is **hermetic by construction**, not by luck: the room under test is deleted, so a regression stops at the 404 ownership check and `fal.queue.submit` is unreachable in both the passing and failing case. Keep that property if the spec is extended.

## 2. Modified Files

`e0d63fec` — 15 files. Source: `src/lib/api-quota.ts`, `src/lib/inpaint-submit.ts`, `src/app/api/inpaint/route.ts`, `src/app/api/v1/inpaint/route.ts`, `src/app/api/v1/inpaint/[requestId]/route.ts`. Docs: `AGENTS.md`, `.env.example`. Tests: `tests/api-quota-ledger.test.ts` (new), `tests/e2e/specs/inpaint-quota-ledger.spec.ts` (new), `tests/e2e/quota.ts` (`withExportUsageAtLimit` refactored onto a shared `withUsageAtCount`, + `withInpaintUsageAtLimit`), `tests/e2e/env.ts` (`E2E_DAILY_INPAINT_LIMIT`), `tests/api-quota.test.ts`, `tests/api/inpaint-route.test.ts`, `tests/inpaint-submit-route.test.ts`.

Untracked, **pre-existing, not ours — leave alone:** `docs/dana-rig/.triage-baseline.json`, `docs/dana-rig/triage-summary.md`.

## 3. Current Verification State

- `npm test` → **2096 passed / 0 failed** (153 files). Up 16 from 2080: 9 + 4 + 2 added, 1 deleted, 2 net in `api-quota.test.ts`.
- `npm run e2e` → **64 passed / 0 failed** (3.0m). Trailing `prisma:error … unexpected postmaster exit` lines are teardown noise.
- `npm run lint` → clean (1 **pre-existing** `layout.tsx` `no-page-custom-font` warning). `npm run typecheck` → clean. `npm run build` → clean.
- `tsconfig.json` → `"jsx": "preserve"` (reverted with `git checkout HEAD --` after the build; the pre-commit guard passed).
- Open issues 61 (was 62; #1131 closed). `release:check` unaffected.

## 4. Immediate Next Step

**#1157 (critical) — the Dockerfile cannot build.** A contained ~15-line fix, unrelated to the quota work, so it pairs cleanly as a second self-contained win.

1. `gh issue view 1157` and read `Dockerfile` end to end before editing.
2. The known shape: `public/` does not exist in the repo, `Dockerfile:37` copies it, and the runner stage ships **no `node_modules`** — verify both against the current file rather than trusting this line.
3. Verify with a real build: `docker build -t staging-studio:1157 .` (Docker is available in this environment), not just a lint of the file.
4. Then **#1132** (atomic quota claim) — larger, interacts with #1110/`evaluateDailyBatchQuota`, deserves its own session. Cheap and high-signal: **#1108** (segment/furnishings route test), **#1151** (`.env.example` pre-#784 drift — note this session already fixed the three quota-mechanism lines in that file, so re-read it before starting), **#1100** (~5 min, docs only).

## 5. Traps — read before acting

Everything from the previous handoff still applies (e2e harness cannot run twice concurrently; `ci-wait` rejects a SHA; revert `tsconfig.json` with the **HEAD** form; never `rm` a possibly-tracked file; `gh issue create --label` validates every label or creates nothing; Browserless request log is process-wide, slice by count delta). Added this session:

- **A ledger table is usually already there.** Read the Prisma model before designing one: `DailyApiUsage.surface` is a plain `String`, and the model has **no** FK to `User`, so it is already immune to the cascade that caused #1131. Check whether a "missing table" issue is really a missing *key*.
- **A ledger read alone is not a fix** — a counter nobody writes is an always-allow cap. Pin the charge explicitly (the `the submit path charges the ledger` test exists because the read-side guards all passed with the charge deleted).
- **A text guard needs its own non-vacuity test.** The cap-reader list is asserted by exact equality (`expect([...]).toEqual([...3 files])`) because a pattern that matched zero files would make the loop pass silently. Same idea as the #1105 guard's "discovers routes from disk" test.
- **Match a consumption, not a mention.** `DAILY_INPAINT_LIMIT` also appears in the module that *defines* it, so the reader pattern had to be `process.env[DAILY_LIMIT_ENV_VAR.inpaint]`, not the bare constant name.
- **The e2e room-deletion trick keeps a quota spec hermetic**: seed a room + a child row, delete the room, and every response is a pre-provider 4xx/429 — so the spec can drive the *real* handler (which `page.route` cannot, #1084) without ever reaching fal.
