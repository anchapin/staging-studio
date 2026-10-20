# Handoff — post-gap-audit triage (partial)

Session date: 2026-10-20 · branch: `develop` · base: `7177b06`

Brief: `.handoffs/2026-10-20-post-gap-audit-triage-brief.md`
(Referenced by path; not restated here.)

## State

Working tree clean. `npm run typecheck` green. Full suite **2914 passed** (baseline
was 2903; +11 net). No issues closed yet — all findings are commented with evidence
and left open for the maintainer to close.

Commits landed on `develop`, in order:

| commit | issue | outcome |
|---|---|---|
| `49c2815` | #1418 | docs: recorded verified `logos`-bucket RLS invariant |
| `ec825f6` | #1420 | fix: atomic quota claim + refund + total-outage detection |
| `3bebbe0` | #1427 | perf: mask serialization coalesced to once per stroke |
| `642a199` | #1430 | docs: corrected drifted `AGENTS.md` Layout section |

## Done

### #1418 — security: `logos` bucket `upsert` (brief Task 1)

**The finding does not reproduce as written.** Probed the live project's Storage API
with the real `sb_publishable_…` anon key and the exact headers the app sends
(`x-upsert: true`). All three probes returned `403 AccessDenied — new row violates row
level security policy`: anon write to a new path, anon `upsert` over an existing path,
and anon `upsert` with an attacker-chosen `.svg` extension. No residue.

Live bucket config confirmed: `logos` and `room-photos` are both `public = true` with
`file_size_limit = null` and `allowed_mime_types = null`.

Per the brief ("policy is correct → document the invariant in-repo"), the invariant and
the probe results are recorded in `docs/SUPABASE-SETUP.md`.

**Open question deliberately not resolved** (needs a decision, not more digging):

- The probes ran *unauthenticated*. The RLS policy appears keyed to an authenticated
  user, so the scenario that actually matters — **user A logged in overwriting user B's
  logo** — is proven neither way. Settling it requires provisioning a second real
  account. Filenames embed `Date.now()`, which makes guessing hard, but the email half
  is attacker-suppliable and the timestamp is a small search space.
- The residual risk that *is* real needs no attacker: no server-side MIME/size
  validation exists on the logo path (`accept="image/*"` is a client-side hint only),
  and `logoUrl` renders as `src` in `cover-page.tsx` / `signoff-page.tsx`.

**Not applied, needs sign-off:** bucket-level `allowed_mime_types` + `file_size_limit`,
and serving logos under a non-executable content type. These are live mutations of the
production Supabase project.

### #1420 — reliability: `room-batch.ts` quota (brief Task 3)

Three defects, all confirmed and fixed:

1. **TOCTOU** — `evaluateDailyBatchQuota` gated, then a separate `recordDailyUsage`
   loop charged. Two concurrent batches could both pass the gate and both record.
   Replaced with `claimDailyQuota` (cap check + increment in one conditional
   `updateMany`).
2. **No refund** on failure — added `refundDailyQuota` (best-effort, never throws).
3. **Not in the issue, found by the new test:** the per-image `catch { return "Other" }`
   swallowed every failure, so `Promise.all` always resolved and the outer `catch` was
   **unreachable**. A total upstream outage returned `{ success: true, roomTypes:
   ["Other", …] }` while keeping the quota — silently wrong data reported as success.
   Failures are now counted; an all-failed batch throws, fails loudly, and refunds.

Also moved the **ownership check ahead of the quota claim**, so a non-owner can neither
consume nor refund the caller's quota.

`tests/room-batch-action.test.ts` rewritten — it previously pinned the buggy behaviour
by mocking `evaluateDailyBatchQuota`/`recordDailyUsage`. Now 4 cases: atomic claim,
single call with full batch size, full-batch refund, ownership ordering.

### #1427 — perf: `MaskLayer` `toDataURL` per `pointermove`

