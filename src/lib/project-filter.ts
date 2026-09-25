import type { DashboardUserWithProjects } from "@/lib/dashboard-data";

export type SortField = "updatedAt" | "createdAt" | "propertyAddress" | "clientName";
export type SortOrder = "asc" | "desc";
export type StatusFilter = "all" | "staged" | "not-staged";

export interface ProjectFilterParams {
  query: string;
  status: StatusFilter;
  sortField: SortField;
  sortOrder: SortOrder;
}

function hasStagedResults(
  project: DashboardUserWithProjects["projects"][number]
): boolean {
  return project.rooms.some((room) => room.afterImageUrl || room.afterImageUrl2);
}

function matchesQuery(
  project: DashboardUserWithProjects["projects"][number],
  query: string
): boolean {
  const trimmed = query.trim();
  if (!trimmed) return true;
  const lower = trimmed.toLowerCase();
  return (
    project.propertyAddress.toLowerCase().includes(lower) ||
    project.clientName.toLowerCase().includes(lower) ||
    project.stagingAesthetic.toLowerCase().includes(lower)
  );
}

function matchesStatus(
  project: DashboardUserWithProjects["projects"][number],
  status: StatusFilter
): boolean {
  if (status === "all") return true;
  const staged = hasStagedResults(project);
  return status === "staged" ? staged : !staged;
}

function sortProjects(
  projects: DashboardUserWithProjects["projects"],
  sortField: SortField,
  sortOrder: SortOrder
): DashboardUserWithProjects["projects"] {
  return [...projects].sort((a, b) => {
    let cmp = 0;
    switch (sortField) {
      case "propertyAddress":
        cmp = a.propertyAddress.localeCompare(b.propertyAddress);
        break;
      case "clientName":
        cmp = a.clientName.localeCompare(b.clientName);
        break;
      case "createdAt":
        cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        break;
      case "updatedAt":
        cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
        break;
    }
    return sortOrder === "asc" ? cmp : -cmp;
  });
}

export function filterProjects(
  projects: DashboardUserWithProjects["projects"],
  params: ProjectFilterParams
): DashboardUserWithProjects["projects"] {
  let result = projects;

  result = result.filter((p) => matchesQuery(p, params.query));
  result = result.filter((p) => matchesStatus(p, params.status));
  result = sortProjects(result, params.sortField, params.sortOrder);

  return result;
}

export function isRecent(updatedAt: Date): boolean {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  return updatedAt > sevenDaysAgo;
}
