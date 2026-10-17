/**
 * Issue #1338 — TopBar.
 *
 * The 3-state room pill extracted from the Magic Patterns
 * `TopBar.tsx` `StatusDot`. Reused inside the TopBar's room picker
 * listbox (one dot per room option) and — in a future slice — in the
 * room list of the parent project view's room switcher.
 *
 * Color mapping uses Atelier Canvas tokens:
 *   staged       → `bg-tertiary` (muted sage)  — issue #613
 *   in-progress  → `bg-secondary` (terracotta bronze) — issue #613
 *   empty        → outlined ring (`border-outline`) — neutral
 *
 * Pinned by `tests/edit-room-room-status-dot.test.tsx`.
 */

import type { RoomStatus } from "@/components/edit-room/use-room-status";

interface RoomStatusDotProps {
  status: RoomStatus;
}

/** Per-status visual mapping. Centralized so a future palette tweak is one diff. */
const STATUS_PRESENTATION: Record<
  RoomStatus,
  { className: string; text: string }
> = {
  staged: { className: "bg-tertiary", text: "Staged" },
  "in-progress": { className: "bg-secondary", text: "In progress" },
  empty: {
    className: "border border-outline bg-transparent",
    text: "Not started",
  },
};

export function RoomStatusDot({ status }: RoomStatusDotProps) {
  const presentation = STATUS_PRESENTATION[status];
  return (
    <span className="flex items-center gap-1.5 text-xs text-on-surface-variant">
      <span
        aria-hidden
        className={`h-2 w-2 rounded-full ${presentation.className}`}
      />
      <span>{presentation.text}</span>
    </span>
  );
}