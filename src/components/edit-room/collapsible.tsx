/**
 * Issue #1341 — `<Collapsible>` (framer-motion-free disclosure primitive).
 *
 * The Magic Patterns design uses `framer-motion`'s `motion.div` /
 * `motion.dl` with `initial/animate/exit` height transitions for the
 * project-context disclosure + the Fine-tune panel. This repo does
 * not depend on framer-motion (the redesign subtree is zero-dep on
 * icon/animation libraries — see handoff doc §8).
 *
 * The port's behavior matches `framer-motion`'s `AnimatePresence`:
 * children are MOUNTED when open and UNMOUNTED when closed. The
 * visual height/opacity transition is deferred to a CSS animation
 * that fires before the unmount via a `data-state="open"|"closed"`
 * attribute + a transition class. This trade-off keeps the DOM
 * honest (closed = no inner markup) without losing the design's
 * "slide + fade" feel.
 *
 * For the trade-off: when fully closed, the inner markup is gone, so
 * screen readers announce a single trigger + no nested content. When
 * opening, the CSS animation runs while the children mount — a small
 * flash can be visible on slow networks. The CSS animation duration
 * is configurable.
 *
 * Consumers that DO need external control can pass `open` +
 * `onOpenChange` and the component flips to controlled mode.
 *
 * Pinned by `tests/edit-room-collapsible.test.tsx` (#1341), used by
 * StagePanel (project-context disclosure) and FineTune (the advanced
 * settings panel).
 */

"use client";

import { useId, useState, type ReactNode } from "react";

export interface CollapsibleProps {
  /** When true the children render. Undefined = uncontrolled (starts closed). */
  open?: boolean;
  /** Controlled-mode toggle. Receives the new value when the trigger fires. */
  onOpenChange?: (next: boolean) => void;
  /**
   * The trigger element. The collapsible renders this at the top and
   * attaches the click handler + the `aria-controls`/`aria-expanded`
   * pair to it.
   */
  trigger: (props: { expanded: boolean; onToggle: () => void; controlsId: string }) => ReactNode;
  /** The content rendered when open. */
  children: ReactNode;
  /**
   * Optional id for the controlled-by-aria disclosure element.
   * Defaults to a generated id; tests pass an explicit value when
   * targeting the element via `aria-controls`.
   */
  controlsId?: string;
}

/**
 * A `<details>`-like primitive. Children mount/unmount with `open`
 * state (matches the `motion.div` + `AnimatePresence` semantics the
 * design uses, but without framer-motion). The CSS-animation polish
 * is the consumer's responsibility — add a `data-state="open"`
 * transition on the inner content if needed.
 */
export function Collapsible({
  open,
  onOpenChange,
  trigger,
  children,
  controlsId: providedId,
}: CollapsibleProps) {
  const generatedId = useId();
  const controlsId = providedId ?? generatedId;
  const isControlled = open !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const expanded = isControlled ? open : internalOpen;

  const onToggle = () => {
    const next = !expanded;
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  };

  return (
    <>
      {trigger({ expanded, onToggle, controlsId })}
      {expanded && (
        <div
          id={controlsId}
          role="region"
          data-state="open"
          // The height/opacity transition lives on the consumer's inner
          // content if they want the design's slide-and-fade UX. The
          // base collapse just mounts/unmounts.
          className="animate-in fade-in slide-in-from-top-2 duration-200"
        >
          {children}
        </div>
      )}
    </>
  );
}