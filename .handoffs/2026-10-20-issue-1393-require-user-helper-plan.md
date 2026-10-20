# Issue #1393 — Phase-2 PR-5 plan: shared `requireUser()` test-mock helper

## Surface area (5 files)

1. **`src/lib/test/require-user.ts` (NEW)** — unified `requireUser()` factory. Returns `{ user, mockGetAuthedPrismaUser }`. Serves all four service tests.
2. **`tests/export-pdf-service.test.ts` (MOD)** — replace local `makeUser()` with `requireUser()`, add `expect(deps.getAuthedPrismaUser).toHaveBeenCalledTimes(1)` to the happy-path test.
3. **`tests/generate-copy-service.test.ts` (MOD)** — same: replace `makeUser()` with `requireUser()`, add `toHaveBeenCalledTimes(1)` to the happy-path test (the existing `getAuthedPrismaUser: vi.fn(async () => null)` failure test stays as-is — that's the auth-failure seam).
4. **`tests/label-instances-service.test.ts` (MOD)** — replace local `mockUser` literal with `requireUser().user`. No new dep-call assertion (this service signature takes `user` as a function arg, not via `deps`).
5. **`tests/segment-furnishings-service.test.ts` (MOD)** — same as label-instances: replace `mockUser` with `requireUser().user`. No new dep assertion.

## Helper shape

```ts
// src/lib/test/require-user.ts
import type { User } from "@prisma/client";
import { vi } from "vitest";

export type RequiredUser = User;

export interface RequiredUserFixture {
  /** A complete, fully-formed Prisma `User` literal. */
  user: User;
  /**
   * A `vi.fn()` whose default impl returns the matching `user`. Bind into
   * service deps as `deps.getAuthedPrismaUser = mockGetAuthedPrismaUser`.
   * Tests that exercise auth failure keep their own `vi.fn(() => null)` and
   * don't reach for this fixture.
   */
  mockGetAuthedPrismaUser: () => Promise<User | null>;
}

const DEFAULT_FIELDS = {
  firmName: "Circle G Designs",
  ownerName: "Lauren Chapin",
  logoUrl: null,
  email: "user@example.com",
  psychologyPageContent: null,
  signoffContent: null,
  darkMode: false,
  createdAt: new Date("2026-01-01T00:00:00Z"),
} as const;

/**
 * Build a fully-formed `User` literal together with a mock
 * `getAuthedPrismaUser` dep. Default id is `"user-test"` and email is
 * `"user@example.com"`; pass `overrides` to set `id`, `email`, or any
 * other Prisma field for a specific test.
 *
 * Returns a fixture `{ user, mockGetAuthedPrismaUser }`. The two halves
 * travel together so the `vi.fn()` *always* matches the user the test
 * stack expects, which makes accidental contract drift between the two
 * impossible by construction.
 */
export function requireUser(
  overrides: Partial<User> = {},
): RequiredUserFixture {
  const user = {
    ...DEFAULT_FIELDS,
    ...overrides,
  } as unknown as User;
  const mockGetAuthedPrismaUser = vi.fn(async (): Promise<User | null> => user);
  return { user, mockGetAuthedPrismaUser };
}
```

### Why this shape

- **One fixture, two surfaces.** `label-instances`/`segment-furnishings` take the
  user through a function arg, so they read `fixture.user`. `export-pdf`/`generate-copy`
  inject it via `deps.getAuthedPrismaUser`, so they read `fixture.mockGetAuthedPrismaUser`.
  Both get a stable, typed factory without a forced single call shape.
- **Default `id` is `"user-test"`** so a `toHaveBeenCalledWith({ id: "user-test" })`
  assertion is meaningful. Tests that pass `overrides: { id: "user-1" }` (the
  existing segment-furnishings test does this) keep their existing IDs.
- **Type-cast at the seam.** `User` has fields Phase-1 tests don't populate (`pageTemplates`,
  `updatedAt`); those tests already use `as unknown as User`. The helper follows the
  same pattern via `DEFAULT_FIELDS` spread + typecast — the simplest possible thing
  that produces a syntactically complete `User`.
- **Auth-failure tests stay untouched.** `generate-copy-service.test.ts` line 172
  keeps `getAuthedPrismaUser: vi.fn(async () => null)` (existing seam) — the
  helper is for the user-present case, not for stubbing auth failure.
- **Path follows convention.** `src/lib/test/` mirrors the same convention as
  `src/lib/inference.ts` test-time seaming (none today, but the prefix is
  unambiguous — "test infrastructure that ships from `lib/`", distinct from
  the `tests/` directory which is vitest input only).

## Tests to update — edit policy

For each file: **delete the local `mockUser`/`makeUser` body**, **replace
with one import + replace 1-3 call sites** + add `toHaveBeenCalledTimes(1)`
where it adds real value (export-pdf + generate-copy happy paths).

## Self-test plan

1. `npm run lint` — must pass.
2. `npm run typecheck` — must pass.
3. `npm test -- tests/export-pdf-service.test.ts tests/generate-copy-service.test.ts tests/label-instances-service.test.ts tests/segment-furnishings-service.test.ts` — must pass.
4. Full `npm test` — must pass (to verify no ripple effect on other tests).

## Out of scope

- No code-routing changes (the brief scopes to test-mock harmonisation only).
- No service-shape changes (deps-injection vs function-arg stays as-is).
- No new dep assertion in label-instances/segment-furnishings tests —
  the auth chain for those services is *inside* `requireProjectOwnershipOrThrow`
  (mocked at module-level via `vi.mock`), so `getAuthedPrismaUser` is
  not on the deps surface to assert against.
