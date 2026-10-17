"use client";

import { useEffect, useState } from "react";

import {
  getBrowserLocalStorage,
  readZenHintShown,
  writeZenHintShown,
} from "@/lib/zen-preference";

/**
 * Issue #1191: one-time hint on a browser's first Zen activation,
 * pointing at the floating toolbar and the Z shortcut so a first-time
 * Zen user is never lost. Auto-dismisses after 8 seconds; shown once
 * per browser. Safe to read localStorage in the initializer because
 * this component only mounts client-side (the editor subtree renders
 * only after a room is opened; editorRoomId is client state that
 * starts null).
 */
export default function ZenFirstVisitHint() {
  // The parent renders this only while zenMode is true, so mounting IS
  // a Zen activation; no visibility prop is needed (rubber-duck review,
  // PR #1239).
  const [eligible] = useState(() => !readZenHintShown(getBrowserLocalStorage()));
  const [dismissed, setDismissed] = useState(false);
  const show = eligible && !dismissed;

  useEffect(() => {
    if (!show) return;
    writeZenHintShown(getBrowserLocalStorage());
    const timer = setTimeout(() => setDismissed(true), 8000);
    return () => clearTimeout(timer);
  }, [show]);

  if (!show) return null;

  return (
    <div
      role="status"
      className="fixed left-1/2 top-20 z-50 flex max-w-[90vw] -translate-x-1/2 items-center gap-2 rounded-full border border-stone-200 bg-white/95 py-2 pl-4 pr-2 text-xs text-stone-600 shadow-lg backdrop-blur-sm"
    >
      <span>
        Zen Mode keeps the photo front and center. Press Z or use the toolbar
        to switch back.
      </span>
      <button
        type="button"
        aria-label="Dismiss hint"
        onClick={() => setDismissed(true)}
        className="rounded-full px-2 py-0.5 text-sm leading-none text-stone-400 hover:text-stone-600"
      >
        ×
      </button>
    </div>
  );
}
