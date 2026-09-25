import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  getDashboardUserWithProjects,
  getProjectDetailForUser,
} from "@/lib/dashboard-data";
import { prisma } from "@/lib/prisma";
import { createSupabaseRequestClient } from "@/lib/supabase";

// `cache()` is React's per-request dedup wrapper; neutralize it so every
// test call runs the loaders against freshly reset mocks instead of a
// memoized first result.
vi.mock("react", () => ({
  cache: <T>(fn: T) => fn,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    project: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/supabase", () => ({
  createSupabaseRequestClient: vi.fn(),
}));

const supabaseClient = createSupabaseRequestClient as unknown as Mock;
const userFindUnique = prisma.user.findUnique as unknown as Mock;
const projectFindUnique = prisma.project.findUnique as unknown as Mock;

const USER_EMAIL = "stager@circleg.design";
const USER_ID = "user-1";
const PROJECT_ID = "project-1";

const userRow = {
  id: USER_ID,
  darkMode: false,
  projects: [],
};

let getUser: Mock;

beforeEach(() => {
  vi.resetAllMocks();
  getUser = vi.fn();
  supabaseClient.mockResolvedValue({ auth: { getUser } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getDashboardUserWithProjects — auth + user resolution", () => {
  it("fails closed: no Supabase session → null email, null row, and no Prisma query", async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    const result = await getDashboardUserWithProjects();

    expect(result).toEqual({ sessionEmail: null, userRow: null });
    expect(userFindUnique).not.toHaveBeenCalled();
  });

  it("fails closed: a session user without an email never queries Prisma", async () => {
    getUser.mockResolvedValue({ data: { user: { email: null } } });

    const result = await getDashboardUserWithProjects();

    expect(result).toEqual({ sessionEmail: null, userRow: null });
    expect(userFindUnique).not.toHaveBeenCalled();
  });

  it("resolves the Prisma User by the JWT's verified email", async () => {
    getUser.mockResolvedValue({ data: { user: { email: USER_EMAIL } } });
    userFindUnique.mockResolvedValue(userRow);

    const result = await getDashboardUserWithProjects();

    expect(result).toEqual({ sessionEmail: USER_EMAIL, userRow });
    expect(userFindUnique).toHaveBeenCalledTimes(1);
    expect(userFindUnique).toHaveBeenCalledWith({
      where: { email: USER_EMAIL },
      select: expect.anything(),
    });
  });

  it("authenticated but unprovisioned (no Prisma row) → email set, row null", async () => {
    getUser.mockResolvedValue({ data: { user: { email: USER_EMAIL } } });
    userFindUnique.mockResolvedValue(null);

    await expect(getDashboardUserWithProjects()).resolves.toEqual({
      sessionEmail: USER_EMAIL,
      userRow: null,
    });
  });

  it("orders the sidebar's project list by updatedAt desc", async () => {
    getUser.mockResolvedValue({ data: { user: { email: USER_EMAIL } } });
    userFindUnique.mockResolvedValue(userRow);

    await getDashboardUserWithProjects();

    const select = userFindUnique.mock.calls[0][0].select;
    expect(select.projects.orderBy).toEqual({ updatedAt: "desc" });
  });
});

describe("getProjectDetailForUser — ownership scoping", () => {
  const authedAndProvisioned = () => {
    getUser.mockResolvedValue({ data: { user: { email: USER_EMAIL } } });
    userFindUnique.mockResolvedValue(userRow);
  };

  it("fails closed when unauthenticated — never reaches the project query", async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    await expect(getProjectDetailForUser(PROJECT_ID)).resolves.toBeNull();
    expect(projectFindUnique).not.toHaveBeenCalled();
  });

  it("fails closed when the session user has no Prisma row (unprovisioned)", async () => {
    getUser.mockResolvedValue({ data: { user: { email: USER_EMAIL } } });
    userFindUnique.mockResolvedValue(null);

    await expect(getProjectDetailForUser(PROJECT_ID)).resolves.toBeNull();
    expect(projectFindUnique).not.toHaveBeenCalled();
  });

  it("scopes the project lookup to the owning user: where { id, userId }", async () => {
    authedAndProvisioned();
    const projectRow = { id: PROJECT_ID, propertyAddress: "123 Main St" };
    projectFindUnique.mockResolvedValue(projectRow);

    await expect(getProjectDetailForUser(PROJECT_ID)).resolves.toBe(projectRow);

    expect(projectFindUnique).toHaveBeenCalledTimes(1);
    expect(projectFindUnique).toHaveBeenCalledWith({
      where: { id: PROJECT_ID, userId: USER_ID },
      select: expect.anything(),
    });
  });

  it("a project owned by someone else collapses to null (not-found, not leaked)", async () => {
    authedAndProvisioned();
    projectFindUnique.mockResolvedValue(null);

    await expect(getProjectDetailForUser(PROJECT_ID)).resolves.toBeNull();
  });

  it("loads rooms in creation order with only the latest pending inpaint request", async () => {
    authedAndProvisioned();
    projectFindUnique.mockResolvedValue(null);

    await getProjectDetailForUser(PROJECT_ID);

    const select = projectFindUnique.mock.calls[0][0].select;
    expect(select.rooms.orderBy).toEqual({ createdAt: "asc" });
    expect(select.rooms.select.inpaintRequests.where).toEqual({
      status: { in: ["IN_QUEUE", "IN_PROGRESS"] },
    });
    expect(select.rooms.select.inpaintRequests.take).toBe(1);
  });
});
