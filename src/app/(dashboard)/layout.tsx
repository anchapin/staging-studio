import { redirect } from "next/navigation";
import { getDashboardUserWithProjects } from "@/lib/dashboard-data";
import { MobileSidebar } from "@/components/dashboard/mobile-sidebar";

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

      {/* Desktop sidebar: static, no JS needed */}
      <aside className="no-print hidden w-64 flex-shrink-0 overflow-y-auto bg-sidebar text-sidebar-foreground md:hidden lg:flex" />

      {/* Mobile/tablet sidebar: interactive client component */}
      <MobileSidebar projects={userRow?.projects ?? []} />

      {/* Main content */}
      <main id="main-content" tabIndex={-1} className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
