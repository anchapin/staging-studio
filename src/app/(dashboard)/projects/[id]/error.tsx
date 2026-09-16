"use client";

/**
 * Error boundary for the /projects/[id] segment (issue #83). The project
 * is server-rendered now, so a failed server read lands here instead of a
 * client fetch — this keeps the old red "Couldn't load this project."
 * container and its retry affordance for server-side failures. Client-side
 * refetch failures still render the equivalent container inside
 * project-detail-view.
 */
export default function ProjectDetailError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="p-8">
      <div
        role="alert"
        className="mx-auto mt-8 max-w-lg rounded-lg border border-red-200 bg-red-50 p-6 text-center"
      >
        <p className="text-red-700">Couldn&apos;t load this project.</p>
        <button
          onClick={reset}
          className="mt-4 rounded-md bg-stone-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-700"
        >
          Retry
        </button>
        <a
          href="/dashboard"
          className="mt-4 block text-stone-600 hover:underline text-sm"
        >
          Back to dashboard
        </a>
      </div>
    </div>
  );
}
