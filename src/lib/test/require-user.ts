/**
 * Shared `requireUser()` test-mock helper.
 *
 * Issue #1393 — Phase-2 PR-5. Replaces the four hand-rolled `mockUser` /
 * `makeUser` literals across `tests/{export-pdf,generate-copy,label-instances,
 * segment-furnishings}-service.test.ts` with one factory that produces a
 * fully-formed `User` literal **and** a `vi.fn()` replacement for the
 * `getAuthedPrismaUser` dep. Both halves travel together, so the dep
 * always matches the user the service stack expects.
 *
 * Two surfaces, one fixture:
 *
 * - Deps-injected services (`export-pdf-service`, `generate-copy-service`)
 *   use `fixture.mockGetAuthedPrismaUser` as their `deps.getAuthedPrismaUser`.
 * - Function-arg services (`label-instances-service`, `segment-furnishings-
 *   service`) take `user` as a direct parameter to `validateXXX`, so they
 *   read `fixture.user` instead. Auth for those services runs through
 *   `requireProjectOwnershipOrThrow`, which is mocked at the module level
 *   (`vi.mock("@/lib/api-auth")`), not through the deps seam — see
 *   PR-2 / PR-3 notes in `.handoffs/2026-10-20-issue-1393-mock-helper-brief.md`.
 *
 * Auth-failure tests (where `deps.getAuthedPrismaUser` returns `null` to
 * exercise the "no session" branch) keep their own `vi.fn(() => null)` and
 * do NOT reach for this helper — `requireUser` is for the user-present case.
 */

import type { User } from "@prisma/client";
import { vi } from "vitest";

export interface RequireUserFixture {
  /** A complete, syntactically-typed Prisma `User` literal. */
  user: User;
  /**
   * A `vi.fn()` whose default impl returns the matching `user`. Bind into
   * service deps as `deps.getAuthedPrismaUser = fixture.mockGetAuthedPrismaUser`.
   * Tests assert call count against this handle.
   */
  mockGetAuthedPrismaUser: () => Promise<User | null>;
}

const DEFAULT_FIELDS = {
  id: "user-test",
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
 * Build a fully-formed `User` literal and a matching `vi.fn()` dep.
 *
 * Pass `overrides` to set `id`, `email`, or any other Prisma field for a
 * specific test. The fixture is { user, mockGetAuthedPrismaUser } — always
 * pass the mock back into the service deps, never inject a user literal
 * directly when the service goes through `getAuthedPrismaUser`.
 */
export function requireUser(
  overrides: Partial<User> = {},
): RequireUserFixture {
  const user = {
    ...DEFAULT_FIELDS,
    ...overrides,
  } as unknown as User;
  const mockGetAuthedPrismaUser = vi.fn(
    async (): Promise<User | null> => user,
  );
  return { user, mockGetAuthedPrismaUser };
}
