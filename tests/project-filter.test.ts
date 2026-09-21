import { describe, expect, it } from "vitest";
import {
  filterProjects,
  isRecent,
  type ProjectFilterParams,
} from "@/lib/project-filter";

type Project = {
  id: string;
  propertyAddress: string;
  clientName: string;
  stagingAesthetic: string;
  createdAt: Date;
  updatedAt: Date;
  rooms: { id: string; name: string; afterImageUrl: string | null; afterImageUrl2: string | null }[];
};

const BASE_PROJECTS: Project[] = [
  {
    id: "1",
    propertyAddress: "123 Oak Lane",
    clientName: "Alice Smith",
    stagingAesthetic: "Modern",
    createdAt: new Date("2024-01-15"),
    updatedAt: new Date("2024-06-01"),
    rooms: [{ id: "r1", name: "Living Room", afterImageUrl: null, afterImageUrl2: null }],
  },
  {
    id: "2",
    propertyAddress: "456 Pine Ave",
    clientName: "Bob Jones",
    stagingAesthetic: "Traditional",
    createdAt: new Date("2024-02-20"),
    updatedAt: new Date("2024-03-10"),
    rooms: [
      { id: "r2", name: "Kitchen", afterImageUrl: "https://example.com/kitchen.jpg", afterImageUrl2: null },
    ],
  },
  {
    id: "3",
    propertyAddress: "789 Elm Blvd",
    clientName: "Carol White",
    stagingAesthetic: "Scandinavian",
    createdAt: new Date("2024-03-25"),
    updatedAt: new Date("2024-01-05"),
    rooms: [
      { id: "r3", name: "Bedroom", afterImageUrl: null, afterImageUrl2: null },
      { id: "r4", name: "Bathroom", afterImageUrl: null, afterImageUrl2: null },
    ],
  },
  {
    id: "4",
    propertyAddress: "321 Maple Dr",
    clientName: "David Brown",
    stagingAesthetic: "Industrial",
    createdAt: new Date("2024-04-10"),
    updatedAt: new Date("2024-07-20"),
    rooms: [
      { id: "r5", name: "Office", afterImageUrl: "https://example.com/office.jpg", afterImageUrl2: "https://example.com/office2.jpg" },
    ],
  },
];

const DEFAULT_PARAMS: ProjectFilterParams = {
  query: "",
  status: "all",
  sortField: "updatedAt",
  sortOrder: "desc",
};

describe("isRecent", () => {
  it("returns true for dates within the last 7 days", () => {
    const now = new Date();
    const threeDaysAgo = new Date(now);
    threeDaysAgo.setDate(now.getDate() - 3);
    expect(isRecent(threeDaysAgo)).toBe(true);
  });

  it("returns false for dates older than 7 days", () => {
    const now = new Date();
    const tenDaysAgo = new Date(now);
    tenDaysAgo.setDate(now.getDate() - 10);
    expect(isRecent(tenDaysAgo)).toBe(false);
  });
});

