export default function DashboardLoading() {
  // Simple centered spinner inside the dashboard shell — the sidebar layout
  // is stable during load, so this cannot shift layout. Deliberately not a
  // page-shaped skeleton: content varies per route (issue #89).
  return (
    <div className="flex min-h-screen items-center justify-center" aria-busy="true">
      <div
        className="h-10 w-10 animate-spin rounded-full border-4 border-stone-200 border-t-stone-800"
        aria-hidden="true"
      />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
