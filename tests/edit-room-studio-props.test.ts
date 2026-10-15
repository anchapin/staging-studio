/**
 * Issue #1344 — Resolver that builds the `<EditRoomStudio>` prop bag
 * from the project detail view's focused-room inputs.
 *
 * The route mount passes the studio its full data shape (project
 * address, room id + name, image URL, lookbook-variant URLs, aesthetic,
 * global directives, controlled run state, exit callback, etc.). All
 * of these are derivable from the existing `project` + `focusedRoom` +
 * `focusedInputs` + `directiveStatuses` state; the resolver is the
 * pure seam between "the page knows these things" and "the studio
 * takes these as props", so the data shape is pinned 1:1 and the
 * route file stays thin (just spreads the resolver's return).
 *
 * Pinned cases:
 *  - `address` comes from `project.propertyAddress`.
 *  - `roomId` / `roomName` come from `focusedRoom`.
 *  - `imageUrl` comes from `focusedInputs.inpaintImageUrl` (the
 *    resolved inpaint source URL — never the empty `beforeImageUrl`
 *    that would 404 the canvas image).
 *  - `lookbookVariantUrls` mirrors `Room.afterImageUrl` → slot A and
 *    `Room.afterImageUrl2` → slot B; `null` on each side when the
 *    room has no completed variant yet.
 *  - `aesthetic` + `globalDirectives` come from `project`.
 *  - `initialLookbookSlot` maps `Room.selectedVariantIndex` to
 *    `"A"` / `"B"` / `"original"` (the studio's `SlotId`); null →
 *    `"original"` (the studio's `initialEditRoomState.lookbookSlot`
 *    default).
 *  - `running` + `onRun` are passed through verbatim from the route's
 *    in-flight run controller — not derived here.
 *  - `saveStatus` mirrors `directiveStatuses[roomId]` with a `"idle"`
 *    default for rooms the user hasn't typed in yet.
 *  - `initialCopyHeadline` / `initialCopyBody` come from the Room's
 *    listing-copy columns (`lookbookHeadline` / `lookbookBody`),
 *    coerced to empty string when null (the CopyPanel uses controlled
 *    `<input>` / `<textarea>` values).
 */

import { describe, expect, it } from "vitest";

import { buildEditRoomStudioProps, type FocusedRoomInputs, type ProjectLike } from "@/lib/edit-room-studio-props";

const baseProject: ProjectLike = {
  id: "project-1",
  propertyAddress: "500 Maple Street",
  stagingAesthetic: "Warm Transitional",
  stagingDirectives: "Preserve the original brick fireplace.",
};

const baseFocusedRoom = {
  id: "room-1",
  name: "Living Room",
  beforeImageUrl: "https://example.test/before.jpg",
  beforeImageUrl2: null,
  afterImageUrl: "https://example.test/variant-a.jpg",
  afterImageUrl2: null,
  selectedVariantIndex: 0 as number | null,
  lookbookHeadline: "A bright, airy retreat",
  lookbookBody: "Refreshed textiles lift the space.",
  rawDirectives: "Modern coastal palette.",
};

const baseFocusedInputs: FocusedRoomInputs = {
  inpaintImageUrl: "https://example.test/source.jpg",
};

