import { describe, expect, it } from "vitest";

import {
  WORKBENCH_DIRECTIVE_GRID_CLASSES,
  WORKBENCH_DOCK_POSITION_CLASSES,
  WORKBENCH_DOCK_SURFACE_CLASSES,
  WORKBENCH_SIDEBAR_SURFACE_CLASSES,
  WORKBENCH_SIDEBAR_WIDTH_CLASSES,
  WORKBENCH_SIDEBAR_WIDTH_PX,
  WORKBENCH_TOPBAR_SURFACE_CLASSES,
  resolveWorkbenchRoomItemState,
  workbenchDockStatusText,
  workbenchRoomIndicator,
  workbenchRoomItemClasses,
  workbenchSessionDotClasses,
  workbenchSessionStatusLabel,
  workbenchSidebarWidthClass,
  type WorkbenchRoomItemState,
  type WorkbenchSessionStatus,
} from "@/lib/workbench-layout";

/**
 * Issue #620: Studio workbench layout grid (Room Batch Stage — Step 2).
 *
 * Pins the pure layout logic: the 256px sidebar width and its collapse
 * classes, the warm glassmorphic surface classes for sidebar / top bar /
 * dock, the sticky-within-workspace dock positioning, the directive bar's
 * responsive 4-card grid, and the sidebar room-item state machine
 * (active / pending / ready / empty).
 */

describe("Workbench sidebar width — issue #620", () => {
  it("pins the sidebar at exactly 256px", () => {
    expect(WORKBENCH_SIDEBAR_WIDTH_PX).toBe(256);
  });

  it("expanded width class is w-64 (256px)", () => {
    expect(WORKBENCH_SIDEBAR_WIDTH_CLASSES.expanded).toBe("w-64");
  });

  it("collapsed width class hides the rail entirely", () => {
    expect(WORKBENCH_SIDEBAR_WIDTH_CLASSES.collapsed).toContain("w-0");
    expect(WORKBENCH_SIDEBAR_WIDTH_CLASSES.collapsed).toContain("overflow-hidden");
  });

  it("resolves the width class from the collapsed flag", () => {
    expect(workbenchSidebarWidthClass(false)).toBe("w-64");
    expect(workbenchSidebarWidthClass(true)).toBe(WORKBENCH_SIDEBAR_WIDTH_CLASSES.collapsed);
  });

  it("sidebar surface is warm glassmorphic with a hairline right border", () => {
    expect(WORKBENCH_SIDEBAR_SURFACE_CLASSES).toContain("border-r");
    expect(WORKBENCH_SIDEBAR_SURFACE_CLASSES).toContain("border-outline-variant/30");
    expect(WORKBENCH_SIDEBAR_SURFACE_CLASSES).toContain("bg-surface-container-low/95");
    expect(WORKBENCH_SIDEBAR_SURFACE_CLASSES).toContain("backdrop-blur-md");
  });
});

describe("Workbench top bar — issue #620", () => {
  it("top bar surface sits on surface-container-lowest with a bottom hairline", () => {
    expect(WORKBENCH_TOPBAR_SURFACE_CLASSES).toContain("border-b");
    expect(WORKBENCH_TOPBAR_SURFACE_CLASSES).toContain("border-outline-variant/30");
    expect(WORKBENCH_TOPBAR_SURFACE_CLASSES).toContain("bg-surface-container-lowest");
  });

  it("directive grid is 1 column mobile, 2 tablet, 4 desktop", () => {
    expect(WORKBENCH_DIRECTIVE_GRID_CLASSES).toContain("grid");
    expect(WORKBENCH_DIRECTIVE_GRID_CLASSES).toContain("grid-cols-1");
    expect(WORKBENCH_DIRECTIVE_GRID_CLASSES).toContain("md:grid-cols-2");
    expect(WORKBENCH_DIRECTIVE_GRID_CLASSES).toContain("xl:grid-cols-4");
  });
});

