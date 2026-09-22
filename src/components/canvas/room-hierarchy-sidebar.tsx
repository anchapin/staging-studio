"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ChevronDown, ChevronRight, DoorOpen, FolderOpen, Plus, Settings } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  WORKBENCH_SIDEBAR_SURFACE_CLASSES,
  resolveWorkbenchRoomItemState,
  workbenchRoomIndicator,
  workbenchRoomItemClasses,
  workbenchSidebarWidthClass,
} from "@/lib/workbench-layout";

/**
 * Status for a room or camera variant in the hierarchy sidebar.
 * Derived from the presence of before/after images.
 */
export type CameraStatus =
  | "pending" // No before image uploaded
  | "in-progress" // Has before image, no staged result
  | "ready" // Has staged result
  | "staged"; // Complete (before + after = staged)

/**
 * One camera (variant slot) within a room.
 * Issue #634: maps to the room's two image variants (Cam A = slot 0, Cam B = slot 1).
 */
export interface RoomCamera {
  id: string; // e.g., "0" or "1" for variant slot index
  label: string; // e.g., "Cam A" or "360° Panoramic"
  status: CameraStatus;
}

/**
 * One room in the hierarchy tree.
 * Issue #634: rooms contain expandable camera sub-items.
 */
export interface HierarchyRoom {
  id: string;
  name: string;
  /** Thumbnail URL from the room's first before image (48px square). */
  thumbnailUrl?: string | null;
  cameras: RoomCamera[];
  isActive: boolean;
  /**
   * Issue #620: count of completed staged variants — drives the "n Ready"
   * list badge. Defaults to counting staged/ready cameras.
   */
  readyVariantCount?: number;
  /**
   * Issue #620: pending task label shown as the room's badge (e.g.
   * "Declutter"). Only shown while the room is in the pending state.
   */
  pendingTaskLabel?: string | null;
  /**
   * Issue #620: whether the room has any photo at all — false renders the
   * dimmed "Empty" state. Defaults to derived-from-cameras.
   */
  hasPhotos?: boolean;
}

/** Derive camera status from image URLs. */
export function deriveCameraStatus(
  beforeUrl: string | null | undefined,
  afterUrl: string | null | undefined
): CameraStatus {
  if (!beforeUrl) return "pending";
  if (!afterUrl) return "in-progress";
  return "staged";
}

/** Label for a camera status badge. */
export function cameraStatusLabel(status: CameraStatus): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "in-progress":
      return "In Progress";
    case "ready":
      return "Ready";
    case "staged":
      return "Staged";
  }
}

/** CSS class for camera status badge variant. */
export function cameraStatusBadgeVariant(
  status: CameraStatus
): "secondary" | "outline" | "default" {
  switch (status) {
    case "pending":
      return "secondary";
    case "in-progress":
      return "outline";
    case "ready":
      return "secondary";
    case "staged":
      return "default";
  }
}

interface RoomHierarchySidebarProps {
  /** Rooms to display in the hierarchy tree. */
  rooms: HierarchyRoom[];
  /** Callback when a room is selected (becomes active). */
  onSelectRoom: (roomId: string) => void;
  /** Callback when "Add Room Scene" is clicked. */
  onAddRoom: () => void;
  /** Whether the sidebar is collapsed (hidden). */
  isCollapsed: boolean;
  /** Callback when the collapse toggle is clicked. */
  onToggleCollapse: () => void;
  /** Project ID for navigation links. */
  projectId: string;
}

/**
 * Room Hierarchy Sidebar (issue #634).
 *
 * A 256px left sidebar showing the complete room/zone tree with floor plan
 * thumbnail, expand/collapse chevrons, camera sub-items with status badges,
 * an "Add Room Scene" dashed button, and footer navigation.
 *
 * The sidebar is collapsible via `isCollapsed` / `onToggleCollapse`.
 */
