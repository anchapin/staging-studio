import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerClient } from "@supabase/ssr";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return [];
        },
        setAll() {},
      },
    }
  );

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    include: {
      projects: {
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          propertyAddress: true,
          clientName: true,
        },
      },
    },
  });

  return (
    <div className="flex min-h-screen bg-stone-50">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 bg-stone-900 text-white">
        <div className="flex h-16 items-center border-b border-stone-800 px-6">
          <h1 className="font-cinzel text-lg font-bold tracking-wide">
            Circle G Designs
          </h1>
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
          <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-stone-500">
            Projects
          </p>
          {user?.projects && user.projects.length > 0 ? (
            <ul className="space-y-1">
              {user.projects.map((project) => (
                <li key={project.id}>
                  <Link
                    href={`/projects/${project.id}`}
                    className="block rounded-md px-3 py-2 text-sm text-stone-300 hover:bg-stone-800 hover:text-white"
                  >
                    <span className="font-medium">{project.clientName}</span>
                    <br />
                    <span className="text-xs text-stone-500">
                      {project.propertyAddress}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-2 text-sm text-stone-500">No projects yet</p>
          )}
        </nav>

        <div className="absolute bottom-0 w-64 border-t border-stone-800 p-4">
          <a
            href="/api/auth/signout"
            className="block rounded-md px-3 py-2 text-sm font-medium text-stone-400 hover:bg-stone-800 hover:text-white"
          >
            Sign Out
          </a>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
