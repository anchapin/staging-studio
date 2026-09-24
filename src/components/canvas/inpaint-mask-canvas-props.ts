import type { CanvasPoint } from "@/lib/canvas-coords";
import type { InstanceOverlay, SelectionMarker } from "@/lib/instance-overlays";
import type { MaskTool, SelectionReset } from "./inpaint-mask-canvas";

export interface InpaintMaskCanvasProps {
  width?: number;
  height?: number;
  brushSize?: number;
  /** Issue #560: callback to notify parent of brush size changes (Zen Mode). */
  onBrushSizeChange?: (size: number) => void;
  initialMaskDataUrl?: string | null;
  onMaskChange?: (maskDataUrl: string | null) => void;
  /** Issue #560: external active tool state (Zen Mode). */
  activeTool?: MaskTool;
  /** Issue #560: callback when active tool changes (Zen Mode). */
  onActiveToolChange?: (tool: MaskTool) => void;
  /**
   * Issue #748: fired when the user activates the Select Regions tool.
   * Refresh detection is lazy after a completion rebase — the parent
   * arms (and bills) the SAM call for the current base on this signal.
   */
  onSelectRegionsActivate?: () => void;
  /** Issue #560: when true, hides the toolbar and non-essential chrome. */
  zenMode?: boolean;
  /** Natural aspect ratio (width / height) of the source photo; sizes the mask canvas to match it. */
  aspectRatio?: number | null;
  /** Natural pixel width of the uploaded photo; exported masks are scaled to match. */
  naturalWidth?: number | null;
  /** Natural pixel height of the uploaded photo. */
  naturalHeight?: number | null;
  /** Photo rendered underneath the mask so the canvas overlays it exactly. */
  overlayImageSrc?: string | null;
  /**
   * Full-width focused layout (issue #169): the photo + mask span the
   * available content width instead of the compact card cap (`max-w-md`).
   */
  fullWidth?: boolean;
  /**
   * Select Objects tool (issue #228): called on click with the point in
   * LOGICAL canvas pixel space (dims — the same space the parent decodes
   * instance grids at). The parent hit-tests client-side; no provider
   * call happens on click. Repeated clicks are MEANINGFUL (toggle), so
   * unlike the old point-SAM flow there is no same-point dedupe.
   */
  onInstanceToggle?: (point: CanvasPoint) => void;
  /** True while segmenting (or inpainting) runs; select clicks are ignored. */
  segmentDisabled?: boolean;
  /** Issue #641: true while an inpaint request is in flight — shows a pulsing ring around the canvas. */
  processing?: boolean;
  /**
   * True while a concept detection is in flight (issue #228, formerly the
   * per-click SAM request): shows a spinner + "Selecting..." on the
   * Select Objects tool itself and a wait cursor on the canvas.
   */
  segmenting?: boolean;
  /**
   * Issue #228: score-ranked detected instances to tint beneath the mask
   * canvas. Pure DOM/canvas overlay — never touches the exported mask.
   */
  instanceOverlays?: InstanceOverlay[];
  /**
   * Outward mask growth in mask-canvas pixels applied at export time
   * (issue #180): makes FLUX.1 Fill regenerate bezels/frames at the painted
   * boundary instead of preserving them. 0 restores the un-dilated mask.
   */
  expansionRadius?: number;
  /**
   * Issue #234: when true, dilate further downward than upward so cast floor
   * shadows are included in the regenerated region. Has no effect when
   * `expansionRadius` is 0.
   */
  includeFloorShadow?: boolean;
  /**
   * Issue #203: numbered badges (1-based) for each pending batch selection,
   * positioned by natural-pixel click point. Pure DOM overlay — like the
   * brush cursor, they never touch canvas pixels, so the exported mask
   * stays clean.
   */
  selectionMarkers?: SelectionMarker[];
  /**
   * Issue #203: replace the mask grid with this union mask whenever `id`
   * changes (a selection was added, removed, or cleared). `maskDataUrl`
   * null clears the grid. Single-select (issue #183) flows through the
   * same path: one selection's union is its own mask.
   */
  selectionReset?: SelectionReset | null;
  /** Issue #203: the user pressed Clear Mask; lets the parent drop the
   * batch selection set so it cannot disagree with the now-empty grid. */
  onMaskCleared?: () => void;
  /** Issue #448: click a numbered badge to deselect that region. */
  onSelectionDeselect?: (id: string) => void;
  /**
   * Issue #454: the concept name being detected — shown in the empty-state
   * badge while `segmenting` is true so users know detection is running.
   */
  detectingConcept?: string;
}

