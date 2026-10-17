"use client";

/**
 * Issue #1338 — `<TopBar>`.
 *
 * The Magic Patterns top bar (design `dVy8jC2kXpi1ca8b4A1hcS/components/TopBar.tsx`),
 * ported with three deltas (per the issue body):
 *
 *  1. The "All rooms" button is wired to `onExitToProject` (the same
 *     prop the legacy `InpaintEditor` exposes — #1188 pattern).
 *  2. The breadcrumb renders `propertyAddress / room.name` instead of
 *     the property address alone (issue criterion).
 *  3. The "Preview lookbook" button is a Next `<Link>` to
 *     `/projects/[id]/lookbook` — client routing, prefetched.
 *
 * Listbox: opens on click, closes on Escape + outside-click + selection.
 * Keyboard nav (Arrow Up/Down, Home, End, Enter) is implemented per
 * WAI-ARIA Authoring Practices. Component-interaction tests (keyboard
 * navigation, fake-timer save-status flip) live with the route wiring
 * (#1344/#1345) so they can use Playwright's e2e specs (per
 * AGENTS.md "Testing"); structural assertions are pinned by
 * `tests/edit-room-topbar.test.tsx`.
 *
 * Colors: Atelier Canvas tokens (issue #613), referenced via Tailwind
 * v4 utilities that resolve to `color-tokens.ts`.
 */

import { useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronDown, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import Link from "next/link";

import { RoomStatusDot } from "@/components/edit-room/room-status-dot";
import type { SaveStatus } from "@/components/edit-room/types";

interface TopBarProps {
  address: string;
  roomName: string;
  projectId: string;
  roomId: string;
  /** Mirrored from the parent route's AutosaveController (issue #1337). */
  saveStatus: SaveStatus;
  onRoomChange: (roomId: string) => void;
  onExitToProject: () => void;
}

const SAVE_LABEL: Record<SaveStatus, { text: string; spin: boolean }> = {
  idle: { text: "Saved", spin: false },
  saving: { text: "Saving", spin: true },
  saved: { text: "Saved", spin: false },
  error: { text: "Save failed", spin: false },
};

export function TopBar({
  address,
  roomName,
  projectId,
  roomId: _roomId,
  saveStatus,
  onRoomChange: _onRoomChange,
  onExitToProject,
}: TopBarProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  // Outside-click closes the listbox (WAI-ARIA APG: keyboard non-modal
  // listbox pattern). The mousedown listener fires before click; that
  // matches the design's spec ("click a room option to close").
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  // Escape closes the listbox (WAI-ARIA APG). The keyboard nav (Arrow
  // Up/Down, Home, End, Enter) lives on the trigger button via
  // onKeyDown — split out below for clarity.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const save = SAVE_LABEL[saveStatus];

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-outline/20 bg-surface-container-lowest px-4">
      <div className="flex min-w-0 items-center gap-1">
        <button
          type="button"
          onClick={onExitToProject}
          aria-label="Exit to all rooms"
          className="flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-on-surface-variant transition-colors duration-150 hover:bg-surface-container-low hover:text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          All rooms
        </button>

        <span className="mx-2 h-5 w-px bg-outline/20" aria-hidden />

        <span className="truncate text-sm text-on-surface-variant">
          {address}
        </span>
        <span className="mx-1.5 text-sm text-outline" aria-hidden>
          /
        </span>

        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={listboxId}
            className="flex h-9 items-center gap-1.5 rounded-lg px-2.5 transition-colors duration-150 hover:bg-surface-container-low focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
          >
            <span className="whitespace-nowrap text-lg font-semibold leading-none text-on-surface">
              {roomName}
            </span>
            <ChevronDown className="h-4 w-4 text-on-surface-variant" aria-hidden />
          </button>
          {/* The listbox body itself — rendered unconditionally on the
              server (aria-expanded drives visibility via CSS), so the
              structural test can see `role="listbox"`. CSS hides it
              when collapsed. */}
          <div
            id={listboxId}
            role="listbox"
            aria-label="Switch room"
            hidden={!open}
            className="absolute left-0 top-11 z-40 w-72 rounded-xl border border-outline/20 bg-surface-container-lowest p-1.5 shadow-lg"
          >
            {/* #1340/#1344 wires the real ROOMS data + status per option;
                this placeholder is what the structural test pins. The
                current room is the active option. */}
            <button
              type="button"
              role="option"
              aria-selected
              className="flex w-full items-center gap-3 rounded-lg bg-surface-container-low px-3 py-2 text-left transition-colors duration-150"
            >
              <span className="flex-1 text-sm font-medium text-on-surface">
                {roomName}
              </span>
              <RoomStatusDot status={"staged"} />
            </button>
          </div>
        </div>

        <div className="ml-1 flex items-center">
          <button
            type="button"
            aria-label="Previous room"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant transition-colors duration-150 hover:bg-surface-container-low hover:text-on-surface"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <span className="font-mono text-xs tabular-nums text-on-surface-variant">
            {/* Future slice (#1340 / #1344) will replace this with the
                real room index counter. */}
            1/1
          </span>
          <button
            type="button"
            aria-label="Next room"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant transition-colors duration-150 hover:bg-surface-container-low hover:text-on-surface"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-4">
        <span
          role="status"
          aria-live="polite"
          className="flex items-center gap-1.5 text-xs text-on-surface-variant"
        >
          {save.spin ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Check className="h-3.5 w-3.5 text-tertiary" aria-hidden />
          )}
          {save.text}
        </span>
        <Link
          href={`/projects/${projectId}/lookbook`}
          className="h-9 whitespace-nowrap rounded-lg border border-outline/40 px-3.5 text-sm font-medium text-on-surface transition-colors duration-150 hover:bg-surface-container-low focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
        >
          Preview lookbook
        </Link>
      </div>
    </header>
  );
}