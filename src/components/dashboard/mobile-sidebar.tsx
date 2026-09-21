"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { SidebarNav } from "@/components/dashboard/sidebar-nav";

interface Project {
  id: string;
  clientName: string;
  propertyAddress: string;
}

interface MobileSidebarProps {
  projects: Project[];
}

/**
 * Mobile/tablet sidebar: off-canvas drawer visible on mobile/tablet,
 * hidden at lg (1024px+) where the static desktop sidebar is always visible.
 * Extracted from DashboardLayout (issue #283) — the layout is a Server
 * Component and cannot use useState; the interactive drawer lives here.
 */
export function MobileSidebar({ projects }: MobileSidebarProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Toggle button: visible on mobile/tablet only (below lg) to open sidebar drawer */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation menu"
        className="fixed left-4 top-4 z-50 flex h-11 w-11 items-center justify-center rounded-md bg-sidebar text-sidebar-foreground shadow-md hover:bg-stone-700 lg:hidden"
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
            className="flex h-11 w-11 items-center justify-center rounded-md hover:bg-stone-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4">
          <Link
            href="/projects/new"
            className="mb-3 flex items-center gap-2 rounded-md bg-background px-4 py-3 text-sm font-medium text-foreground hover:bg-muted"
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