describe("filterProjects", () => {
  describe("query filtering", () => {
    it("returns all projects when query is empty", () => {
      const result = filterProjects(BASE_PROJECTS, { ...DEFAULT_PARAMS, query: "" });
      expect(result).toHaveLength(4);
    });

    it("matches propertyAddress case-insensitively", () => {
      const result = filterProjects(BASE_PROJECTS, { ...DEFAULT_PARAMS, query: "oak" });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("1");
    });

    it("matches clientName case-insensitively", () => {
      const result = filterProjects(BASE_PROJECTS, { ...DEFAULT_PARAMS, query: "alice" });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("1");
    });

    it("matches stagingAesthetic case-insensitively", () => {
      const result = filterProjects(BASE_PROJECTS, { ...DEFAULT_PARAMS, query: "scandinavian" });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("3");
    });

    it("matches across multiple fields", () => {
      const result = filterProjects(BASE_PROJECTS, { ...DEFAULT_PARAMS, query: "traditional" });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("2");
    });

    it("returns empty array when no matches", () => {
      const result = filterProjects(BASE_PROJECTS, { ...DEFAULT_PARAMS, query: "nonexistent" });
      expect(result).toHaveLength(0);
    });

    it("trims whitespace from query", () => {
      const result = filterProjects(BASE_PROJECTS, { ...DEFAULT_PARAMS, query: "  oak  " });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("1");
      expect(result[0].propertyAddress).toBe("123 Oak Lane");
    });
  });

  describe("status filtering", () => {
    it('returns all projects when status is "all"', () => {
      const result = filterProjects(BASE_PROJECTS, { ...DEFAULT_PARAMS, status: "all" });
      expect(result).toHaveLength(4);
    });

    it('returns only staged projects when status is "staged"', () => {
      const result = filterProjects(BASE_PROJECTS, { ...DEFAULT_PARAMS, status: "staged" });
      expect(result).toHaveLength(2);
      expect(result.map((p) => p.id)).toEqual(["4", "2"]);
    });

    it('returns only non-staged projects when status is "not-staged"', () => {
      const result = filterProjects(BASE_PROJECTS, { ...DEFAULT_PARAMS, status: "not-staged" });
      expect(result).toHaveLength(2);
      const ids = result.map((p) => p.id);
      expect(ids).toContain("1");
      expect(ids).toContain("3");
    });
  });

  describe("sorting", () => {
    it("sorts by updatedAt descending by default", () => {
      const result = filterProjects(BASE_PROJECTS, { ...DEFAULT_PARAMS, sortField: "updatedAt", sortOrder: "desc" });
      expect(result[0].id).toBe("4");
      expect(result[1].id).toBe("1");
      expect(result[2].id).toBe("2");
      expect(result[3].id).toBe("3");
    });

    it("sorts by updatedAt ascending", () => {
      const result = filterProjects(BASE_PROJECTS, { ...DEFAULT_PARAMS, sortField: "updatedAt", sortOrder: "asc" });
      expect(result[0].id).toBe("3");
      expect(result[1].id).toBe("2");
      expect(result[2].id).toBe("1");
      expect(result[3].id).toBe("4");
    });

    it("sorts by createdAt descending", () => {
      const result = filterProjects(BASE_PROJECTS, { ...DEFAULT_PARAMS, sortField: "createdAt", sortOrder: "desc" });
      expect(result[0].id).toBe("4");
      expect(result[1].id).toBe("3");
      expect(result[2].id).toBe("2");
      expect(result[3].id).toBe("1");
    });

    it("sorts by createdAt ascending", () => {
      const result = filterProjects(BASE_PROJECTS, { ...DEFAULT_PARAMS, sortField: "createdAt", sortOrder: "asc" });
      expect(result[0].id).toBe("1");
      expect(result[1].id).toBe("2");
      expect(result[2].id).toBe("3");
      expect(result[3].id).toBe("4");
    });

    it("sorts by propertyAddress ascending", () => {
      const result = filterProjects(BASE_PROJECTS, { ...DEFAULT_PARAMS, sortField: "propertyAddress", sortOrder: "asc" });
      expect(result[0].id).toBe("1");
      expect(result[1].id).toBe("4");
      expect(result[2].id).toBe("2");
      expect(result[3].id).toBe("3");
    });

    it("sorts by propertyAddress descending", () => {
      const result = filterProjects(BASE_PROJECTS, { ...DEFAULT_PARAMS, sortField: "propertyAddress", sortOrder: "desc" });
      expect(result[0].id).toBe("3");
      expect(result[1].id).toBe("2");
      expect(result[2].id).toBe("4");
      expect(result[3].id).toBe("1");
    });

    it("sorts by clientName ascending", () => {
      const result = filterProjects(BASE_PROJECTS, { ...DEFAULT_PARAMS, sortField: "clientName", sortOrder: "asc" });
      expect(result[0].id).toBe("1");
      expect(result[1].id).toBe("2");
      expect(result[2].id).toBe("3");
      expect(result[3].id).toBe("4");
    });

    it("sorts by clientName descending", () => {
      const result = filterProjects(BASE_PROJECTS, { ...DEFAULT_PARAMS, sortField: "clientName", sortOrder: "desc" });
      expect(result[0].id).toBe("4");
      expect(result[1].id).toBe("3");
      expect(result[2].id).toBe("2");
      expect(result[3].id).toBe("1");
    });
  });

  describe("combined filtering", () => {
    it("applies query and status filters together", () => {
      const result = filterProjects(BASE_PROJECTS, {
        ...DEFAULT_PARAMS,
        query: "oak",
        status: "staged",
      });
      expect(result).toHaveLength(0);
    });

    it("applies query and sorting together", () => {
      const result = filterProjects(BASE_PROJECTS, {
        ...DEFAULT_PARAMS,
        query: "scandinavian",
        sortField: "clientName",
        sortOrder: "asc",
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("3");
    });
  });
});
