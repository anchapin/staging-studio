# Session Handoff Checkpoint
**Timestamp:** 2026-09-28T23:55:00Z
**Repository:** staging-studio
**Branch:** `fix/1084-export-pdf-server-side-mock` (branched from `develop` @ `4d8bfea1`) — **PR #1094 open, mergeable, not yet reviewed or merged**
**Task:** #1084 — the last remaining hermetic-e2e failure cluster. **FIXED.**

## 1. Status: hermetic e2e suite is fully green

**55 passed / 0 failed** — the first time this suite has been completely green. Was 53 passed / 2 failed.

PR #1094 references #1084 (`Closes #1084`) but is **awaiting review**. The next action is review/merge, not more code.

## 2. What the previous session got wrong (two false premises)

This session's main value was refusing the handoff's planned fix after checking it. Both of #1084's first two options were unsound:

1. **The handoff's "preferred" fix (issue option C) was impossible.** It said to swap `page.request.post` for `page.evaluate(() => fetch(...))` "so `page.route` applies." It would not have worked: the interception glob targets `chrome.browserless.io/pdf`, a URL **only the Next.js server fetches**. `page.route` intercepts browser-context traffic; the browser never makes that request. Issuing the *client's* call from the browser does not route the *server's* outbound fetch anywhere new. The `interceptBrowserlessPdf` helper was dead code that silently never fired — which is why the suite was calling the **real paid Browserless API with a dummy key** and asserting against its 401.
2. **"Redundant with `export.spec.ts`" (option A) was false.** `export.spec.ts`'s `interceptExportPdf` mocks the app's own `/api/export-pdf` route, so the real handler never runs — it only covers toast rendering. The two tests were the sole coverage of the handler's auth, ownership check, quota, preview-token minting, verified-PDF 502 guard, and upstream-status mapping.

A **third defect nobody had caught**: the outage test asserted HTTP **500**, but the route's generic non-ok branch returns `{ status: chromeResponse.status }` — it *propagates* the provider status (only 401/403 and 429 get dedicated branches), so a 503 upstream surfaces as **503**. That assertion would have failed even with a working mock.

Decision route: Foreman was asked, **abstained** (0.53 confidence) but ranked "gated server-side mock seam" at 0.72 vs. B 0.47 / D 0.25 / A 0.08. Surfaced to the human with that signal; **the user chose the gated seam (option C)**.

## 3. What shipped (PR #1094, 13 files, +395/-43)

- **`src/lib/browserless.ts`** — new pure `resolveBrowserlessPdfUrl(hermetic, override)`. Honors the override **only** when `E2E_HERMETIC` is exactly `"1"` *and* the override is non-blank; else the real endpoint. Raw env passed in by the caller (matches `resolveDailyLimit`), so it stays pure. `buildBrowserlessPdfUrl` untouched and still pins the credential-free default.
- **`src/app/api/export-pdf/route.ts`** — resolves its endpoint through the gated resolver. Production behavior identical (both vars unset).
- **`tests/e2e/mock-browserless.ts`** (new) — local mock PDF endpoint following the `mock-supabase.ts` pattern: HTTP control/inspection endpoints, because specs run in a separate worker process.
- **`tests/e2e/env.ts`** — `MOCK_BROWSERLESS_*` constants, `E2E_HERMETIC=1` + `E2E_BROWSERLESS_PDF_URL` in `nextEnv()`, and the hermeticity contract docstring updated to record the deliberate exception.
- **`tests/e2e/{global-setup,global-teardown,helpers}.ts`** — start/stop the mock; `setMockBrowserlessOutcome()` / `mockBrowserlessRequests()` accessors.
- **`tests/e2e/specs/export-pdf.spec.ts`** — dead `interceptBrowserlessPdf` deleted; outage test now asserts 503 + `pdf-generation-failed` + `retryable`; success test additionally pins that the key rides in the `Authorization` header (not the URL) and the body carries `/preview/<id>?token=`.
- **`tests/browserless.test.ts`** — 5 new resolver tests, including that a stray override is inert for *every* flag value other than `"1"` (the production guard is actually pinned, not just documented).
- **`tests/api/export-pdf-route.test.ts`, `tests/export-pdf-route.test.ts`** — `vi.mock` factories updated for the renamed export + the two env-var name constants. Both would have failed otherwise; only running the suite caught it.
- **`.env.example`, `AGENTS.md`** — both new vars documented (AGENTS.md asserts a 1:1 match with `.env.example`, so it had to be updated). AGENTS.md Testing section now records the browser-layer vs. server-layer mocking distinction.

