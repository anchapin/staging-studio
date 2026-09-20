import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getDashboardUserWithProjects } from "@/lib/dashboard-data";
import { buttonVariants } from "@/components/ui/button";
import { ProjectsGridSkeleton } from "@/components/ui/skeleton";

function hasStagedResults(project: { rooms: { afterImageUrl: string | null; afterImageUrl2: string | null }[] }): boolean {
  return project.rooms.some((room) => room.afterImageUrl || room.afterImageUrl2);
}

function isRecent(updatedAt: Date): boolean {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  return updatedAt > sevenDaysAgo;
}

/**
 * Async data-fetching component — extracted so Suspense can boundary it.
 * Suspense shows the skeleton while this resolves, preventing blank-screen CLS.
 */
async function ProjectsGrid() {
  const { sessionEmail, userRow } = await getDashboardUserWithProjects();
  if (!sessionEmail) redirect("/login");
  if (!userRow) redirect("/setup");
  return (
    <>
      {userRow.projects.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-border p-12 text-center">
          <p className="text-muted-foreground">No projects yet.</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground/80">
            Create your first staging project to get started.
          </p>
          <Link
            href="/projects/new"
            className={buttonVariants({ variant: "default" })}
          >
            Create Project
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {userRow.projects.map((project, index) => {
            const staged = hasStagedResults(project);
            const recent = isRecent(new Date(project.updatedAt));
            const isFeatured = index === 0;

            return (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className={`
                  group relative rounded-lg border bg-background shadow-sm transition-all hover:shadow-md
                  ${isFeatured ? "col-span-2 row-span-2 p-8 lg:col-span-2 lg:row-span-2" : "p-5"}
                  ${recent && !isFeatured ? "border-amber-200 bg-gradient-to-br from-amber-50/50 to-background" : "border-border"}
                  ${!recent && !isFeatured && staged ? "border-emerald-100" : ""}
                `}
              >
                {isFeatured && (
                  <div className="mb-2 flex items-center gap-2">
                    <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                      Featured
                    </span>
                    {recent && (
                      <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                        Recently Updated
                      </span>
                    )}
                  </div>
                )}

                {!isFeatured && staged && (
                  <div className="absolute right-3 top-3">
                    <span className="flex h-2 w-2">
                      <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                    </span>
                  </div>
                )}

                <h2 className={`font-playfair font-semibold text-foreground ${isFeatured ? "text-2xl" : "text-lg"}`}>
                  {project.propertyAddress}
                </h2>
                <p className={`mt-1 text-muted-foreground ${isFeatured ? "text-base" : "text-sm leading-relaxed"}`}>
                  {project.clientName}
                </p>

                <div className={`flex items-center justify-between ${isFeatured ? "mt-5" : "mt-3"}`}>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full bg-secondary ${isFeatured ? "px-3 py-1 text-sm" : "px-2.5 py-0.5 text-xs"} font-medium text-foreground`}>
                      {project.stagingAesthetic}
                    </span>
                    {staged && (
                      <span className={`rounded-full bg-emerald-100 ${isFeatured ? "px-3 py-1 text-sm" : "px-2.5 py-0.5 text-xs"} font-medium text-emerald-700`}>
                        Staged
                      </span>
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
      )}
    </>
  );
}

/**
 * Server-rendered projects list (issue #83). Reads Prisma through the same
 * request-cached loader the (dashboard) layout uses for the sidebar, so one
 * navigation runs one auth check and one query — no client auth
 * round-trip gates the first paint. Errors surface through this segment's
 * error boundary (error.tsx keeps the old "Failed to load projects." UI).
 *
 * Suspense boundary prevents blank-screen CLS while the async data loads.
 */
export default async function ProjectsPage() {
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

      <Suspense fallback={<ProjectsGridSkeleton count={6} />}>
        <ProjectsGrid />
      </Suspense>
    </div>
  );
}
