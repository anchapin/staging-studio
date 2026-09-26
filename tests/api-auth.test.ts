import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  createServerClientSingleton: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: vi.fn() }, project: { findUnique: vi.fn() } },
}));

import { cookies } from "next/headers";
import { createServerClientSingleton } from "@/lib/supabase";
import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";

const mockCookies = vi.mocked(cookies);
const mockCreateServerClient = vi.mocked(createServerClientSingleton);
const mockFindUnique = vi.mocked(prisma.user.findUnique) as unknown as Mock<
  () => Promise<unknown>
>;

const mockSupabaseUser = {
  id: "user-1",
  email: "alex@example.com",
  role: "authenticated",
};

const mockDbUser = {
  id: "user-1",
  email: "alex@example.com",
  name: "Alex",
  createdAt: new Date(),
  updatedAt: new Date(),
  firmName: "Circle G Designs",
  darkMode: false,
  pageTemplates: null,
};

function buildSupabaseClient(user: unknown) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user } }),
    },
  };
}

describe("getAuthedPrismaUser", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCookies.mockReturnValue({
      getAll: vi.fn().mockReturnValue([]),
    } as unknown as ReturnType<typeof cookies>);
    mockCreateServerClient.mockReturnValue(
      buildSupabaseClient(null) as unknown as ReturnType<typeof createServerClientSingleton>
    );
  });

  it("returns null when no session cookie is present", async () => {
    const result = await getAuthedPrismaUser();
    expect(result).toBeNull();
  });

  it("returns null when Supabase has no user (invalid session)", async () => {
    mockCookies.mockReturnValue({
      getAll: vi.fn().mockReturnValue([{ name: "sb-token", value: "bad" }]),
    } as unknown as ReturnType<typeof cookies>);

    const result = await getAuthedPrismaUser();
    expect(result).toBeNull();
  });

  it("returns null when Supabase user has no email", async () => {
    mockCookies.mockReturnValue({
      getAll: vi.fn().mockReturnValue([{ name: "sb-token", value: "t" }]),
    } as unknown as ReturnType<typeof cookies>);
    mockCreateServerClient.mockReturnValue(
      buildSupabaseClient({ id: "user-1", email: null }) as unknown as ReturnType<typeof createServerClientSingleton>
    );

    const result = await getAuthedPrismaUser();
    expect(result).toBeNull();
  });

  it("returns null when Prisma has no matching user for the email", async () => {
    mockCookies.mockReturnValue({
      getAll: vi.fn().mockReturnValue([{ name: "sb-token", value: "valid" }]),
    } as unknown as ReturnType<typeof cookies>);
    mockCreateServerClient.mockReturnValue(
      buildSupabaseClient(mockSupabaseUser) as unknown as ReturnType<typeof createServerClientSingleton>
    );
    mockFindUnique.mockResolvedValue(null);

    const result = await getAuthedPrismaUser();
    expect(result).toBeNull();
  });

  it("returns Prisma user when both Supabase and DB lookups succeed", async () => {
    mockCookies.mockReturnValue({
      getAll: vi.fn().mockReturnValue([{ name: "sb-token", value: "valid" }]),
    } as unknown as ReturnType<typeof cookies>);
    mockCreateServerClient.mockReturnValue(
      buildSupabaseClient(mockSupabaseUser) as unknown as ReturnType<typeof createServerClientSingleton>
    );
    mockFindUnique.mockResolvedValue(mockDbUser);

    const result = await getAuthedPrismaUser();
    expect(result).toMatchObject({ id: "user-1", email: "alex@example.com" });
  });
});

const mockProjectFindUnique = vi.mocked(prisma.project.findUnique) as unknown as Mock<
  () => Promise<unknown>
>;

describe("requireProjectOwnership", () => {
  const mockUser = { id: "user-1", email: "alex@example.com", role: "authenticated" } as const;
  const PROJECT_ID = "project-123";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws ProjectNotFoundError when project does not exist", async () => {
    mockProjectFindUnique.mockResolvedValue(null);

    const { requireProjectOwnership, ProjectNotFoundError } = await import("@/lib/api-auth");

    await expect(requireProjectOwnership(PROJECT_ID, mockUser as any)).rejects.toThrow(ProjectNotFoundError);
  });

  it("throws ProjectForbiddenError when project exists but user does not own it", async () => {
    mockProjectFindUnique.mockResolvedValue({ id: PROJECT_ID, userId: "other-user" });

    const { requireProjectOwnership, ProjectForbiddenError } = await import("@/lib/api-auth");

    await expect(requireProjectOwnership(PROJECT_ID, mockUser as any)).rejects.toThrow(ProjectForbiddenError);
  });

  it("returns {ok: true, projectId} when project exists and user owns it", async () => {
    mockProjectFindUnique.mockResolvedValue({ id: PROJECT_ID, userId: mockUser.id });

    const { requireProjectOwnership } = await import("@/lib/api-auth");

    const result = await requireProjectOwnership(PROJECT_ID, mockUser as any);
    expect(result).toEqual({ ok: true, projectId: PROJECT_ID });
  });
});
