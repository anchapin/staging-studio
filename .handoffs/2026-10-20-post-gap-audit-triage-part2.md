# Handoff — post-gap-audit triage, part 2

Date: 2026-10-20 · branch: `develop` (unpushed) · HEAD: `6425af9`

Predecessor brief: `.handoffs/2026-10-20-post-gap-audit-triage-brief.md`
Predecessor results (⚠️ partly wrong, see below): `.handoffs/2026-10-20-post-gap-audit-triage-results.md`

---

## ⚠️ Read this first: a mistake in the previous session

The previous session **reported on #1428 and #1429 without ever reading their issue
bodies.** It carried over the *brief's* claims about those files and substituted them for
the actual issues, then concluded "#1428 is already fixed, close it."

**That conclusion was about the wrong issue.** #1428 is a real, live, unfixed autosave
UX bug. #1429 is a real, unstarted Rust performance task. Neither was touched.

The previous session's results file repeats this error — **do not trust its #1428/#1429
sections.** Its #1418/#1420/#1427/#1430 sections are accurate and independently verified.

**Standing rule for this session: read the issue body before doing anything.** Verify
symbols exist in the tree before believing any claim about them, in the brief, in an
issue, or in a prior handoff.

---

## Current state

Working tree clean. `npm run typecheck` green. Full suite **2914 passed / 233 files**
(baseline was 2903; +11 net from this work).

**5 commits are unpushed** on `develop`. `develop` is unprotected and ordinary work is
pushed there directly, so this is the normal landing path.

| commit | issue | outcome |
|---|---|---|
| `49c2815` | #1418 | docs: verified `logos`-bucket RLS invariant |
| `ec825f6` | #1420 | fix: atomic quota claim + refund + total-outage detection |
| `3bebbe0` | #1427 | perf: mask serialization coalesced to once per stroke |
| `642a199` | #1430 | docs: corrected drifted `AGENTS.md` Layout section |
| `6425af9` | — | docs: the previous (partly wrong) handoff |

Issue states: **#1418 closed** (`COMPLETED`, by the maintainer). #1420, #1427, #1430 fixed
with evidence posted but **left open** for the maintainer to close. #1421, #1416, #1417
untouched. #1428, #1429 untouched and mis-reported.

---

## Step 1 — Push the 5 commits

Green, self-contained, and blocking everything else from being reviewable:

```bash
git push origin develop
```

---

## Step 2 — #1428 (do this next; cheapest real fix)

**Issue:** two of three autosave paths (listing copy, FineTune sliders) have no
observable failure state, and `EditRoomStudio.tsx` references a `_`-prefixed dead
variable that exists only to silence its own unused-variable error.

### Verified live defects

1. **`project-detail-view.tsx:638`** — `const [, setFineTuneStatuses] = useState<…>`.
   The value is **discarded**. Line 664 writes into it
   (`setFineTuneStatuses((prev) => ({ ...prev, [roomId]: status }))`), so FineTune
   statuses are recorded and never read. A failed FineTune save is invisible.
2. **`EditRoomStudio.tsx:299`** — `const _copyAutosave = copyAutosaveRef.current;`
   preceded by an `eslint-disable-next-line @typescript-eslint/no-unused-vars`. Dead.

### Scope is smaller than the issue assumes

- `setFineTuneStatuses` **already exists**; most of the work is surfacing the value.
- `AutosaveController` already emits status via `onStatusChange?: (status:
  AutosaveStatus) => void`, with `AutosaveStatus = "idle" | "dirty" | "saving" | "saved" |
  "error"` (`src/lib/autosave-controller.ts:30,38`).
- `directiveStatuses` (`project-detail-view.tsx:555`, consumed at `:1318`) is the
  **in-repo precedent** — mirror its shape for FineTune.
- Existing tests to mirror: `tests/autosave-controller.test.ts`,
  `tests/autosave-copy.test.ts`.

### Acceptance

- FineTune autosave status reachable and rendered; an `"error"` status is observable.
- `_copyAutosave` and its `eslint-disable` deleted, **with the copy-autosave status still
  surfaced by some real path** — do not simply delete the line and reintroduce the bug
  the issue is about. If copy status genuinely has no consumer yet, say so in the commit
  message rather than quietly dropping the wiring.
- Unit test pinning the new status plumbing.

---

## Step 3 — #1429 (largest; understand before estimating)

