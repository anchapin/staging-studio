"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";

interface EditLookbookDropdownProps {
  projectId: string;
  firstRoomId: string | null;
}

export function EditLookbookDropdown({
  projectId,
  firstRoomId,
}: EditLookbookDropdownProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const baseHref = `/projects/${projectId}/lookbook`;

  return (
    <div ref={menuRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-100"
        aria-haspopup="true"
        aria-expanded={open}
      >
        Edit Lookbook
        <ChevronDown className="h-4 w-4 text-stone-500" />
      </button>

      {open && (
        <ul
          role="menu"
          className="absolute right-0 z-50 mt-1 w-44 rounded-md border border-stone-200 bg-white py-1 shadow-lg"
        >
          <li role="menuitem">
            <Link
              href={`${baseHref}#lookbook-cover`}
              className="block px-4 py-2 text-sm text-stone-700 hover:bg-stone-100"
              onClick={() => setOpen(false)}
            >
              Edit Cover
            </Link>
          </li>
          <li role="menuitem">
            <Link
              href={`${baseHref}#lookbook-philosophy`}
              className="block px-4 py-2 text-sm text-stone-700 hover:bg-stone-100"
              onClick={() => setOpen(false)}
            >
              Edit Philosophy
            </Link>
          </li>
          <li role="menuitem">
            <Link
              href={
                firstRoomId
                  ? `${baseHref}#lookbook-room-${firstRoomId}`
                  : baseHref
              }
              className="block px-4 py-2 text-sm text-stone-700 hover:bg-stone-100"
              onClick={() => setOpen(false)}
            >
              Edit Rooms
            </Link>
          </li>
          <li role="menuitem">
            <Link
              href={`${baseHref}#lookbook-closing`}
              className="block px-4 py-2 text-sm text-stone-700 hover:bg-stone-100"
              onClick={() => setOpen(false)}
            >
              Edit Closing
            </Link>
          </li>
        </ul>
      )}
    </div>
  );
}
