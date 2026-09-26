import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  createServerClientSingleton: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

import { cookies } from "next/headers";
import { createServerClientSingleton } from "@/lib/supabase";
import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser, requireProjectOwnership } from "@/lib/api-auth";

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

  describe("requireProjectOwnership", () => {
    it("throws 401 when no session cookie is present", async () => {
      vi.mocked(mockCookies).mockReturnValue({
        getAll: vi.fn().mockReturnValue([]),
      } as unknown as ReturnType<typeof cookies>);
      await expect(requireProjectOwnership("project-1")).rejects.toMatchObject({
        status: 401,
        message: "Unauthorized",
      });
    });

    it("throws 403 when project does not exist", async () => {
      vi.mocked(mockCookies).mockReturnValue({
        getAll: vi.fn().mockReturnValue([{ name: "sb-token", value: "t" }]),
      } as unknown as ReturnType<typeof cookies>);
      vi.mocked(mockCreateServerClient).mockReturnValue(
        buildSupabaseClient({ id: "user-1", email: "alex@example.com" }) as never
      );
      vi.mocked(prisma.project.findUnique).mockResolvedValue(null);
      await expect(requireProjectOwnership("project-1")).rejects.toMatchObject({
        status: 403,
        message: "Forbidden",
      });
    });

    it("throws 403 when authenticated user does not own the project", async () => {
      vi.mocked(mockCookies).mockReturnValue({
        getAll: vi.fn().mockReturnValue([{ name: "sb-token", value: "t" }]),
      } as unknown as ReturnType<typeof cookies>);
      vi.mocked(mockCreateServerClient).mockReturnValue(
        buildSupabaseClient({ id: "user-1", email: "alex@example.com" }) as never
      );
      vi.mocked(prisma.project.findUnique).mockResolvedValue({
        id: "project-1",
        userId: "other-user",
      } as never);
      await expect(requireProjectOwnership("project-1")).rejects.toMatchObject({
        status: 403,
        message: "Forbidden",
      });
    });

    it("does not throw when authenticated user owns the project", async () => {
      vi.mocked(mockCookies).mockReturnValue({
        getAll: vi.fn().mockReturnValue([{ name: "sb-token", value: "t" }]),
      } as unknown as ReturnType<typeof cookies>);
      vi.mocked(mockCreateServerClient).mockReturnValue(
        buildSupabaseClient({ id: "user-1", email: "alex@example.com" }) as never
      );
      vi.mocked(prisma.project.findUnique).mockResolvedValue({
        id: "project-1",
        userId: "user-1",
      } as never);
      await expect(requireProjectOwnership("project-1")).resolves.toBeUndefined();
    });
  });
});