export default function RoomHierarchySidebar({
  rooms,
  onSelectRoom,
  onAddRoom,
  isCollapsed,
  onToggleCollapse,
  projectId,
}: RoomHierarchySidebarProps) {
  // Track which rooms are expanded (default: all collapsed)
  const [expandedRooms, setExpandedRooms] = useState<Set<string>>(() => new Set());

  const toggleRoom = (roomId: string) => {
    setExpandedRooms((prev) => {
      const next = new Set(prev);
      if (next.has(roomId)) {
        next.delete(roomId);
      } else {
        next.add(roomId);
      }
      return next;
    });
  };

  return (
    <aside
      className={`relative flex flex-col transition-all duration-300 ease-in-out ${workbenchSidebarWidthClass(
        isCollapsed
      )} ${WORKBENCH_SIDEBAR_SURFACE_CLASSES}`}
      aria-label="Room hierarchy sidebar"
      aria-hidden={isCollapsed}
    >
      {/* Header: floor plan thumbnail + title */}
      <div className="flex flex-col items-center gap-2 border-b border-border p-4">
        {/* Floor plan thumbnail */}
        <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg bg-muted">
          {rooms[0]?.thumbnailUrl ? (
            <Image
              src={rooms[0].thumbnailUrl}
              alt="Floor plan"
              fill
              className="object-cover"
              sizes="48px"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <svg
                className="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z"
                />
              </svg>
            </div>
          )}
        </div>

        {/* Title row */}
        <div className="flex w-full items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold text-foreground">
              Rooms & Zones
            </span>
            <span className="rounded bg-secondary px-1.5 py-0.5 text-xs font-medium text-secondary-foreground">
              {rooms.length}
            </span>
          </div>
          <Badge variant="secondary" size="sm" className="text-[10px]">
            BATCH
          </Badge>
        </div>
      </div>

      {/* Room tree */}
      <nav className="flex-1 overflow-y-auto p-2" aria-label="Room list">
        <ul className="flex flex-col gap-0.5">
          {rooms.map((room) => {
            const isExpanded = expandedRooms.has(room.id);
            // Issue #620: room-list item state (active / pending / ready /
            // empty) drives the row's border, background, icon color, and
            // status indicator. Explicit props win; cameras are the fallback.
            const readyCount =
              room.readyVariantCount ??
              room.cameras.filter(
                (c) => c.status === "staged" || c.status === "ready"
              ).length;
            const hasPhotos =
              room.hasPhotos ?? room.cameras.some((c) => c.status !== "pending");
            const itemState = resolveWorkbenchRoomItemState({
              isActive: room.isActive,
              hasPhotos,
              readyVariantCount: readyCount,
            });
            const itemClasses = workbenchRoomItemClasses(itemState);
            const indicator = workbenchRoomIndicator(
              itemState,
              readyCount,
              room.pendingTaskLabel
            );
            return (
              <li key={room.id}>
                {/* Room header row */}
                <button
                  type="button"
                  onClick={() => {
                    onSelectRoom(room.id);
                    toggleRoom(room.id);
                  }}
                  className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${itemClasses.container}`}
                  aria-expanded={isExpanded}
                  aria-controls={`room-cameras-${room.id}`}
                >
                  {/* Chevron */}
                  {isExpanded ? (
                    <ChevronDown
                      className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  ) : (
                    <ChevronRight
                      className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  )}

                  {/* Room icon — terracotta when active, outline otherwise */}
                  <DoorOpen
                    className={`h-3.5 w-3.5 flex-shrink-0 ${itemClasses.icon}`}
                    aria-hidden="true"
                  />

                  {/* Room name */}
                  <span className="truncate flex-1">{room.name}</span>

                  {/* Status indicator: dot when active, badge otherwise
                      (Issue #620 room item states) */}
                  {indicator.kind === "dot" ? (
                    <span
                      className="h-2 w-2 flex-shrink-0 rounded-full bg-secondary"
                      aria-hidden="true"
                    />
                  ) : (
                    <Badge
                      variant="outline"
                      size="sm"
                      className="flex-shrink-0 text-[10px]"
                    >
                      {indicator.text}
                    </Badge>
                  )}
                </button>

                {/* Camera sub-items */}
                {isExpanded && (
                  <ul
                    id={`room-cameras-${room.id}`}
                    className="ml-6 mt-0.5 flex flex-col gap-0.5"
                  >
                    {room.cameras.map((camera) => (
                      <li key={camera.id}>
                        <button
                          type="button"
                          onClick={() => onSelectRoom(room.id)}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                        >
                          <span className="flex-1 truncate">{camera.label}</span>
                          <Badge
                            variant={cameraStatusBadgeVariant(camera.status)}
                            size="sm"
                            className="text-[10px]"
                          >
                            {cameraStatusLabel(camera.status)}
                          </Badge>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Add Room Scene button */}
      <div className="border-t border-border p-3">
        <button
          type="button"
          onClick={onAddRoom}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-outline-variant/50 px-3 py-2.5 text-xs text-on-surface-variant transition-colors hover:border-secondary/50 hover:text-secondary"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Add Room Scene</span>
        </button>
      </div>

      {/* Footer navigation */}
      <div className="border-t border-border p-3">
        <nav className="flex flex-col gap-1" aria-label="Sidebar navigation">
          <Link
            href={`/projects/${projectId}/settings`}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <Settings className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Project Settings</span>
          </Link>
          <Link
            href={`/projects/${projectId}/assets`}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Asset Library</span>
          </Link>
        </nav>
      </div>

      {/* Collapse toggle — small button at top-right of sidebar */}
      <button
        type="button"
        onClick={onToggleCollapse}
        className="absolute -right-3 top-4 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card shadow-sm hover:bg-accent transition-colors"
        aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {isCollapsed ? (
          <ChevronRight className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-3 w-3 rotate-90 transform text-muted-foreground" aria-hidden="true" />
        )}
      </button>
    </aside>
  );
}