describe("Workbench bottom dock — issue #620", () => {
  it("dock is sticky within the workspace, never viewport-fixed", () => {
    expect(WORKBENCH_DOCK_POSITION_CLASSES).toContain("sticky");
    expect(WORKBENCH_DOCK_POSITION_CLASSES).toContain("bottom-4");
    expect(WORKBENCH_DOCK_POSITION_CLASSES).not.toContain("fixed");
  });

  it("dock surface is rounded glassmorphic surface-container-lowest at 90%", () => {
    expect(WORKBENCH_DOCK_SURFACE_CLASSES).toContain("rounded-xl");
    expect(WORKBENCH_DOCK_SURFACE_CLASSES).toContain("bg-surface-container-lowest/90");
    expect(WORKBENCH_DOCK_SURFACE_CLASSES).toContain("backdrop-blur-md");
  });

  it("session status labels map per status", () => {
    expect(workbenchSessionStatusLabel("draft")).toBe("Draft");
    expect(workbenchSessionStatusLabel("saving")).toBe("Saving…");
    expect(workbenchSessionStatusLabel("ready")).toBe("Session Ready");
  });

  it("session dot colors map per status", () => {
    expect(workbenchSessionDotClasses("draft")).toContain("bg-muted-foreground/40");
    expect(workbenchSessionDotClasses("saving")).toContain("animate-pulse");
    expect(workbenchSessionDotClasses("ready")).toContain("bg-secondary-fixed");
  });

  it("dock status text summarizes staged rooms", () => {
    expect(workbenchDockStatusText(3, 5)).toBe("3 of 5 rooms staged");
    expect(workbenchDockStatusText(1, 1)).toBe("1 of 1 room staged");
    expect(workbenchDockStatusText(0, 0)).toBe(
      "No rooms yet — add a room scene to begin staging"
    );
  });

  it("session status type accepts exactly the three dock states", () => {
    const statuses: WorkbenchSessionStatus[] = ["draft", "saving", "ready"];
    expect(statuses).toHaveLength(3);
  });
});

describe("Workbench room item state — issue #620", () => {
  it("active wins regardless of photos or variants (Living Room row)", () => {
    expect(
      resolveWorkbenchRoomItemState({ isActive: true, hasPhotos: false, readyVariantCount: 0 })
    ).toBe("active");
  });

  it("photo-less rooms are empty (Sunroom row)", () => {
    expect(
      resolveWorkbenchRoomItemState({ isActive: false, hasPhotos: false, readyVariantCount: 0 })
    ).toBe("empty");
  });

  it("rooms with staged variants are ready (Open Dining row)", () => {
    expect(
      resolveWorkbenchRoomItemState({ isActive: false, hasPhotos: true, readyVariantCount: 2 })
    ).toBe("ready");
  });

  it("rooms with photos but no staged variants are pending (Primary Bedroom row)", () => {
    expect(
      resolveWorkbenchRoomItemState({ isActive: false, hasPhotos: true, readyVariantCount: 0 })
    ).toBe("pending");
  });

  it("empty still wins over ready when there are no photos", () => {
    expect(
      resolveWorkbenchRoomItemState({ isActive: false, hasPhotos: false, readyVariantCount: 1 })
    ).toBe("empty");
  });

  it("state type accepts exactly the four item states", () => {
    const states: WorkbenchRoomItemState[] = ["active", "pending", "ready", "empty"];
    expect(states).toHaveLength(4);
  });
});

describe("Workbench room indicator — issue #620", () => {
  it("active rooms show a dot, not a badge", () => {
    expect(workbenchRoomIndicator("active", 0)).toEqual({ kind: "dot" });
  });

  it("ready rooms badge their ready count", () => {
    expect(workbenchRoomIndicator("ready", 2)).toEqual({ kind: "badge", text: "2 Ready" });
    expect(workbenchRoomIndicator("ready", 1)).toEqual({ kind: "badge", text: "1 Ready" });
  });

  it("pending rooms badge their task label", () => {
    expect(workbenchRoomIndicator("pending", 0, "Declutter")).toEqual({
      kind: "badge",
      text: "Declutter",
    });
  });

  it("pending rooms fall back to a generic label when none is given", () => {
    expect(workbenchRoomIndicator("pending", 0)).toEqual({
      kind: "badge",
      text: "Pending",
    });
    expect(workbenchRoomIndicator("pending", 0, "   ")).toEqual({
      kind: "badge",
      text: "Pending",
    });
  });

  it("empty rooms badge as Empty", () => {
    expect(workbenchRoomIndicator("empty", 0)).toEqual({ kind: "badge", text: "Empty" });
  });
});

describe("Workbench room item classes — issue #620", () => {
  it("active row carries the terracotta border on surface-container-lowest", () => {
    const active = workbenchRoomItemClasses("active");
    expect(active.container).toContain("border-l-2");
    expect(active.container).toContain("border-secondary");
    expect(active.container).toContain("bg-surface-container-lowest");
    expect(active.container).toContain("font-medium");
    expect(active.icon).toBe("text-secondary");
  });

  it("pending and ready rows are transparent with surface-container hover", () => {
    for (const state of ["pending", "ready"] as const) {
      const classes = workbenchRoomItemClasses(state);
      expect(classes.container).toContain("border-transparent");
      expect(classes.container).toContain("hover:bg-surface-container");
      expect(classes.container).not.toContain("bg-surface-container-lowest");
      expect(classes.icon).toBe("text-outline-variant");
    }
  });

  it("empty row dims via opacity-70", () => {
    const empty = workbenchRoomItemClasses("empty");
    expect(empty.container).toContain("opacity-70");
    expect(empty.container).toContain("hover:bg-surface-container");
    expect(empty.icon).toBe("text-outline-variant");
  });
});
