import Link from "next/link";
import { redirect } from "next/navigation";
import { getDashboardUserWithProjects } from "@/lib/dashboard-data";
import { buttonVariants } from "@/components/ui/button";

/**
 * Server-rendered projects list (issue #83). Reads Prisma through the same
 * request-cached loader the (dashboard) layout uses for the sidebar, so one
 * navigation runs one auth check and one query — no client auth
 * round-trip gates the first paint. Errors surface through this segment's
 * error boundary (error.tsx keeps the old "Failed to load projects." UI).
 */
export default async function ProjectsPage() {
  // Defensive: the layout awaits this same cached call and redirects
  // unauthenticated/unprovisioned users before any data can render.
  const { sessionEmail, userRow } = await getDashboardUserWithProjects();
  if (!sessionEmail) redirect("/login");
  if (!userRow) redirect("/setup");

  const projects = userRow.projects;

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

      {projects.length === 0 ? (
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
          {projects.map((project) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className="rounded-lg border border-border bg-background p-6 shadow-sm transition-shadow hover:shadow-md"
            >
              <h2 className="font-playfair text-lg font-semibold text-foreground">
                {project.propertyAddress}
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{project.clientName}</p>
              <div className="mt-3 flex items-center justify-between">
                <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-foreground">
                  {project.stagingAesthetic}
                </span>
                <span className="text-xs text-muted-foreground">
                  {project.rooms.length} room
                  {project.rooms.length !== 1 ? "s" : ""}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
