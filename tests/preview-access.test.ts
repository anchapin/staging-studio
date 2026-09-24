import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  extractPreviewToken,
  getPreviewAccess,
  resolvePreviewAccess,
} from "@/lib/preview-access";
import { signPreviewToken } from "@/lib/preview-token";
import { createSupabaseRequestClient } from "@/lib/supabase";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/supabase", () => ({
  createSupabaseRequestClient: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    project: { findUnique: vi.fn() },
  },
}));

const createRequestClient = createSupabaseRequestClient as unknown as Mock;
const userFindUnique = prisma.user.findUnique as unknown as Mock;
const projectFindUnique = prisma.project.findUnique as unknown as Mock;

/** Wire the request-scoped Supabase client to a session (or none). */
function mockSession(user: { email: string } | null): void {
  createRequestClient.mockResolvedValue({
    auth: {
      getUser: async () => ({ data: { user }, error: null }),
    },
  });
}

const PROJECT_ID = "project-1";
const OWNER_ID = "user-owner-1";

describe("extractPreviewToken", () => {
  it("returns a plain string token", () => {
    expect(extractPreviewToken({ token: "abc" })).toBe("abc");
  });

  it("returns the first value of an array token", () => {
    expect(extractPreviewToken({ token: ["abc", "def"] })).toBe("abc");
  });

  it("returns null when the param is missing or undefined", () => {
    expect(extractPreviewToken({})).toBeNull();
    expect(extractPreviewToken({ token: undefined })).toBeNull();
  });
});

describe("resolvePreviewAccess", () => {
  const validToken = {
    valid: true,
    projectId: PROJECT_ID,
  } as const;
  const mismatchedToken = {
    valid: true,
    projectId: "other-project",
  } as const;
  const invalidToken = { valid: false } as const;

  it("grants access for a valid token scoped to the URL's project", () => {
    expect(
      resolvePreviewAccess({
        projectId: PROJECT_ID,
        tokenVerification: validToken,
        sessionUserId: null,
        projectOwnerId: null,
      })
    ).toBe(true);
  });

  it("denies a valid token minted for a different project", () => {
    expect(
      resolvePreviewAccess({
        projectId: PROJECT_ID,
        tokenVerification: mismatchedToken,
        sessionUserId: null,
        projectOwnerId: null,
      })
    ).toBe(false);
  });

  it("grants access for an owning session without a token", () => {
    expect(
      resolvePreviewAccess({
        projectId: PROJECT_ID,
        tokenVerification: invalidToken,
        sessionUserId: OWNER_ID,
        projectOwnerId: OWNER_ID,
      })
    ).toBe(true);
  });

  it("grants access to the owner even when the token is invalid", () => {
    // A bad token must not BLOCK the session fallback.
    expect(
      resolvePreviewAccess({
        projectId: PROJECT_ID,
        tokenVerification: mismatchedToken,
        sessionUserId: OWNER_ID,
        projectOwnerId: OWNER_ID,
      })
    ).toBe(true);
  });

  it("denies a session user who does not own the project", () => {
    expect(
      resolvePreviewAccess({
        projectId: PROJECT_ID,
        tokenVerification: invalidToken,
        sessionUserId: "user-other",
        projectOwnerId: OWNER_ID,
      })
    ).toBe(false);
  });

  it("denies a session user when the project does not exist (no existence leak)", () => {
    expect(
      resolvePreviewAccess({
        projectId: "missing-project",
        tokenVerification: invalidToken,
        sessionUserId: OWNER_ID,
        projectOwnerId: null,
      })
    ).toBe(false);
  });

  it("denies anonymous requests without a token", () => {
    expect(
      resolvePreviewAccess({
        projectId: PROJECT_ID,
        tokenVerification: invalidToken,
        sessionUserId: null,
        projectOwnerId: OWNER_ID,
      })
    ).toBe(false);
    expect(
      resolvePreviewAccess({
        projectId: PROJECT_ID,
        tokenVerification: invalidToken,
        sessionUserId: null,
        projectOwnerId: null,
      })
    ).toBe(false);
  });
});

describe("getPreviewAccess (request wiring)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindUnique.mockResolvedValue({ id: OWNER_ID });
  });

  it("short-circuits on a valid token without any session lookup", async () => {
    mockSession(null);
    const token = await signPreviewToken(PROJECT_ID);

    expect(await getPreviewAccess(PROJECT_ID, token)).toBe(true);
    expect(createRequestClient).not.toHaveBeenCalled();
    expect(projectFindUnique).not.toHaveBeenCalled();
  });

  it("denies an anonymous request before querying the project", async () => {
    mockSession(null);

    expect(await getPreviewAccess(PROJECT_ID, null)).toBe(false);
    expect(createRequestClient).toHaveBeenCalledTimes(1);
    expect(projectFindUnique).not.toHaveBeenCalled();
  });

  it("grants access when the session user owns the project", async () => {
    mockSession({ email: "owner@test" });
    projectFindUnique.mockResolvedValue({ userId: OWNER_ID });

    expect(await getPreviewAccess(PROJECT_ID, null)).toBe(true);
    expect(userFindUnique).toHaveBeenCalledWith({
      where: { email: "owner@test" },
      select: { id: true },
    });
  });

  it("denies a session user who does not own the project", async () => {
    mockSession({ email: "intruder@test" });
    userFindUnique.mockResolvedValue({ id: "user-other" });
    projectFindUnique.mockResolvedValue({ userId: OWNER_ID });

    expect(await getPreviewAccess(PROJECT_ID, null)).toBe(false);
  });

  it("denies when the project row is missing even for a session user", async () => {
    mockSession({ email: "owner@test" });
    projectFindUnique.mockResolvedValue(null);

    expect(await getPreviewAccess("missing-project", null)).toBe(false);
  });

  it("denies a session with no matching Prisma user row", async () => {
    mockSession({ email: "ghost@test" });
    userFindUnique.mockResolvedValue(null);

    expect(await getPreviewAccess(PROJECT_ID, null)).toBe(false);
    expect(projectFindUnique).not.toHaveBeenCalled();
  });

  it("fails closed when the auth lookup throws", async () => {
    createRequestClient.mockRejectedValue(new Error("auth down"));

    expect(await getPreviewAccess(PROJECT_ID, null)).toBe(false);
  });

  it("fails closed when the ownership query throws", async () => {
    mockSession({ email: "owner@test" });
    projectFindUnique.mockRejectedValue(new Error("db down"));

    expect(await getPreviewAccess(PROJECT_ID, null)).toBe(false);
  });
});
