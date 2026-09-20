"use client";

import { useState } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getDashboardUserWithProjects } from "@/lib/dashboard-data";
import { SidebarNav } from "@/components/dashboard/sidebar-nav";
import { Menu, X } from "lucide-react";

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

  // Fixed-height shell: #main-content below is the scroll container, so
  // `sticky` chrome inside pages (lookbook toolbar, issue #250 feedback)
  // activates and the sidebar stays put while content scrolls.
  return (
    <div className="flex h-screen bg-background">
      {/* Skip link: first focusable element, jumps past the sidebar nav */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Skip to main content
      </a>

      {/* Sidebar: w-64 at lg+, hidden+overlay at md, icon-only toggle at sm */}
      {/* Desktop sidebar */}
      <aside className="no-print hidden w-64 flex-shrink-0 overflow-y-auto bg-sidebar text-sidebar-foreground md:hidden lg:flex" />
      {/* Mobile/tablet sidebar overlay */}
      <SidebarOverlay projects={userRow?.projects ?? []} />

      {/* Main content */}
      <main id="main-content" tabIndex={-1} className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}

/** Mobile/tablet sidebar: off-canvas drawer at md, icon rail at sm */
function SidebarOverlay({ projects }: { projects: { id: string; clientName: string; propertyAddress: string }[] }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Toggle button: visible at md (768px+) to open sidebar drawer */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation menu"
        className="fixed left-4 top-4 z-50 flex h-10 w-10 items-center justify-center rounded-md bg-sidebar text-sidebar-foreground shadow-md hover:bg-stone-700 md:flex lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Overlay backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar drawer */}
      <aside
        className={`
          no-print fixed left-0 top-0 z-50 flex h-full w-64 flex-col overflow-y-auto bg-sidebar text-sidebar-foreground
          transition-transform duration-200 ease-out
          md:relative md:translate-x-0 md:bg-sidebar
          ${open ? "translate-x-0" : "-translate-x-full"}
          lg:hidden
        `}
      >
        <div className="flex h-16 items-center justify-between border-b border-border px-6">
          <p className="font-cinzel text-lg font-bold tracking-wide">
            Circle G Designs
          </p>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close navigation menu"
            className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-stone-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4">
          <Link
            href="/projects/new"
            className="mb-3 flex items-center gap-2 rounded-md bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
            onClick={() => setOpen(false)}
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

        <SidebarNav projects={projects} onNavigate={() => setOpen(false)} />
      </aside>
    </>
  );
}
