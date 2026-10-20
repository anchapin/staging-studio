/**
 * Unit tests for `src/lib/test/require-user.ts`.
 *
 * Issue #1393 — Phase-2 PR-5: pins the shared `requireUser()` factory so
 * the four service tests that consume it (`export-pdf-service`,
 * `generate-copy-service`, `label-instances-service`,
 * `segment-furnishings-service`) can rely on a single contract.
 *
 * No `vi.mock` or external state — pure synchronous factory.
 */
import { describe, expect, it } from "vitest";

import { requireUser } from "@/lib/test/require-user";

describe("requireUser", () => {
  it("returns both halves of the fixture", () => {
    const fx = requireUser();
    expect(fx.user).toBeDefined();
    expect(typeof fx.mockGetAuthedPrismaUser).toBe("function");
  });

  it("user fixture defaults to id=user-test and Circle G Designs firm", () => {
    const { user } = requireUser();
    expect(user.id).toBe("user-test");
    expect(user.firmName).toBe("Circle G Designs");
    expect(user.ownerName).toBe("Lauren Chapin");
    expect(user.darkMode).toBe(false);
  });

  it("mockGetAuthedPrismaUser resolves to the matching user", async () => {
    const fx = requireUser();
    await expect(fx.mockGetAuthedPrismaUser()).resolves.toEqual(fx.user);
  });

  it("overrides win against defaults", () => {
    const { user } = requireUser({
      id: "user-99",
      firmName: "Acme",
      email: "x@y.z",
    });
    expect(user.id).toBe("user-99");
    expect(user.firmName).toBe("Acme");
    expect(user.email).toBe("x@y.z");
  });

  it("mockGetAuthedPrismaUser signature accepts no arguments and returns Promise<User|null>", async () => {
    const fx = requireUser();
    const ret = await fx.mockGetAuthedPrismaUser();
    expect(ret).not.toBeNull();
    expect((ret as { id: string }).id).toBe("user-test");
  });

  it("two calls produce independent fixtures (no shared vi.fn state)", async () => {
    const a = requireUser({ id: "a" });
    const b = requireUser({ id: "b" });
    expect(a.mockGetAuthedPrismaUser).not.toBe(b.mockGetAuthedPrismaUser);
    const aResult = (await a.mockGetAuthedPrismaUser()) as { id: string };
    const bResult = (await b.mockGetAuthedPrismaUser()) as { id: string };
    expect(aResult.id).toBe("a");
    expect(bResult.id).toBe("b");
  });
});
