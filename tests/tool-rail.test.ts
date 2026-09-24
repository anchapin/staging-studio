import { describe, expect, it } from "vitest";
import {
  BRUSH_FLYOUT_SLIDERS,
  SPACEBAR_PAINT_TOOLS,
  TOOL_RAIL_ACTIVE_CLASSES,
  TOOL_RAIL_ACTIVE_TICK_CLASSES,
  TOOL_RAIL_DIVIDER_CLASSES,
  TOOL_RAIL_SURFACE_CLASSES,
  TOOL_RAIL_TOOLS,
  ZOOM_FIT,
  ZOOM_MAX,
  ZOOM_MIN,
  clampZoom,
  formatZoomPercent,
  isTypingTarget,
  matchToolByKey,
  stepZoom,
} from "@/lib/tool-rail";

/**
 * Issue #616: Floating glassmorphic canvas tool rail
 *
 * Pins the pure logic behind the left rail: tool inventory + keyboard
 * mapping, brush-flyout slider specs, zoom HUD math, and the
 * glassmorphic styling tokens. Component rendering is verified via
 * typecheck + browser (repo pattern: no DOM test environment).
 */

describe("TOOL_RAIL_TOOLS — tool inventory (issue #616 spec)", () => {
  it("defines exactly 7 tools in spec order", () => {
    expect(TOOL_RAIL_TOOLS.map((t) => t.id)).toEqual([
      "select",
      "brush",
      "eraser",
      "smartWand",
      "lasso",
      "eyedropper",
      "pan",
    ]);
  });

  it("assigns the correct Material Symbols icon per tool", () => {
    const symbols = Object.fromEntries(
      TOOL_RAIL_TOOLS.map((t) => [t.id, t.materialSymbol])
    );
    expect(symbols).toEqual({
      select: "near_me",
      brush: "brush",
      eraser: "ink_eraser",
      smartWand: "auto_fix_high",
      lasso: "polyline",
      eyedropper: "colorize",
      pan: "pan_tool",
    });
  });

  it("assigns the correct keyboard shortcuts (V, B, E, W, L, I, H)", () => {
    const keys = Object.fromEntries(TOOL_RAIL_TOOLS.map((t) => [t.id, t.keyboard]));
    expect(keys).toEqual({
      select: "V",
      brush: "B",
      eraser: "E",
      smartWand: "W",
      lasso: "L",
      eyedropper: "I",
      pan: "H",
    });
  });

  it("only the Smart Auto-Segment Wand carries the AI badge", () => {
    expect(TOOL_RAIL_TOOLS.filter((t) => t.aiBadge).map((t) => t.id)).toEqual([
      "smartWand",
    ]);
  });

  it("splits into 6 main tools above the divider and Pan below it", () => {
    expect(
      TOOL_RAIL_TOOLS.filter((t) => t.group === "main").map((t) => t.id)
    ).toEqual(["select", "brush", "eraser", "smartWand", "lasso", "eyedropper"]);
    expect(
      TOOL_RAIL_TOOLS.filter((t) => t.group === "navigation").map((t) => t.id)
    ).toEqual(["pan"]);
  });
});

describe("matchToolByKey — keyboard mapping", () => {
  it.each([
    ["v", "select"],
    ["V", "select"],
    ["b", "brush"],
    ["B", "brush"],
    ["e", "eraser"],
    ["w", "smartWand"],
    ["l", "lasso"],
    ["i", "eyedropper"],
    ["h", "pan"],
    ["H", "pan"],
  ] as const)("key %p activates %p", (key, tool) => {
    expect(matchToolByKey(key)).toBe(tool);
  });

  it("maps Spacebar to pan for non-paint tools", () => {
    expect(matchToolByKey(" ", "select")).toBe("pan");
    expect(matchToolByKey(" ", "pan")).toBe("pan");
  });

  it("lets the mask canvas keep Spacebar while a paint tool is active", () => {
    // Space toggles painting on the mask canvas (issue #491 legend);
    // the rail must not hijack it when brush/eraser is active.
    expect(SPACEBAR_PAINT_TOOLS).toEqual(["brush", "eraser"]);
    expect(matchToolByKey(" ", "brush")).toBeNull();
    expect(matchToolByKey(" ", "eraser")).toBeNull();
  });

  it("returns null for unmapped keys", () => {
    expect(matchToolByKey("z")).toBeNull();
    expect(matchToolByKey("Escape")).toBeNull();
    expect(matchToolByKey("")).toBeNull();
  });
});

