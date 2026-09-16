"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const alertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    console.error(
      `[dashboard:error] Unhandled error in dashboard route${error.digest ? ` (digest: ${error.digest})` : ""}`,
      error,
    );
    alertRef.current?.focus();
  }, [error]);

  return (
    // Rendered inside the (dashboard) shell (sidebar stays), so center
    // within the main content region rather than the full viewport.
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md space-y-6 rounded-xl bg-white p-8 text-center shadow-xl">
        <div>
          <h1 className="font-cinzel text-2xl font-bold tracking-tight text-stone-800">
            Something went wrong
          </h1>
          <p className="mt-2 font-playfair text-sm text-stone-600">
            We hit an unexpected problem loading this page. Your projects are
            safe — try again, or head back to your project list.
          </p>
        </div>

        <div
          ref={alertRef}
          role="alert"
          tabIndex={-1}
          className="rounded-md bg-red-50 p-3 text-sm text-red-700 focus:outline-none"
        >
          This page could not be displayed.
          {error.digest && (
            <span className="mt-1 block text-xs text-stone-500">
              Reference: {error.digest}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={reset}
            className="w-full rounded-md bg-stone-800 py-2.5 font-medium text-white transition-colors hover:bg-stone-700 focus:outline-none focus:ring-2 focus:ring-stone-500 focus:ring-offset-2"
          >
            Try again
          </button>
          <Link
            href="/projects"
            className="w-full rounded-md border border-stone-300 bg-white py-2.5 font-medium text-stone-700 transition-colors hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-stone-500 focus:ring-offset-2"
          >
            Back to projects
          </Link>
        </div>
      </div>
    </div>
  );
}
