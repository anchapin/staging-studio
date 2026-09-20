"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutButton } from "@/components/dashboard/sign-out-button";

interface Project {
  id: string;
  clientName: string;
  propertyAddress: string;
}

interface SidebarNavProps {
  projects: Project[];
  /** Called when a nav link is clicked — used to close the mobile drawer */
  onNavigate?: () => void;
}

export function SidebarNav({ projects, onNavigate }: SidebarNavProps) {
  const pathname = usePathname();

  return (
    <>
      <nav className="px-4 pb-4">
        <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Projects
        </p>
        {projects && projects.length > 0 ? (
          <ul className="space-y-1">
            {projects.map((project) => {
              const isActive = pathname === `/projects/${project.id}`;
              return (
                <li key={project.id}>
                  <Link
                    href={`/projects/${project.id}`}
                    onClick={onNavigate}
                    className={`block rounded-md px-3 py-2 text-sm ${
                      isActive
                        ? "text-foreground font-medium"
                        : "text-muted-foreground"
                    } hover:bg-accent hover:text-accent-foreground`}
                  >
                    <span className="truncate font-medium" title={project.clientName}>{project.clientName}</span>
                    <br />
                    <span className={`truncate block text-xs ${isActive ? "text-foreground/80" : "text-muted-foreground"}`} title={project.propertyAddress}>
                      {project.propertyAddress}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-3 py-2 text-sm text-muted-foreground">No projects yet</p>
        )}
      </nav>

      <div className="bottom-0 w-64 border-t border-sidebar-border p-4">
        <Link
          href="/settings"
          onClick={onNavigate}
          className={`mb-1 block rounded-md px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground ${
            pathname === "/settings" ? "text-foreground" : "text-muted-foreground"
          }`}
        >
          Settings
        </Link>
        <SignOutButton />
      </div>
    </>
  );
}
