"use client";

/**
 * Error boundary for the /projects segment (issue #83). The list is
 * server-rendered now, so a failed Prisma/auth read lands here instead of
 * a client fetch — this keeps the old red "Failed to load projects."
 * container and its retry affordance.
 */
export default function ProjectsError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="p-8">
      <div
        role="alert"
        className="rounded-lg border border-red-200 bg-red-50 p-6 text-center"
      >
        <p className="text-red-700">Failed to load projects.</p>
        <button
          onClick={reset}
          className="mt-4 rounded-md bg-stone-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-700"
        >
          Retry
        </button>
      </div>
    </div>
  );
}
