"use client";

import { cn } from "@/lib/utils";

interface SkeletonProps {
  className?: string;
}

/**
 * Base skeleton using animate-pulse.
 * Matches the visual weight of real content to prevent CLS.
 */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted", className)}
      aria-hidden="true"
    />
  );
}

/**
 * Project card skeleton — matches the dimensions and layout of
 * the real project card so the grid doesn't shift when content loads.
 */
export function ProjectCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      {/* Image area */}
      <div className="relative aspect-[4/3] bg-muted">
        <Skeleton className="absolute inset-0 rounded-none" />
      </div>
      {/* Content */}
      <div className="p-4">
        <Skeleton className="mb-2 h-5 w-3/4" />
        <Skeleton className="mb-1 h-4 w-1/2" />
        <div className="mt-3 flex items-center gap-2">
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-4 w-20" />
        </div>
      </div>
    </div>
  );
}

/**
 * Room card skeleton — matches the aspect ratio and content
 * layout of the real room card in the project detail grid.
 */
export function RoomCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      {/* Image area */}
      <div className="relative aspect-[4/3] bg-muted">
        <Skeleton className="absolute inset-0 rounded-none" />
        {/* Variant strip placeholder */}
        <div className="absolute bottom-2 left-2 flex gap-1">
          <Skeleton className="h-6 w-6 rounded-full" />
          <Skeleton className="h-6 w-6 rounded-full" />
        </div>
      </div>
      {/* Content */}
      <div className="p-3">
        <Skeleton className="mb-1 h-4 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
  );
}

/**
 * Projects grid skeleton — shows the same grid layout as the
 * real projects page so no CLS when the data loads.
 */
export function ProjectsGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <ProjectCardSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * Room grid skeleton — shows the same grid layout as the
 * real project detail page.
 */
export function RoomGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <RoomCardSkeleton key={i} />
      ))}
    </div>
  );
}