describe("isTypingTarget — shortcut guard", () => {
  it("rejects input, textarea, select, and contenteditable targets", () => {
    expect(isTypingTarget({ tagName: "input" })).toBe(true);
    expect(isTypingTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTypingTarget({ tagName: "select" })).toBe(true);
    expect(isTypingTarget({ tagName: "div", isContentEditable: true })).toBe(true);
  });

  it("accepts plain elements and non-element targets", () => {
    expect(isTypingTarget({ tagName: "button", isContentEditable: false })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(undefined)).toBe(false);
    expect(isTypingTarget({})).toBe(false);
  });
});

describe("BRUSH_FLYOUT_SLIDERS — flyout card slider specs", () => {
  it("defines the three spec sliders in order with spec ranges", () => {
    expect(BRUSH_FLYOUT_SLIDERS).toEqual([
      { key: "radius", id: "brush-radius", label: "Radius Size", min: 0, max: 100, unit: "px", defaultValue: 42 },
      { key: "edgeSoftness", id: "brush-softness", label: "Edge Softness", min: 0, max: 50, unit: "px", defaultValue: 35 },
      { key: "maskOpacity", id: "brush-opacity", label: "Mask Opacity", min: 0, max: 100, unit: "%", defaultValue: 80 },
    ]);
  });

  it("every default value is within its own range", () => {
    for (const spec of BRUSH_FLYOUT_SLIDERS) {
      expect(spec.defaultValue).toBeGreaterThanOrEqual(spec.min);
      expect(spec.defaultValue).toBeLessThanOrEqual(spec.max);
    }
  });
});

describe("zoom HUD math", () => {
  it("exposes the spec constants", () => {
    expect(ZOOM_MIN).toBe(25);
    expect(ZOOM_MAX).toBe(400);
    expect(ZOOM_FIT).toBe(100);
  });

  it("clamps to [25, 400] and rounds; non-finite falls back to 100%", () => {
    expect(clampZoom(0)).toBe(ZOOM_MIN);
    expect(clampZoom(1000)).toBe(ZOOM_MAX);
    expect(clampZoom(125.6)).toBe(126);
    expect(clampZoom(Number.NaN)).toBe(ZOOM_FIT);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(ZOOM_FIT);
  });

  it("steps by 25 in either direction", () => {
    expect(stepZoom(100, 1)).toBe(125);
    expect(stepZoom(100, -1)).toBe(75);
    expect(stepZoom(390, 1)).toBe(ZOOM_MAX);
    expect(stepZoom(30, -1)).toBe(ZOOM_MIN);
  });

  it("formats the percentage readout", () => {
    expect(formatZoomPercent(100)).toBe("100%");
    expect(formatZoomPercent(12.4)).toBe(ZOOM_MIN + "%");
    expect(formatZoomPercent(999)).toBe("400%");
  });
});

describe("glassmorphic styling tokens", () => {
  it("surface carries the frosted-glass spec classes", () => {
    expect(TOOL_RAIL_SURFACE_CLASSES).toContain("bg-surface-container-lowest/90");
    expect(TOOL_RAIL_SURFACE_CLASSES).toContain("backdrop-blur-md");
    expect(TOOL_RAIL_SURFACE_CLASSES).toContain("border-outline-variant/40");
    expect(TOOL_RAIL_SURFACE_CLASSES).toContain("rounded-lg");
    expect(TOOL_RAIL_SURFACE_CLASSES).toContain("shadow-glass");
  });

  it("active state uses the terracotta fill + 2px bottom tick", () => {
    expect(TOOL_RAIL_ACTIVE_CLASSES).toContain("bg-atelier-secondary");
    expect(TOOL_RAIL_ACTIVE_CLASSES).toContain("text-white");
    expect(TOOL_RAIL_ACTIVE_TICK_CLASSES).toBe("bg-atelier-secondary");
  });

  it("divider is the 12px hairline rgba(24,23,22,0.1)", () => {
    expect(TOOL_RAIL_DIVIDER_CLASSES).toContain("h-px");
    expect(TOOL_RAIL_DIVIDER_CLASSES).toContain("w-8");
    expect(TOOL_RAIL_DIVIDER_CLASSES).toContain("bg-atelier-primary/10");
  });
});
