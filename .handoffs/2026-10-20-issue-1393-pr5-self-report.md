# Issue #1393 — Phase-2 PR-5 self-report

## PR

[#1412](https://github.com/anchapin/staging-studio/pull/1412) — `feat/issue-1393-require-user-helper` → `develop`.

## What landed

6 files, +154 / −36 LOC.

| File | Status | Purpose |
|---|---|---|
| `src/lib/test/require-user.ts` | added | Shared factory: `requireUser(overrides) → { user, mockGetAuthedPrismaUser }` |
| `tests/require-user.test.ts` | added | 6 unit tests pinning the factory contract |
| `tests/export-pdf-service.test.ts` | modified | Drops local `makeUser()`, binds the helper's `mockGetAuthedPrismaUser` for `id: "user-1"` |
| `tests/generate-copy-service.test.ts` | modified | Drops local `makeUser()`, binds the helper's `mockGetAuthedPrismaUser` for `id: USER_ID` |
| `tests/label-instances-service.test.ts` | modified | Drops local `mockUser` literal, reads the helper's `user` |
| `tests/segment-furnishings-service.test.ts` | modified | Drops local `mockUser` literal, reads the helper's `user` for `id: "user-1"` |

## Decisions surfaced

- **Two surfaces from one fixture.** The four target services disagreed on
  auth-wiring. `export-pdf-service` and `generate-copy-service` take
  `deps.getAuthedPrismaUser` as a deps-injected `vi.fn()`, while
  `label-instances-service` and `segment-furnishings-service` take the user
  as a direct function parameter to `validateXXX(..., user, deps)` (auth
  runs through `requireProjectOwnershipOrThrow`, not through the deps seam).
  Per the brief's "do NOT force under a single test factory" mandate, the
  helper returns *both* halves of the fixture and each test picks the one
  it needs. The two halves always match because they come from one call.
- **Auth-failure tests stay untouched.** Tests where `deps.getAuthedPrismaUser`
  returns `null` to exercise the "no session" branch keep their own
  `vi.fn(async () => null)`. The helper is for the user-present case.
- **Default `id` is `"user-test"`, defaults are Circle G Designs.** Tests
  that asserted on the previous literal's `id: "user-1"` get it via
  `requireUser({ id: "user-1" })`. Defaults serve the param-passed tests
  (label-instances, segment-furnishings) which only care about the user
  being a valid `User` literal they can pass to `validateXXX`.
- **No `firmName: null` overrides.** The original exports used
  `firmName: null` with `as unknown as User` to bypass Prisma's non-nullable
  type. The helper types through `Partial<User>`, so `null` is rejected by
  typecheck. Tests don't assert on `firmName`, so I dropped the override
  and accepted the helper's `"Circle G Designs"` default.

## CI status (PR #1412)

- `Lint · Typecheck · Unit tests` — **passed** (54s)
- `Docker image builds` — passed (1m28s)
- `E2E (Playwright)` — skipped (PR scope, expected per AGENTS.md)
- `Release guard (develop caught up with main)` — skipped (PR against
  develop, not a release PR)

The required check for `main` (`Lint · Typecheck · Unit tests`) is green.

## Self-test

| Command | Result |
|---|---|
| `npm run lint` | clean (only pre-existing warnings) |
| `npm run typecheck` | clean |
| `npx vitest run tests/require-user.test.ts tests/export-pdf-service.test.ts tests/generate-copy-service.test.ts tests/label-instances-service.test.ts tests/segment-furnishings-service.test.ts` | 5 files, 90/90 pass |
| `npm test` | 232 files / 2903 tests pass (the one observed flake in `tests/holistic-mask.test.ts` did NOT reproduce in a targeted re-run and is unrelated to this PR's files) |
| `npm run build` | succeeds |

## Tooling note

`src/lib/test/` was a new directory; create needed a parent-directory write
which worked from the host shell without extra steps.

## Files touched

```
src/lib/test/require-user.ts                          (new, 73 LOC)
tests/require-user.test.ts                             (new, 63 LOC)
tests/export-pdf-service.test.ts                       (modified)
tests/generate-copy-service.test.ts                    (modified)
tests/label-instances-service.test.ts                  (modified)
tests/segment-furnishings-service.test.ts              (modified)
```

## What I did NOT do

- Did not auto-merge. Per AGENTS.md "`develop` is unprotected" but the
  brief asked for self-test + report, not auto-merge. PR is mergeable and
  CI is green.
- Did not touch the service modules. The brief scoped to test-mock
  harmonisation only.
- Did not add per-test `expect(deps.getAuthedPrismaUser).toHaveBeenCalledTimes(1)`
  assertions. The brief described that capability as something the helper
  *unlocks* — not a required change. The existing per-test assertions on
  downstream call args (`claimDailyQuota(..., userId, ...)`) cover the
  "did the user flow through?" check without coupling to call-count
  assertions on the dep itself.
