import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { FolderPlus } from "lucide-react";
import { Suspense } from "react";
import { getDashboardUserWithProjects } from "@/lib/dashboard-data";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProjectsGridSkeleton } from "@/components/ui/skeleton";
import { ProjectSearchFilter } from "@/components/dashboard/project-search-filter";
import { filterProjects, isRecent } from "@/lib/project-filter";
import type { StatusFilter, SortField, SortOrder } from "@/lib/project-filter";

function hasStagedResults(
  project: { rooms: { afterImageUrl: string | null; afterImageUrl2: string | null }[] }
): boolean {
  return project.rooms.some((room) => room.afterImageUrl || room.afterImageUrl2);
}

interface ProjectsGridProps {
  query: string;
  status: StatusFilter;
  sortField: SortField;
  sortOrder: SortOrder;
}

async function ProjectsGrid({ query, status, sortField, sortOrder }: ProjectsGridProps) {
  const { sessionEmail, userRow } = await getDashboardUserWithProjects();
  if (!sessionEmail) redirect("/login");
  if (!userRow) redirect("/setup");

  const filteredProjects = filterProjects(userRow.projects, {
    query,
    status,
    sortField,
    sortOrder,
  });

  if (filteredProjects.length === 0) {
    if (userRow.projects.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border p-12 text-center">
          <FolderPlus className="mb-3 h-10 w-10 text-muted-foreground" aria-hidden="true" />
          <p className="font-medium text-foreground">No projects yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create your first staging project to get started.
          </p>
          <Link
            href="/projects/new"
            className={buttonVariants({ variant: "default" })}
          >
            Create Project
          </Link>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border p-12 text-center">
        <p className="font-medium text-foreground">No projects match your filters</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Try adjusting your search or filter criteria.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {filteredProjects.map((project, index) => {
        const staged = hasStagedResults(project);
        const recent = isRecent(new Date(project.updatedAt));
        const isFeatured = index === 0;

        return (
          <Link
            key={project.id}
            href={`/projects/${project.id}`}
            className={`
              group relative rounded-lg border bg-background shadow-sm transition-all hover:shadow-md
              ${isFeatured ? "col-span-1 md:col-span-1 lg:col-span-2 row-span-1 lg:row-span-2 p-4 lg:p-8" : "p-5"}
              ${recent && !isFeatured ? "border-amber-200 bg-gradient-to-br from-amber-50/50 to-background" : "border-border"}
              ${!recent && !isFeatured && staged ? "border-emerald-100" : ""}
            `}
          >
            {isFeatured && (
              <div className="mb-2 flex items-center gap-2">
                <Badge variant="warning" size={isFeatured ? "lg" : "default"}>
                  Featured
                </Badge>
                {recent && (
                  <Badge variant="success" size={isFeatured ? "lg" : "default"}>
                    Recently Updated
                  </Badge>
                )}
              </div>
            )}

            {!isFeatured && staged && (
              <div className="absolute right-3 top-3">
                <span className="flex h-2 w-2">
                  <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-success/40 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
                </span>
              </div>
            )}

            <h2 className={`font-playfair font-semibold text-foreground ${isFeatured ? "text-lg md:text-xl lg:text-2xl" : "text-lg"}`}>
              {project.propertyAddress}
            </h2>
            <p className={`mt-1 text-muted-foreground ${isFeatured ? "text-base" : "text-sm leading-relaxed"}`}>
              {project.clientName}
            </p>

            <div className={`flex items-center justify-between ${isFeatured ? "mt-5" : "mt-3"}`}>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" size={isFeatured ? "lg" : "default"}>
                  {project.stagingAesthetic}
                </Badge>
                {staged && (
                  <Badge variant="success" size={isFeatured ? "lg" : "default"}>
                    Staged
                  </Badge>
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                {project.rooms.length} room{project.rooms.length !== 1 ? "s" : ""}
              </span>
            </div>

            {isFeatured && project.rooms.length > 0 && (
              <div className="mt-4 grid grid-cols-2 gap-2">
                {project.rooms.slice(0, 4).map((room) => (
                  <div
                    key={room.id}
                    className="aspect-video overflow-hidden rounded-md bg-secondary"
                  >
                    {room.afterImageUrl ? (
                      <Image
                        src={room.afterImageUrl}
                        alt={room.name}
                        fill
                        className="object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                        {room.name}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Link>
        );
      })}
    </div>
  );
}

interface ProjectsPageProps {
  searchParams: Promise<{
    q?: string;
    status?: string;
    sort?: string;
    order?: string;
  }>;
}

export default async function ProjectsPage({ searchParams }: ProjectsPageProps) {
  const params = await searchParams;
  const query = params.q ?? "";
  const status = (params.status as StatusFilter) ?? "all";
  const sortField = (params.sort as SortField) ?? "updatedAt";
  const sortOrder = (params.order as SortOrder) ?? "desc";

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="font-playfair text-3xl font-bold text-foreground">
            Projects
          </h1>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Manage your staging lookbooks
          </p>
        </div>

        <Link
          href="/projects/new"
          className={buttonVariants({ variant: "default" })}
        >
          + New Project
        </Link>
      </div>

      <div className="mb-6">
        <ProjectSearchFilter
          defaultQuery={query}
          defaultStatus={status}
          defaultSortField={sortField}
          defaultSortOrder={sortOrder}
        />
      </div>

      <Suspense fallback={<ProjectsGridSkeleton count={6} />}>
        <ProjectsGrid
          query={query}
          status={status}
          sortField={sortField}
          sortOrder={sortOrder}
        />
      </Suspense>
    </div>
  );
}
