/**
 * Shared `EditRoomStudio` mount props for the shell's test files.
 *
 * Issue #1344 — The shell's prop contract grew (route-mount slice).
 * Issue #1344 (real `useInpaintRuns` wire) — added `maskDataUrl` +
 * `onMaskChange` for the painted-area submit path. Three test files
 * (uses-stage-panel, uses-inspector, uses-version-strip) each render
 * the shell a half-dozen times to pin mount-shape contracts. Keeping
 * every call site in sync is a maintenance trap; this fixture keeps a
 * single source of truth for "the minimum prop bag the shell needs to
 * render" so a future contract addition only needs a fixture edit, not
 * an N-site search-and-replace.
 *
 * Issue #1362a — FineTune persistence: four new required props
 * (`initialFineTune` + three on-change callbacks). The defaults mirror
 * a legacy row that has never had any FineTune column written
 * (all-null), so the shell's `useState(initialFineTune?.strength ?? 50)`
 * shape lands at the UI's natural defaults.
 */

import type { EditRoomStudioProps } from "@/components/edit-room/types";

/**
 * Returns the minimum prop bag the shell needs to render successfully.
 * Tests should spread `...baseProps()` and then override individual
 * fields (the test's actual subject is the override, not the boilerplate).
 *
 * Two nested objects (`touchUps`, `lookbookVariantUrls`) are deep-merged
 * with `overrides` so a test that only wants to bump `touchUps.A` does
 * not have to re-state `lookbookVariantUrls`. A shallow spread would
 * leave the test page unable to render.
 */
export function baseProps(
  overrides: Partial<EditRoomStudioProps> = {}
): EditRoomStudioProps {
  // Pull nested object overrides up so the spread at the end does not
  // wipe them out, then deep-merge them into the defaults.
  const { touchUps: touchUpOverrides, lookbookVariantUrls: urlOverrides, ...rest } =
    overrides;
  return {
    saveStatus: "saved",
    onDirectionsCommit: () => {},
    projectId: "project-1",
    roomId: "room-1",
    roomName: "Living Room",
    initialLookbookSlot: "A",
    touchUps: {
      original: 0,
      A: 0,
      B: 0,
      ...touchUpOverrides,
    },
    initialCopyHeadline: "",
    initialCopyBody: "",
    address: "418 Linden Ave",
    imageUrl: "/room-photos/before.jpg",
    lookbookVariantUrls: {
      A: null,
      B: null,
      ...urlOverrides,
    },
    aesthetic: "Warm Craftsman Modern",
    globalDirectives: "Keep original molding, hardwood floors and brick visible.",
    running: null,
    onRun: () => {},
    onExitToProject: () => {},
    maskDataUrl: null,
    onMaskChange: () => {},
    // Issue #1362a — FineTune persistence. Default bag mirrors a
    // legacy row (all-null); the shell's per-field `useState(... ?? default)`
    // shape picks UI defaults (strength=50 → 0.5 at the wire, expand=12,
    // seed=""). Tests that exercise persisted-FineTune rehydrate
    // override `initialFineTune` and the matching on-change callback.
    initialFineTune: {
      strength: null,
      expand: null,
      seed: null,
    },
    onFineTuneStrengthChange: () => {},
    onFineTuneExpandChange: () => {},
    onFineTuneSeedChange: () => {},
    ...rest,
  };
}