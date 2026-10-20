# Squad-orchestrator brief — issue #1393 (requireUser() test-mock helper)

## Context

Issue **#1393** ("Add `requireUser()` test-mock helper for non-project
API routes") is the one issue carried forward from the 2026-10-19/20
wave-5 revival closeout. It was identified as a duplicate of #1395
during that engagement — #1395 was closed as DUPLICATE referencing
#1393, making #1393 the canonical tracker.

Companion handoffs (already on `origin/main`):
- `.handoffs/2026-10-19-wave5-revival-plan.md` (background)
- `.handoffs/2026-10-19-wave5-revival-orchestrator-brief.md` (the
  wave-5 brief template, useful as a structural reference)
- `.handoffs/2026-10-20-wave5-revival-phase2-brief.md` (corrections
  table — same errors-of-the-prior-phase caveat applies)
- `.handoffs/2026-10-20-wave5-revival-DONE.md` (closeout record —
  mentions #1393 by name)

## Goal

Add a thin test-only helper that vitest specs use to produce a
deterministic `User` object without going through the real auth
seam. The motivation in #1393 is that the wave-3 + wave-5 route
decompositions shipped with each route spec calling
`getApiUser` (production-side helper) and hand-rolling a mock
identical-shape User inline — duplication, fragile to schema drift.

## Why this is small and high-leverage

The wave-5 PRs (#1400, #1401, #1404, #1406) shipped test deps that
hand-roll their own User-shaped objects. Each is subtly different.
The `requireUser()` helper unifies them. Scope is bounded:

1. One new helper: `src/lib/test-fixtures/auth.ts` (or extend
   `tests/fixtures/auth.ts` if vitest-only — the right home depends
   on whether the helper is consumed by `tests/e2e/` Playwright
   specs too, which it might be).
2. Update each of the four existing route-spec files to consume
   the helper instead of inline mocks.
3. New vitest for the helper itself.

Estimated PR size: **50–150 lines of net new code** (excluding the
4 spec migrations). Single PR, well within 40-turn budget.

## What `requireUser()` should do

Minimum viable API (do not over-design):

```ts
// src/lib/test-fixtures/auth.ts  (or wherever the canonical home ends up)
import type { User } from "@prisma/client";

export interface RequireUserOptions {
  /** Override the user id; defaults to a fresh random bigint string. */
  id?: string;
  /** Override the email; defaults to "test-<random>@example.test". */
  email?: string;
  /** Other prisma User fields can flow through here for tests
      that need to assert on them. Add only as needed; do NOT
      add a `Record<string, unknown>` cast. */
  name?: string | null;
  /** Visual / dark-mode / firm preferences; default to neutrals. */
  darkMode?: boolean;
  /** Anything else needing override; pass through. */
}

export function requireUser(overrides?: RequireUserOptions): User {
  return {
    id: overrides?.id ?? `test-user-${randomUUID()}`,
    email: overrides?.email ?? `test-${randomUUID()}@example.test`,
    name: overrides?.name ?? null,
    darkMode: overrides?.darkMode ?? false,
    // ... other User fields, defaulting to deterministic neutrals
  } satisfies User;
}
```

Notes:
- **Type the helper's return as `User`, not a duck-typed subset.**
  This catches schema drift at compile time and forces a
  followup when `User` schema adds a required field.
- **Per-call deterministic ids only if the test asks**. Don't seed
  `vi.useFakeTimers()` in the helper; if a test wants determinism,
  it can call `requireUser({ id: "fixed-id" })`.
- **No `vi.mock(...)` inside the helper.** The user-passed handoff
  for the wave-5 subagents was emphatic about this. If the helper
  needs to interact with `vi`, that's a different helper.

## Touched files (preview)

These are the four waves-5 spec files that hand-roll `User`:

- `tests/label-instances-service.test.ts`
- `tests/segment-furnishings-service.test.ts`
- `tests/export-pdf-service.test.ts`
- `tests/generate-copy-service.test.ts`

**Read-only first**: each file defines its own inline `User`
fixture. The consolidation replaces them. Confirm before
migrating — there may be unrelated reasons each file inlined
its own copy (e.g. the `export-pdf` suite needs an `appUrl` env
override alongside its User mock; keep that flexibility).

Plus new files:
- `src/lib/test-fixtures/auth.ts` (or alternative home — the
  location decision is part of the PR scope).
- `tests/test-fixtures/auth.test.ts` (or equivalent).

## Per-PR verification gates (must pass before opening the PR)

- `npm run lint` — 0 errors on touched files
- `npm run typecheck` — 0 errors
- `npx vitest run tests/` — 100% pass (no regressions; the
  migration replaces inline fixtures, so a regression here means
  the helper is dropping a field the route spec relied on)
- Pre-commit `check-tsconfig-flip.sh` — clean. If it flags,
  `git checkout HEAD -- tsconfig.json` before retrying.

## Hard constraints (verbatim from the wave-5 brief)

- Read `/home/alex/Projects/staging-studio/AGENTS.md` BEFORE
  editing. Especially "Layout", "Testing" (vitest vs Playwright
  split), "Security advisories" (#1220 braces override).
- DO NOT run `npm audit`, `npm audit fix`, or any package-update
  commands.
- DO NOT touch `.agents/`, `.opencode/`, `.planning/worktrees/`.
- DO NOT push directly to `main` — merge is via PR.
- DO NOT close issue #1393 — close it after the PR is merged.
- Commit subject: `[AI-assisted] (opencode:squad-orchestrator)
  <type>(<scope>): <description>`.

## Out of scope (do NOT do)

- DO NOT touch any other open issue in this engagement's region.
- DO NOT update AGENTS.md unless a "src/lib/" bullet is stale and
  the editing rule is to update Layout in the same PR (AGENTS.md
  is silent on this; defer unless you have a reason to update).
- DO NOT extract a parallel `requireProject()`, `requireRoom()`,
  etc. helper. They may or may not belong in the same PR. If
  obvious, fold them in; if not, leave for a followup issue.
- DO NOT migrate the existing 4 spec files beyond the minimum
  needed to use the helper. Resist the urge to clean up
  unrelated lint or format issues.

## State at handoff

- `main` tip: `93be8f0` (closeout for wave-5 revival). May have
  advanced since.
- Issue #1393: open. One canonical tracker.
- Issue #1395: closed (DUPLICATE).
- All other wave-5 region issues: closed.

## Self-report (append here after PR merge)

```
### Issue #1393 report
- Branch: feat/issue-1393-require-user-helper
- URL: <gh pr URL>
- Merged: <iso8601>
- Files touched:
  - src/lib/test-fixtures/auth.ts (added, N lines)
  - tests/test-fixtures/auth.test.ts (added, N lines)
  - tests/label-instances-service.test.ts (migrated)
  - tests/segment-furnishings-service.test.ts (migrated)
  - tests/export-pdf-service.test.ts (migrated)
  - tests/generate-copy-service.test.ts (migrated)
- Verification:
  - lint: ok / warn / error (counts)
  - typecheck: ok / error
  - vitest: <new tests> pass / N total pass / 0 fail
  - CI: green / red (workflow run link)
- Decision points hit (if any):
  - <none / describe — esp. where the helper lives and whether
     requireProject/requireRoom came along or got punted>
- Risk observations:
  - <none / describe — esp. if a spec had non-default field
     overrides the helper would have to support>
```

Also: open a separate PR for the appended self-report so it lands
on `origin/main` before this session terminates (wave-5 pattern:
PR #1402, #1405, #1407).

## Termination

When the PR is merged and #1393 is closed, your job is done. Hand
back: PR URL, summary, the file migrations touched, and any
decisions you surfaced.
