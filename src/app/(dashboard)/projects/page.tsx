import Link from "next/link";
import { redirect } from "next/navigation";
import { getDashboardUserWithProjects } from "@/lib/dashboard-data";

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
          <h1 className="font-playfair text-3xl font-bold text-stone-800">
            Projects
          </h1>
          <p className="mt-1 text-sm text-stone-600">
            Manage your staging lookbooks
          </p>
        </div>

        <Link
          href="/projects/new"
          className="rounded-md bg-stone-800 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-stone-700"
        >
          + New Project
        </Link>
      </div>

      {projects.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-stone-300 p-12 text-center">
          <p className="text-stone-600">No projects yet.</p>
          <p className="mt-1 text-sm text-stone-500">
            Create your first staging project to get started.
          </p>
          <Link
            href="/projects/new"
            className="mt-4 inline-block rounded-md bg-stone-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-700"
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
              className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md"
            >
              <h2 className="font-playfair text-lg font-semibold text-stone-800">
                {project.propertyAddress}
              </h2>
              <p className="mt-1 text-sm text-stone-600">{project.clientName}</p>
              <div className="mt-3 flex items-center justify-between">
                <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-medium text-stone-700">
                  {project.stagingAesthetic}
                </span>
                <span className="text-xs text-stone-500">
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
