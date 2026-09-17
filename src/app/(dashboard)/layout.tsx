import { redirect } from "next/navigation";
import Link from "next/link";
import { getDashboardUserWithProjects } from "@/lib/dashboard-data";
import { SignOutButton } from "@/components/dashboard/sign-out-button";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Shared, request-cached loader (issue #83): the pages this layout wraps
  // (/projects, /projects/[id]) await the same function and reuse this
  // result — one auth round-trip + one Prisma query per navigation.
  const { sessionEmail, userRow } = await getDashboardUserWithProjects();

  if (!sessionEmail) {
    redirect("/login");
  }

  // Authenticated but never provisioned (password-first signup, fresh
  // DB): every mutation would 404 with "User not found in database".
  // Middleware passes /setup through for authenticated users, so send
  // them to complete setup instead of rendering a dead-end.
  if (!userRow) {
    redirect("/setup");
  }

  return (
    <div className="flex min-h-screen bg-stone-50">
      {/* Skip link: first focusable element, jumps past the sidebar nav */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-stone-900 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        Skip to main content
      </a>

      {/* Sidebar */}
      <aside className="no-print w-64 flex-shrink-0 bg-stone-900 text-white">
        <div className="flex h-16 items-center border-b border-stone-800 px-6">
          <p className="font-cinzel text-lg font-bold tracking-wide">
            Circle G Designs
          </p>
        </div>

        <div className="p-4">
          <Link
            href="/projects/new"
            className="mb-3 flex items-center gap-2 rounded-md bg-white px-3 py-2 text-sm font-medium text-stone-900 hover:bg-stone-100"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
            >
              <path d="M5 12h14" />
              <path d="M12 5v14" />
            </svg>
            New Project
          </Link>
        </div>

        <nav className="px-4 pb-4">
          <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-stone-400">
            Projects
          </p>
          {userRow?.projects && userRow.projects.length > 0 ? (
            <ul className="space-y-1">
              {userRow.projects.map((project) => (
                <li key={project.id}>
                  <Link
                    href={`/projects/${project.id}`}
                    className="block rounded-md px-3 py-2 text-sm text-stone-300 hover:bg-stone-800 hover:text-white"
                  >
                    <span className="font-medium">{project.clientName}</span>
                    <br />
                    <span className="text-xs text-stone-400">
                      {project.propertyAddress}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-2 text-sm text-stone-400">No projects yet</p>
          )}
        </nav>

        <div className="absolute bottom-0 w-64 border-t border-stone-800 p-4">
          <Link
            href="/settings"
            className="mb-1 block rounded-md px-3 py-2 text-sm font-medium text-stone-400 hover:bg-stone-800 hover:text-white"
          >
            Settings
          </Link>
          <SignOutButton />
        </div>
      </aside>

      {/* Main content */}
      <main id="main-content" tabIndex={-1} className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