## 4. Verification (all run locally, nothing trusted)

- `npx playwright test` → **55 passed / 0 failed** (1.6m)
- `npx playwright test tests/e2e/specs/export-pdf.spec.ts` → **5 passed** (was 3/5)
- `npx vitest run` → **2079 passed / 5 skipped / 0 failed** (was 2074; +5 new)
- `npm run lint` → 0 errors, 1 pre-existing `layout.tsx:49` warning
- `npm run typecheck` → clean

## 5. Immediate Next Step

**Review and merge PR #1094.** No code work is pending on #1084.

If the suite is re-run after merge, expect benign teardown noise in the log: `Error: The destination stream closed early` and Prisma `postmaster exit` / `connection: Closed` — all emitted after the last test, when global-teardown removes the Postgres container.

## 6. Open items noticed but deliberately NOT actioned

- **`api/v1/export-pdf` has no seam.** It still calls `buildBrowserlessPdfUrl()` directly, so a future e2e test of the v1 route hits the exact wall #1084 just fixed. Out of scope (the issue is about the non-versioned route); flagged in the PR body.
- **The #219 tsconfig guard is inert.** `.githooks/pre-commit` is committed with mode `100644` (non-executable), so even though `core.hooksPath` is set to `.githooks`, git skips it with a hint on every commit. The `jsx: preserve` → `react-jsx` flip that Next.js forces on every build/dev can therefore be committed by accident. Fix is `chmod +x .githooks/pre-commit` + commit the mode change — kept out of #1084 to keep that diff focused. **This is the highest-value follow-up.**
- **Two `node_modules/.vite/**` files are tracked** despite `.gitignore` containing `node_modules/`. Pre-existing and unrelated; left alone.

## 7. Recurring traps (the two from last session still bit; one new)

- **Another agent may be working the same queue concurrently** — confirmed clean before pushing this time (`git log HEAD..origin/develop` empty, no open PRs, #1084 still open), but check every time.
- **A PR can merge with the e2e suite never run** — #1092 shipped with a "cannot run here" caveat and merged anyway. This PR ran the full suite locally, which is how the two stale `vi.mock` factories were caught.
- **New:** never write a `page.route` glob like `**/api/...` inside a `/** */` block comment — the `*/` closes the comment and you get baffling `TS1443: Module declaration names may only use quoted strings` parse errors. This cost two lint+typecheck round-trips here.
- `kill -9`ing a stuck `next-server` wipes `~/.cache/ms-playwright/` and causes ~55 bogus failures. Recover with `npx playwright install chromium`.

## 8. Related

- **PRs:** #1090 (merged), #1092 (merged, the #1091 fix), #1093 (closed, superseded by #1092), **#1094 (open, this work)**.
- **Issues:** #1083 closed, #1085 closed, #1091 filed+closed via #1092, **#1084 fixed by #1094, pending merge**.
- **Archived handoffs:** `.handoffs/2026-09-28-issue-1084-server-side-mock.md` (this file) + 6 earlier.
- **Unrelated:** the `spike/dana-rig-obscura` branch (`c22986d8`) remains unmerged; its `OBSCURA_ALLOW_PRIVATE_NETWORK=1` fix never shipped.
