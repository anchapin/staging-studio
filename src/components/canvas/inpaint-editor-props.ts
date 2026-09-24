import type { ReactNode } from "react";
import type { InpaintSource } from "@/lib/inpaint-source";

export interface InpaintEditorProps {
  roomId: string;
  /** The resolved source image the mask applies to (before photo or staged variant). */
  imageUrl: string;
  aesthetic: string;
  /** Room-specific staging directives (displayed in textarea, merged with global for AI). */
  promptDirectives: string;
  /** Issue #562: Global project-level directives merged with room directives for AI. */
  globalDirectives?: string;
  /** The "after" slot this run's result will land in (resolved by the parent). */
  variantSlot: 0 | 1;
  /** Currently selected source; the parent owns this state (issue #170). */
  source: InpaintSource;
  /** Available source options (original photo + staged variants). */
  sourceOptions: InpaintSource[];
  onSourceChange?: (source: InpaintSource) => void;
  pendingRequestId?: string | null;
  /** Source of the pending run, reconstructed from its persisted row. */
  pendingSource?: InpaintSource | null;
  onInpaintComplete?: (resultImageUrl: string, source: InpaintSource) => void;
  /**
   * Issue #561: the current "after" result URL for the variant slot being edited.
   * Used to highlight the active version in the VersionHistoryPanel.
   */
  currentResultUrl?: string | null;
  /**
   * Issue #230: reports the active labeled concept selection — the label
   * when exactly one labeled selection is active, null otherwise. The
   * parent uses it to pre-fill the single-object staging directives
   * ("Replace the {concept} with ") without ever clobbering typed text.
   */
  onActiveConceptLabelChange?: (label: string | null) => void;
  /**
   * Full-width focused layout (issue #169): the mask canvas spans the
   * available content width instead of the compact card cap.
   */
  fullWidth?: boolean;
  /**
   * Issue #252 D5: content rendered above the mask canvas in the left
   * pane (the focused page's room imagery, variant strip, and directives
   * sections). At lg+ this area is height-capped and scrolls internally
   * so the canvas and the control panel stay in view without page-level
   * scrolling.
   */
  secondaryPane?: ReactNode;
  /**
   * Issue #507: callback to update staging directives from within the
   * editor's inline textarea (kept in sync with the parent's copy).
   */
  onDirectivesChange?: (value: string) => void;
  /** Current directives value for the inline textarea. */
  directivesValue?: string;
  /** Issue #638: Project name for Focus Canvas Mode breadcrumb. */
  projectName?: string;
  /** Issue #638: Room name for Focus Canvas Mode breadcrumb. */
  roomName?: string;
}

