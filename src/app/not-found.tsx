import Link from "next/link";

export default function NotFound() {
  // Mirrors the /login visual language: centered white card on the stone
  // gradient, Cinzel brand, Playfair supporting copy (issue #89).
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-stone-100 to-stone-200 px-4">
      <div className="w-full max-w-md space-y-8 rounded-xl bg-white p-8 text-center shadow-xl">
        <div>
          <h1 className="font-cinzel text-3xl font-bold tracking-tight text-stone-800">
            StagingStudio
          </h1>
          <p className="mt-2 font-playfair text-sm text-stone-600">
            AI-Assisted Home Staging Lookbooks
          </p>
        </div>

        <div>
          <p className="font-cinzel text-4xl font-bold text-stone-400">404</p>
          <p className="mt-3 font-playfair text-stone-700">
            This page could not be found.
          </p>
          <p className="mt-1 text-sm text-stone-500">
            It may have been moved, or the address was entered incorrectly.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <Link
            href="/projects"
            className="w-full rounded-md bg-stone-800 py-2.5 font-medium text-white transition-colors hover:bg-stone-700 focus:outline-none focus:ring-2 focus:ring-stone-500 focus:ring-offset-2"
          >
            Go to projects
          </Link>
          <Link
            href="/dashboard"
            className="w-full rounded-md border border-stone-300 bg-white py-2.5 font-medium text-stone-700 transition-colors hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-stone-500 focus:ring-offset-2"
          >
            Go to dashboard
          </Link>
        </div>

        <p className="text-center text-xs text-stone-500">
          For Circle G Designs — Lauren Chapin
        </p>
      </div>
    </div>
  );
}