Fixed. `stroke()` (the `pointermove` handler) ended in an unconditional `emitChange()` →
full-canvas `toDataURL("image/png")`. Now mid-stroke moves only mark dirty; the encode
happens once at the terminal event.

| scenario | before | after |
|---|---|---|
| 20 strokes x 25 moves | 500 encodes | **20** |
| 1 stroke x 200 moves | 200 encodes | **1** |

**#1344 is preserved**, and two holes are closed that the naive fix would have opened:
unmount flushes a pending change, and a stroke whose `pointerup` never arrives (pointer
cancelled / capture lost) is drained at the start of the next stroke rather than losing
its final state.

Policy extracted to `src/lib/mask-emission-coalescer.ts` (pure, React-free, DOM-free)
because the repo runs vitest with `environment: "node"` and has **no jsdom** — the
component's pointer handlers cannot be driven directly. 9 new cases.

### #1430 — docs: `AGENTS.md` Layout drift

Fixed. The section described the pre-#1346 editor. Confirmed all 5 reported paths dead;
found that **10 of 12** documented co-located hooks never existed in `src/`.

Also corrected: stale counts ("~65 modules / 63 of 76" → **143 modules, 125 pinned**,
measured); ~13 non-existent modules listed and 7 missing ones added; `/api/v1` tree
documented including the export-route error-mapping disagreement; omitted
`inpaint/webhook` + `lookbook-variant` routes and undocumented `room-*` actions added;
removed a reference to an `ops/` directory that does not exist; recorded that all
`tests/` subdirectories are discovered.

Verified by script: every literal `src/…` / `tests/…` path in the edited sections
resolves, except the one deliberate "was deleted" reference.

## Not started

### #1428 — `tests/lib/` discovery blind spot — **no bug, close it**

Premise is false. `tests/lib/` holds 19 files / 309 tests, all discovered and passing.
Full audit: **210** `.test.ts` files on disk vs. **232** discovered entries; a
`comm` set-difference returns **empty** — every unit test file is picked up.

Why it's safe: the `exclude` in `vitest.config.ts` is *additive* (removes only
`tests/e2e/**`); it does not whitelist top-level `tests/*.test.ts`. Any subdirectory
added later is discovered automatically. Commented with evidence; recommend closing.
If belt-and-braces is still wanted, the durable version is one assertion (discovered
count == on-disk count) in an existing test, not a new mechanism.

### #1421 — refund-on-retry/complete-path + billed-but-unmapped provider jobs

Not started. Reads as the **highest-value remaining item**: item 3 (a billed provider
job whose `providerJobId` DB write fails) leaks real spend with no durable row, and the
brief's own note says `room-batch.ts` and the segment route are the cheaper first step.

Start by reading `lib/api-quota.ts` — `claimDailyQuota` and `refundDailyQuota` already
exist, so these are call-site bugs, not missing infrastructure.

### #1429 — brief Task 2, the one task not yet re-read

Was deferred to protect turn budget; **read `tests/inpaint-submit-route.test.ts` and
`src/app/api/inpaint/route.ts` before starting.** Note the file is 372 lines with a
297-char line at :119, so part of the ask is line length.

## Carry-over notes for whoever continues

- **Brief claims are worth re-verifying; several were stale.** `ops/` doesn't exist,
  `tests/lib/` is not a blind spot, `timeInStage`/`overdue-instructions` (#1416) don't
  exist in `src/` at all. Verify before implementing.
- **#1416 may be obsolete.** Its symbols (`timeInStage`, `overdueInstructions`) are
  absent from the entire repo — no `ops/` either. Likely closed by the legacy-shell
  removal. Confirm before spending time.
- **Landing spot:** `develop` is unprotected and ordinary work is pushed there directly.
- `tests/room-batch-action.test.ts` intentionally uses `expect.any(Number)` for the quota
  limit rather than importing `DEFAULT_DAILY_LABEL_LIMIT` — a top-level import hoists
  above the `vi.mock` factories and breaks module init.