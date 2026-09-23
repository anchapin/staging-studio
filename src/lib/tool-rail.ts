/**
 * Pure logic for the floating glassmorphic canvas tool rail (issue #616).
 *
 * The Brush Refinement Studio left rail — tool inventory, keyboard
 * mapping, brush-flyout slider specs, and Zoom HUD math — lives here as
 * pure data/functions so it can be pinned by `tests/tool-rail.test.ts`
 * (the repo pattern: extract logic into `src/lib/<name>.ts`, never test
 * components directly).
 *
 * Icon names are the Material Symbols names from the Stitch design
 * (`near_me`, `brush`, `ink_eraser`, `auto_fix_high`, `polyline`,
 * `colorize`, `pan_tool`); the rendered rail uses the repo's lucide
 * equivalents (no Material Symbols webfont is loaded).
 */

export type StudioTool =
  | "select"
  | "brush"
  | "eraser"
  | "smartWand"
  | "lasso"
  | "eyedropper"
  | "pan";

export interface ToolRailTool {
  id: StudioTool;
  label: string;
  /** Material Symbols icon name from the Stitch design (Screen 3). */
  materialSymbol: string;
  /** Primary keyboard shortcut (single uppercase letter). */
  keyboard: string;
  /** Alternate shortcut keys that also activate the tool. */
  alternateKeys?: string[];
  /** Renders the small terracotta "AI" badge (Smart Auto-Segment Wand). */
  aiBadge?: boolean;
  /** `main` tools sit above the hairline divider; `navigation` below it. */
  group: "main" | "navigation";
}

/** Tool buttons top-to-bottom per the issue spec (7 tools + divider). */
export const TOOL_RAIL_TOOLS: readonly ToolRailTool[] = [
  { id: "select", label: "Select / Pointer", materialSymbol: "near_me", keyboard: "V", group: "main" },
  { id: "brush", label: "Brush Mask", materialSymbol: "brush", keyboard: "B", group: "main" },
  { id: "eraser", label: "Eraser", materialSymbol: "ink_eraser", keyboard: "E", group: "main" },
  {
    id: "smartWand",
    label: "Smart Auto-Segment",
    materialSymbol: "auto_fix_high",
    keyboard: "W",
    group: "main",
    aiBadge: true,
  },
  { id: "lasso", label: "Lasso / Polygonal Selection", materialSymbol: "polyline", keyboard: "L", group: "main" },
  { id: "eyedropper", label: "Eyedropper / Color Sampler", materialSymbol: "colorize", keyboard: "I", group: "main" },
  {
    id: "pan",
    label: "Pan",
    materialSymbol: "pan_tool",
    keyboard: "H",
    alternateKeys: [" "],
    group: "navigation",
  },
];

/**
 * Tools for which the Spacebar is reserved by the mask canvas: Space
 * toggles painting there (issue #491 shortcut legend), so the rail must
 * not claim it while one of them is active.
 */
export const SPACEBAR_PAINT_TOOLS: readonly StudioTool[] = ["brush", "eraser"];

/**
 * True when a keydown target looks like an editable field the rail must
 * ignore. Structural (tagName/isContentEditable) rather than
 * `instanceof HTMLElement` so it stays pure and testable in the repo's
 * node-environment vitest suite.
 */
export function isTypingTarget(target: unknown): boolean {
  if (target === null || typeof target !== "object") return false;
  const { tagName, isContentEditable } = target as {
    tagName?: unknown;
    isContentEditable?: unknown;
  };
  if (typeof tagName !== "string") return false;
  const tag = tagName.toUpperCase();
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    isContentEditable === true
  );
}

/**
 * Map a `KeyboardEvent.key` to the tool it activates, or null.
 *
 * Spacebar (" ") activates Pan — except while a paint tool (brush/eraser)
 * is active, where the mask canvas already owns Space for paint toggle.
 */
export function matchToolByKey(key: string, activeTool?: StudioTool): StudioTool | null {
  if (key === " ") {
    if (activeTool && SPACEBAR_PAINT_TOOLS.includes(activeTool)) return null;
    return "pan";
  }
  const normalized = key.length === 1 ? key.toUpperCase() : key;
  const tool = TOOL_RAIL_TOOLS.find(
    (t) => t.keyboard === normalized || t.alternateKeys?.includes(normalized)
  );
  return tool?.id ?? null;
}

/* ------------------------------------------------------------------ */
/* Brush parameter flyout card (below the tool strip)                  */
/* ------------------------------------------------------------------ */

export type BrushSliderKey = "radius" | "edgeSoftness" | "maskOpacity";

export interface BrushSliderSpec {
  key: BrushSliderKey;
  /** Stable id for the `<input type="range">`. */
  id: string;
  /** Plus Jakarta Sans 11px label. */
  label: string;
  min: number;
  max: number;
  unit: string;
  defaultValue: number;
}

/** Slider ranges from the issue spec: radius 0-100px, softness 0-50px, opacity 0-100%. */
export const BRUSH_FLYOUT_SLIDERS: readonly BrushSliderSpec[] = [
  { key: "radius", id: "brush-radius", label: "Radius Size", min: 0, max: 100, unit: "px", defaultValue: 42 },
  { key: "edgeSoftness", id: "brush-softness", label: "Edge Softness", min: 0, max: 50, unit: "px", defaultValue: 35 },
  { key: "maskOpacity", id: "brush-opacity", label: "Mask Opacity", min: 0, max: 100, unit: "%", defaultValue: 80 },
];

/* ------------------------------------------------------------------ */
/* Zoom HUD (below the flyout card)                                    */
/* ------------------------------------------------------------------ */

export const ZOOM_MIN = 25;
export const ZOOM_MAX = 400;
export const ZOOM_STEP = 25;
/** "Fit screen" resets the canvas zoom to 100%. */
export const ZOOM_FIT = 100;

/** Clamp a zoom percentage to [ZOOM_MIN, ZOOM_MAX]; non-finite → 100%. */
export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return ZOOM_FIT;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value)));
}

/** Step the zoom by ±ZOOM_STEP, clamped. */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  return clampZoom(zoom + direction * ZOOM_STEP);
}

/** JetBrains-Mono readout for the HUD, e.g. `formatZoomPercent(125) === "125%"`. */
export function formatZoomPercent(zoom: number): string {
  return `${clampZoom(zoom)}%`;
}

/* ------------------------------------------------------------------ */
/* Styling tokens (glassmorphic spec)                                  */
/* ------------------------------------------------------------------ */

/**
 * Frosted glassmorphic surface shared by the rail, flyout card, and zoom
 * HUD: `surface-container-lowest` at 90% + `backdrop-blur-md`, hairline
 * `outline-variant` border at 40% opacity, `rounded-lg`, warm-tinted
 * floating shadow.
 */
export const TOOL_RAIL_SURFACE_CLASSES =
  "rounded-lg border border-outline-variant/40 bg-surface-container-lowest/90 backdrop-blur-md shadow-glass";

/** Active tool fill: terracotta (`bg-secondary`) + light text. */
export const TOOL_RAIL_ACTIVE_CLASSES = "bg-atelier-secondary text-white shadow-sm";

/** 2px terracotta bottom tick rendered on the active tool button. */
export const TOOL_RAIL_ACTIVE_TICK_CLASSES = "bg-atelier-secondary";

/**
 * 12px hairline divider between the main tool group and Pan —
 * rgba(24,23,22,0.1) (= `atelier-primary` at 10% opacity).
 */
export const TOOL_RAIL_DIVIDER_CLASSES = "h-px w-8 bg-atelier-primary/10";
