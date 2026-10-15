/**
 * Issue #1342 — `<CopyPanel>` stub.
 *
 * Placeholder rendered by the Inspector when the Listing copy tab is
 * active. Slice #1343 ("[mp-redesign] CopyPanel (Listing copy tab)")
 * replaces this stub with the full Headline + Description inputs,
 * the 600-char counter, and the "Rewrite from directions" CTA wired
 * to `/api/generate-copy`.
 *
 * For now, the panel renders a single explanatory paragraph so the
 * user understands why the tab looks empty. The `directions` prop is
 * threaded through (the Inspector passes it from the Staging tab's
 * textarea) so the #1343 implementation can read the same value
 * without an Inspector prop-shape change.
 */

import type { ReactNode } from "react";

export interface CopyPanelProps {
  /** Threaded from the Staging tab's Directions textarea. */
  directions: string;
}

export function CopyPanel(_props: CopyPanelProps): ReactNode {
  return (
    <div
      data-testid="copy-panel-stub"
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-6"
    >
      <p className="text-[13px] leading-relaxed text-ink-muted">
        Shown beside this room in the lookbook. Written from your staging
        directions and the selected version.
      </p>
      <p className="text-sm text-ink-subtle">
        The Listing copy editor is coming soon in <span className="font-mono">#1343</span>.
        For now, the staging controls in the Staging tab and the Run button
        below are the only thing wired up.
      </p>
    </div>
  );
}