**Issue:** `image-data.rs` flood-fill / morphology rebuilds its kernel **per pixel**,
freezing the editor for seconds on large masks. Ask: chunked or incremental, keeping
results visually identical.

Two things to establish **before** estimating:

1. **Where is the Rust?** The previous session found no `.rs` files when it looked —
   confirm whether this is in-repo, a submodule, a WASM crate, or a vendored dependency.
   If it is not in this repo, this issue cannot be fixed here and needs re-routing.
2. The correctness bar: "visually identical" means the kernel is rebuilt per pixel
   *because* that is what makes it correct at borders. Any chunking must preserve edge
   behaviour exactly, and it needs a regression test against the current kernel.

Do not "optimize" this by loosening correctness. The existing per-pixel rebuild is
suspiciously deliberate.

---

## Step 4 — #1421 (money paths; care over speed)

Quota refunds on retry/complete paths, plus a **billed-but-unmapped provider job**: when
the provider call succeeds but the `providerJobId` DB write fails, real spend is leaked
with no durable row to reconcile against.

`claimDailyQuota` and `refundDailyQuota` **already exist** in `src/lib/api-quota.ts` (see
the `claimDailyQuota` conditional `updateMany` and the best-effort `refundDailyQuota`,
which never throws — a refund failure leaves usage over-counted, the conservative
direction). So these are **call-site bugs, not missing infrastructure**.

The issue notes `room-batch.ts` and the segment route are the cheaper first step —
`room-batch.ts` was just fixed for the same class of bug in `ec825f6`, so that pattern is
fresh.

---

## Step 5 — #1417 (needs a decision, not just code)

API parity / duplication across the unversioned and `/api/v1` route trees.
`export-pdf` is 247 lines unversioned vs. 330 under `/api/v1`; the v1 route does reach
`resolveBrowserlessPdfUrl` and `claimDailyQuota` (4 shared call sites).

The load-bearing fact, already documented in `AGENTS.md`: **the two export routes
disagree on upstream-error mapping.** Unversioned `export-pdf` propagates the provider's
status (a 503 surfaces as 503); `/api/v1/export-pdf` flattens the same 503 to a 500
`invalid-request`. Both are pinned by their specs.

That may be **intentional** — a deliberate public-contract difference. Ask before
refactoring toward a shared implementation, because deduplicating them would silently
change a pinned public behaviour.

---

## Step 6 — #1416 (probably just close it)

Its symbols — `timeInStage`, `overdueInstructions` — are **absent from the entire repo**,
and the `ops/` directory it references does not exist either. Likely closed out by the
legacy-shell removal. Confirm with one `grep`, then close as obsolete.

---

## Carry-over notes

- **#1418 residue (deliberately not applied).** The bucket hardening —
  `allowed_mime_types` (`image/png`, `image/jpeg`, `image/webp`), a sane
  `file_size_limit`, and serving logos under a non-executable content type — is a **live
  mutation of the production Supabase project** and was left for explicit sign-off.
  Residual risk is real and needs no attacker: there is **no server-side MIME/size
  validation** on the logo path (`accept="image/*"` is a client-side hint only) and
  `logoUrl` renders as `src` in `cover-page.tsx` / `signoff-page.tsx`.
  Also unproven: the **logged-in** cross-tenant overwrite (user A overwriting user B's
  logo) — the probes that passed were unauthenticated; settling it needs a second real
  account.
- **Testing constraint:** vitest runs `environment: "node"` with **no jsdom**. Component
  pointer handlers cannot be driven directly — extract pure logic into
  `src/lib/<name>.ts` and pin it 1:1, per the repo's own convention. This is why #1427's
  policy became `src/lib/mask-emission-coalescer.ts`.
- **Mock-hoisting gotcha:** in `tests/room-batch-action.test.ts` the quota limit is
  asserted with `expect.any(Number)` rather than importing `DEFAULT_DAILY_LABEL_LIMIT` —
  a top-level import hoists above the `vi.mock` factories and breaks module init.
- **After any `next build`/`next dev`:** `tsconfig.json` gets rewritten (`jsx:
  "preserve"` → `"react-jsx"`). Use `git checkout HEAD -- tsconfig.json` before
  committing — bare `git checkout --` restores from the index and will not undo a staged
  flip. See the "Toolchain quirks" section of `AGENTS.md`.