import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";

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

  return (
    <div className="flex min-h-screen bg-stone-50">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 bg-stone-900 text-white">
        <div className="flex h-16 items-center border-b border-stone-800 px-6">
          <h1 className="font-cinzel text-lg font-bold tracking-wide">
            Circle G Designs
          </h1>
        </div>

        <nav className="p-4">
          <a
            href="/dashboard"
            className="block rounded-md px-3 py-2 text-sm font-medium text-stone-300 hover:bg-stone-800 hover:text-white"
          >
            Projects
          </a>
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