describe("buildEditRoomStudioProps (issue #1344)", () => {
  it("forwards the property address to the studio", () => {
    const props = buildEditRoomStudioProps({
      project: baseProject,
      focusedRoom: baseFocusedRoom,
      focusedInputs: baseFocusedInputs,
      directiveStatuses: {},
      touchUps: { original: 0, A: 0, B: 0 },
      running: null,
      onRun: () => {},
      onExitToProject: () => {},
    });
    expect(props.address).toBe("500 Maple Street");
  });

  it("forwards the room id + name", () => {
    const props = buildEditRoomStudioProps({
      project: baseProject,
      focusedRoom: baseFocusedRoom,
      focusedInputs: baseFocusedInputs,
      directiveStatuses: {},
      touchUps: { original: 0, A: 0, B: 0 },
      running: null,
      onRun: () => {},
      onExitToProject: () => {},
    });
    expect(props.roomId).toBe("room-1");
    expect(props.roomName).toBe("Living Room");
  });

  it("forwards the resolved inpaint source URL (not the before photo)", () => {
    // focusedInputs.inpaintImageUrl is the resolved inpaint source —
    // the parent route's healInpaintSource + listInpaintSources machinery
    // already chose this URL, so the studio gets the user's actual
    // selected source, never a 404 against `beforeImageUrl`.
    const props = buildEditRoomStudioProps({
      project: baseProject,
      focusedRoom: baseFocusedRoom,
      focusedInputs: {
        inpaintImageUrl: "https://example.test/variant-a-as-source.jpg",
      },
      directiveStatuses: {},
      touchUps: { original: 0, A: 0, B: 0 },
      running: null,
      onRun: () => {},
      onExitToProject: () => {},
    });
    expect(props.imageUrl).toBe("https://example.test/variant-a-as-source.jpg");
  });

  it("maps Room.afterImageUrl → lookbookVariantUrls.A", () => {
    const props = buildEditRoomStudioProps({
      project: baseProject,
      focusedRoom: baseFocusedRoom,
      focusedInputs: baseFocusedInputs,
      directiveStatuses: {},
      touchUps: { original: 0, A: 0, B: 0 },
      running: null,
      onRun: () => {},
      onExitToProject: () => {},
    });
    expect(props.lookbookVariantUrls.A).toBe("https://example.test/variant-a.jpg");
  });

  it("maps Room.afterImageUrl2 → lookbookVariantUrls.B", () => {
    const props = buildEditRoomStudioProps({
      project: baseProject,
      focusedRoom: {
        ...baseFocusedRoom,
        afterImageUrl2: "https://example.test/variant-b.jpg",
      },
      focusedInputs: baseFocusedInputs,
      directiveStatuses: {},
      touchUps: { original: 0, A: 0, B: 0 },
      running: null,
      onRun: () => {},
      onExitToProject: () => {},
    });
    expect(props.lookbookVariantUrls.B).toBe("https://example.test/variant-b.jpg");
  });

  it("defaults lookbookVariantUrls to null when the room has no completed variant", () => {
    const props = buildEditRoomStudioProps({
      project: baseProject,
      focusedRoom: { ...baseFocusedRoom, afterImageUrl: null, afterImageUrl2: null },
      focusedInputs: baseFocusedInputs,
      directiveStatuses: {},
      touchUps: { original: 0, A: 0, B: 0 },
      running: null,
      onRun: () => {},
      onExitToProject: () => {},
    });
    expect(props.lookbookVariantUrls).toEqual({ A: null, B: null });
  });

  it("maps selectedVariantIndex=0 → initialLookbookSlot='A'", () => {
    const props = buildEditRoomStudioProps({
      project: baseProject,
      focusedRoom: baseFocusedRoom,
      focusedInputs: baseFocusedInputs,
      directiveStatuses: {},
      touchUps: { original: 0, A: 0, B: 0 },
      running: null,
      onRun: () => {},
      onExitToProject: () => {},
    });
    expect(props.initialLookbookSlot).toBe("A");
  });

  it("maps selectedVariantIndex=1 → initialLookbookSlot='B'", () => {
    const props = buildEditRoomStudioProps({
      project: baseProject,
      focusedRoom: { ...baseFocusedRoom, selectedVariantIndex: 1 },
      focusedInputs: baseFocusedInputs,
      directiveStatuses: {},
      touchUps: { original: 0, A: 0, B: 0 },
      running: null,
      onRun: () => {},
      onExitToProject: () => {},
    });
    expect(props.initialLookbookSlot).toBe("B");
  });

  it("maps selectedVariantIndex=null → initialLookbookSlot='A' (studio default; legacy convention)", () => {
    // A room without an explicit selection falls back to A because the
    // staging editor's lookbook-badge positions are based on the
    // studio's initial state (the badge lands on A unless the user
    // actively picks B). Mirrors the legacy `resolveStripSelection`
    // fallback (issue #169).
    const props = buildEditRoomStudioProps({
      project: baseProject,
      focusedRoom: { ...baseFocusedRoom, selectedVariantIndex: null },
      focusedInputs: baseFocusedInputs,
      directiveStatuses: {},
      touchUps: { original: 0, A: 0, B: 0 },
      running: null,
      onRun: () => {},
      onExitToProject: () => {},
    });
    expect(props.initialLookbookSlot).toBe("A");
  });

  it("forwards the project aesthetic + global directives", () => {
    const props = buildEditRoomStudioProps({
      project: baseProject,
      focusedRoom: baseFocusedRoom,
      focusedInputs: baseFocusedInputs,
      directiveStatuses: {},
      touchUps: { original: 0, A: 0, B: 0 },
      running: null,
      onRun: () => {},
      onExitToProject: () => {},
    });
    expect(props.aesthetic).toBe("Warm Transitional");
    expect(props.globalDirectives).toBe("Preserve the original brick fireplace.");
  });

  it("defaults saveStatus to 'idle' when the room hasn't typed yet", () => {
    const props = buildEditRoomStudioProps({
      project: baseProject,
      focusedRoom: baseFocusedRoom,
      focusedInputs: baseFocusedInputs,
      directiveStatuses: {},
      touchUps: { original: 0, A: 0, B: 0 },
      running: null,
      onRun: () => {},
      onExitToProject: () => {},
    });
    expect(props.saveStatus).toBe("idle");
  });

  it("mirrors the room's directive save status", () => {
    const props = buildEditRoomStudioProps({
      project: baseProject,
      focusedRoom: baseFocusedRoom,
      focusedInputs: baseFocusedInputs,
      directiveStatuses: { "room-1": "saving" },
      touchUps: { original: 0, A: 0, B: 0 },
      running: null,
      onRun: () => {},
      onExitToProject: () => {},
    });
    expect(props.saveStatus).toBe("saving");
  });

  it("forwards the listing-copy headline + body, coercing null → empty string", () => {
    const props = buildEditRoomStudioProps({
      project: baseProject,
      focusedRoom: { ...baseFocusedRoom, lookbookHeadline: null, lookbookBody: null },
      focusedInputs: baseFocusedInputs,
      directiveStatuses: {},
      touchUps: { original: 0, A: 0, B: 0 },
      running: null,
      onRun: () => {},
      onExitToProject: () => {},
    });
    expect(props.initialCopyHeadline).toBe("");
    expect(props.initialCopyBody).toBe("");
  });

  it("forwards non-null listing-copy verbatim", () => {
    const props = buildEditRoomStudioProps({
      project: baseProject,
      focusedRoom: baseFocusedRoom,
      focusedInputs: baseFocusedInputs,
      directiveStatuses: {},
      touchUps: { original: 0, A: 0, B: 0 },
      running: null,
      onRun: () => {},
      onExitToProject: () => {},
    });
    expect(props.initialCopyHeadline).toBe("A bright, airy retreat");
    expect(props.initialCopyBody).toBe("Refreshed textiles lift the space.");
  });

  it("forwards touch-ups count + running + onRun + onExitToProject verbatim", () => {
    const onRun = () => {};
    const onExitToProject = () => {};
    const props = buildEditRoomStudioProps({
      project: baseProject,
      focusedRoom: baseFocusedRoom,
      focusedInputs: baseFocusedInputs,
      directiveStatuses: {},
      touchUps: { original: 0, A: 3, B: 1 },
      running: 42,
      onRun,
      onExitToProject,
    });
    expect(props.touchUps).toEqual({ original: 0, A: 3, B: 1 });
    expect(props.running).toBe(42);
    expect(props.onRun).toBe(onRun);
    expect(props.onExitToProject).toBe(onExitToProject);
  });
});