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
  // #1365 — live route-mapped value the studio's textarea
  // renders. Tests that don't care about the live mapping leave
  // it empty; tests pinning the redirect supply an explicit
  // string.
  roomDirectives: "",
};

/**
 * Issue #1344 slice 2 — three new args landed in the resolver
 * (`onDirectionsCommit`, `maskDataUrl`, `onMaskChange`). Every test
 * supplies them via `withRunArgs(...)` so we can also pin what the
 * resolver does with them (slice 2 additions). The return type is
 * `Partial<BuildEditRoomStudioPropsArgs>` so a per-test spread that
 * omits the slice-1 required fields (e.g. `onRun`, `onExitToProject`)
 * still satisfies the resolver's signature when the test only cares
 * about the slice-2 wiring.
 *
 * Issue #1362a — three more args (`onFineTuneStrengthChange`,
 * `onFineTuneExpandChange`, `onFineTuneSeedChange`) for the FineTune
 * persistence path. Same `Partial<>` shape as the slice-2 additions —
 * `withRunArgs` supplies no-op defaults so existing fixtures don't
 * have to thread them.
 */
function withRunArgs(
  args: Partial<Parameters<typeof buildEditRoomStudioProps>[0]>
): Parameters<typeof buildEditRoomStudioProps>[0] {
  return {
    onDirectivesChange: () => {},
    maskDataUrl: null,
    onMaskChange: () => {},
    onFineTuneStrengthChange: () => {},
    onFineTuneExpandChange: () => {},
    onFineTuneSeedChange: () => {},
    ...args,
  } as Parameters<typeof buildEditRoomStudioProps>[0];
}

describe("buildEditRoomStudioProps (issue #1344)", () => {
  it("forwards the property address to the studio", () => {
    const props = buildEditRoomStudioProps(withRunArgs({
      project: baseProject,
      focusedRoom: baseFocusedRoom,
      focusedInputs: baseFocusedInputs,
      directiveStatuses: {},
      touchUps: { original: 0, A: 0, B: 0 },
      running: null,
      onRun: () => {},
      onExitToProject: () => {},
    }));
    expect(props.address).toBe("500 Maple Street");
  });

  it("forwards the room id + name", () => {
    const props = buildEditRoomStudioProps(withRunArgs({
      project: baseProject,
      focusedRoom: baseFocusedRoom,
      focusedInputs: baseFocusedInputs,
      directiveStatuses: {},
      touchUps: { original: 0, A: 0, B: 0 },
      running: null,
      onRun: () => {},
      onExitToProject: () => {},
    }));
    expect(props.roomId).toBe("room-1");
    expect(props.roomName).toBe("Living Room");
  });

  it("forwards the resolved inpaint source URL (not the before photo)", () => {
    // focusedInputs.inpaintImageUrl is the resolved inpaint source —
    // the parent route's healInpaintSource + listInpaintSources machinery
    // already chose this URL, so the studio gets the user's actual
    // selected source, never a 404 against `beforeImageUrl`.
    const props = buildEditRoomStudioProps(withRunArgs({
      project: baseProject,
      focusedRoom: baseFocusedRoom,
      focusedInputs: {
        inpaintImageUrl: "https://example.test/variant-a-as-source.jpg",
        roomDirectives: "",
      },
      directiveStatuses: {},
      touchUps: { original: 0, A: 0, B: 0 },
      running: null,
      onRun: () => {},
      onExitToProject: () => {},
    }));
    expect(props.imageUrl).toBe("https://example.test/variant-a-as-source.jpg");
  });

  it("maps Room.afterImageUrl → lookbookVariantUrls.A", () => {
    const props = buildEditRoomStudioProps(withRunArgs({
      project: baseProject,
      focusedRoom: baseFocusedRoom,
      focusedInputs: baseFocusedInputs,
      directiveStatuses: {},
      touchUps: { original: 0, A: 0, B: 0 },
      running: null,
      onRun: () => {},
      onExitToProject: () => {},
    }));
    expect(props.lookbookVariantUrls.A).toBe("https://example.test/variant-a.jpg");
  });

  it("maps Room.afterImageUrl2 → lookbookVariantUrls.B", () => {
    const props = buildEditRoomStudioProps(withRunArgs({
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
    }));
    expect(props.lookbookVariantUrls.B).toBe("https://example.test/variant-b.jpg");
  });

  it("defaults lookbookVariantUrls to null when the room has no completed variant", () => {
    const props = buildEditRoomStudioProps(withRunArgs({
      project: baseProject,
      focusedRoom: { ...baseFocusedRoom, afterImageUrl: null, afterImageUrl2: null },
      focusedInputs: baseFocusedInputs,
      directiveStatuses: {},
      touchUps: { original: 0, A: 0, B: 0 },
      running: null,
      onRun: () => {},
      onExitToProject: () => {},
    }));
    expect(props.lookbookVariantUrls).toEqual({ A: null, B: null });
  });

  it("maps selectedVariantIndex=0 → initialLookbookSlot='A'", () => {
    const props = buildEditRoomStudioProps(withRunArgs({
      project: baseProject,
      focusedRoom: baseFocusedRoom,
      focusedInputs: baseFocusedInputs,
      directiveStatuses: {},
      touchUps: { original: 0, A: 0, B: 0 },
      running: null,
      onRun: () => {},
      onExitToProject: () => {},
    }));
    expect(props.initialLookbookSlot).toBe("A");
  });

  it("maps selectedVariantIndex=1 → initialLookbookSlot='B'", () => {
    const props = buildEditRoomStudioProps(withRunArgs({
      project: baseProject,
      focusedRoom: { ...baseFocusedRoom, selectedVariantIndex: 1 },
      focusedInputs: baseFocusedInputs,
      directiveStatuses: {},
      touchUps: { original: 0, A: 0, B: 0 },
      running: null,
      onRun: () => {},
      onExitToProject: () => {},
    }));
    expect(props.initialLookbookSlot).toBe("B");
  });

  it("maps selectedVariantIndex=null → initialLookbookSlot='original' (issue #1381)", () => {
    // Issue #1381 — the resolver used to fall back to "A" for any
    // value outside {0,1} (including null), which was the legacy
    // #169 "default to A" convention from when rooms were created
    // with implicit A binding. That convention produced a stale
    // lookbookSlot when a server action (the #1381 patch in
    // `deleteInpaintVariant`) deliberately unbinded to null after
    // deleting both variants — the resolver would silently re-bind
    // to A on the next mount, leaving the user looking at the
    // original photo while the lookbook announced "A".
    //
    // The new resolver treats null (and any out-of-band sentinel)
    // as an explicit "no variant bound" signal → the unrouted
    // `"original"` slot. Fresh rooms continue to land on A
    // because the schema default for `selectedVariantIndex` is 0.
    const props = buildEditRoomStudioProps(withRunArgs({
      project: baseProject,
      focusedRoom: { ...baseFocusedRoom, selectedVariantIndex: null },
      focusedInputs: baseFocusedInputs,
      directiveStatuses: {},
      touchUps: { original: 0, A: 0, B: 0 },
      running: null,
      onRun: () => {},
      onExitToProject: () => {},
    }));
    expect(props.initialLookbookSlot).toBe("original");
  });

  it("maps selectedVariantIndex=-1 to initialLookbookSlot='original' (forward-compat sentinel)", () => {
    // Issue #1381 — the resolver should treat any non-{0,1} sentinel
    // (including future reserved values like -1) as "no variant
    // bound" rather than silently re-binding to A. This keeps the
    // contract robust if a future Prisma migration introduces more
    // explicit "unbound" sentinels without touching the resolver.
    const props = buildEditRoomStudioProps(withRunArgs({
      project: baseProject,
      focusedRoom: { ...baseFocusedRoom, selectedVariantIndex: -1 as number | null },
      focusedInputs: baseFocusedInputs,
      directiveStatuses: {},
      touchUps: { original: 0, A: 0, B: 0 },
      running: null,
      onRun: () => {},
      onExitToProject: () => {},
    }));
    expect(props.initialLookbookSlot).toBe("original");
  });

  it("forwards the project aesthetic + global directives", () => {
    const props = buildEditRoomStudioProps(withRunArgs({
      project: baseProject,
      focusedRoom: baseFocusedRoom,
      focusedInputs: baseFocusedInputs,
      directiveStatuses: {},
      touchUps: { original: 0, A: 0, B: 0 },
      running: null,
      onRun: () => {},
      onExitToProject: () => {},
    }));
    expect(props.aesthetic).toBe("Warm Transitional");
    expect(props.globalDirectives).toBe("Preserve the original brick fireplace.");
  });

  it("defaults saveStatus to 'idle' when the room hasn't typed yet", () => {
    const props = buildEditRoomStudioProps(withRunArgs({
      project: baseProject,
      focusedRoom: baseFocusedRoom,
      focusedInputs: baseFocusedInputs,
      directiveStatuses: {},
      touchUps: { original: 0, A: 0, B: 0 },
      running: null,
      onRun: () => {},
      onExitToProject: () => {},
    }));
    expect(props.saveStatus).toBe("idle");
  });

  it("mirrors the room's directive save status", () => {
    const props = buildEditRoomStudioProps(withRunArgs({
      project: baseProject,
      focusedRoom: baseFocusedRoom,
      focusedInputs: baseFocusedInputs,
      directiveStatuses: { "room-1": "saving" },
      touchUps: { original: 0, A: 0, B: 0 },
      running: null,
      onRun: () => {},
      onExitToProject: () => {},
    }));
    expect(props.saveStatus).toBe("saving");
  });

  it("narrows AutosaveStatus 'dirty' to shell SaveStatus 'idle' (issue #1344)", () => {
    // The route's `directiveStatuses` map carries the broader
    // `AutosaveStatus` ("idle" | "dirty" | "saving" | "saved" |
    // "error"). The new shell's `<TopBar>` `SAVE_LABEL` only knows
    // the four narrower shell states — passing "dirty" through would
    // throw on the `save.spin` read at render time (this regression
    // surfaced in the e2e suite after the harness flag flip in #1344).
    // The resolver collapses "dirty" → "idle" because the legacy
    // editor-inspector column treats "dirty" as the pre-saving "Saved"
    // visual state too — the user-facing pill never reveals the
    // distinction.
    const props = buildEditRoomStudioProps(withRunArgs({
      project: baseProject,
      focusedRoom: baseFocusedRoom,
      focusedInputs: baseFocusedInputs,
      directiveStatuses: { "room-1": "dirty" as never },
      touchUps: { original: 0, A: 0, B: 0 },
      running: null,
      onRun: () => {},
      onExitToProject: () => {},
    }));
    expect(props.saveStatus).toBe("idle");
  });

  it("forwards the listing-copy headline + body, coercing null → empty string", () => {
    const props = buildEditRoomStudioProps(withRunArgs({
      project: baseProject,
      focusedRoom: { ...baseFocusedRoom, lookbookHeadline: null, lookbookBody: null },
      focusedInputs: baseFocusedInputs,
      directiveStatuses: {},
      touchUps: { original: 0, A: 0, B: 0 },
      running: null,
      onRun: () => {},
      onExitToProject: () => {},
    }));
    expect(props.initialCopyHeadline).toBe("");
    expect(props.initialCopyBody).toBe("");
  });

  it("forwards non-null listing-copy verbatim", () => {
    const props = buildEditRoomStudioProps(withRunArgs({
      project: baseProject,
      focusedRoom: baseFocusedRoom,
      focusedInputs: baseFocusedInputs,
      directiveStatuses: {},
      touchUps: { original: 0, A: 0, B: 0 },
      running: null,
      onRun: () => {},
      onExitToProject: () => {},
    }));
    expect(props.initialCopyHeadline).toBe("A bright, airy retreat");
    expect(props.initialCopyBody).toBe("Refreshed textiles lift the space.");
  });

  // Issue #1359 — surface `Room.rawDirectives` as `initialDirections`
  // so the studio's Directions textarea restores on mount. Three pins
  // cover the three shapes the focused-room row can carry at runtime:
  // a non-null string (the happy path after the user has typed once),
  // null (the column was never written — first visit), and the
  // coerces-from-missing edge case.
  it("forwards Room.rawDirectives → initialDirections verbatim when non-null", () => {
    const props = buildEditRoomStudioProps(withRunArgs({
      project: baseProject,
      focusedRoom: {
        ...baseFocusedRoom,
        rawDirectives: "Modern coastal palette.",
      },
      focusedInputs: baseFocusedInputs,
      directiveStatuses: {},
      touchUps: { original: 0, A: 0, B: 0 },
      running: null,
      onRun: () => {},
      onExitToProject: () => {},
    }));
    expect(props.initialDirections).toBe("Modern coastal palette.");
  });

  it("coerces Room.rawDirectives=null → initialDirections='' (first visit)", () => {
    // The reducer initializer seeds `state.directions` from this
    // value, so an empty string (not `null`) is required — the
    // textarea uses a controlled string value. Same coercion shape
    // as `initialCopyHeadline` / `initialCopyBody`.
    const props = buildEditRoomStudioProps(withRunArgs({
      project: baseProject,
      focusedRoom: { ...baseFocusedRoom, rawDirectives: null },
      focusedInputs: baseFocusedInputs,
      directiveStatuses: {},
      touchUps: { original: 0, A: 0, B: 0 },
      running: null,
      onRun: () => {},
      onExitToProject: () => {},
    }));
    expect(props.initialDirections).toBe("");
  });

  it("coerces missing Room.rawDirectives → initialDirections='' (legacy room rows)", () => {
    // Older focused-room projections may omit `rawDirectives`
    // entirely. The resolver must not throw on the optional-missing
    // shape — it should fall through to the same empty-string
    // default as the null case.
    const { rawDirectives: _omit, ...roomWithoutRawDirectives } =
      baseFocusedRoom;
    void _omit;
    const props = buildEditRoomStudioProps(withRunArgs({
      project: baseProject,
      focusedRoom: roomWithoutRawDirectives,
      focusedInputs: baseFocusedInputs,
      directiveStatuses: {},
      touchUps: { original: 0, A: 0, B: 0 },
      running: null,
      onRun: () => {},
      onExitToProject: () => {},
    }));
    expect(props.initialDirections).toBe("");
  });

  // Issue #1362a — surface the three persisted FineTune columns
  // (`fineTuneStrength`, `fineTuneExpand`, `fineTuneSeed`) as
  // `initialFineTune`. The shell seeds its useStates from this bag;
  // each field is nullable so legacy rows with nulls (and rows where
  // any of the three were never written) fall through to the studio's
  // UI defaults (strength=50, expand=12, seed="").
  it("forwards Room.fineTune* → initialFineTune verbatim when all three are non-null", () => {
    const props = buildEditRoomStudioProps(withRunArgs({
      project: baseProject,
      focusedRoom: {
        ...baseFocusedRoom,
        fineTuneStrength: 75,
        fineTuneExpand: 18,
        fineTuneSeed: "12345",
      },
      focusedInputs: baseFocusedInputs,
      directiveStatuses: {},
      touchUps: { original: 0, A: 0, B: 0 },
      running: null,
      onRun: () => {},
      onExitToProject: () => {},
    }));
    expect(props.initialFineTune).toEqual({
      strength: 75,
      expand: 18,
      seed: "12345",
    });
  });

  it("forwards Room.fineTune* = null → initialFineTune = { strength:null, expand:null, seed:null } (first visit)", () => {
    // The shell's `useState(initialFineTune?.strength ?? 50)` shape
    // picks the UI default at the consumer; the resolver passes null
    // through unchanged so the consumer decides what "absent" means.
    const props = buildEditRoomStudioProps(withRunArgs({
      project: baseProject,
      focusedRoom: {
        ...baseFocusedRoom,
        fineTuneStrength: null,
        fineTuneExpand: null,
        fineTuneSeed: null,
      },
      focusedInputs: baseFocusedInputs,
      directiveStatuses: {},
      touchUps: { original: 0, A: 0, B: 0 },
      running: null,
      onRun: () => {},
      onExitToProject: () => {},
    }));
    expect(props.initialFineTune).toEqual({
      strength: null,
      expand: null,
      seed: null,
    });
  });

  it("forwards partial Room.fineTune* mix → initialFineTune with each independently (per-field null coalescing)", () => {
    // A row where the user set `fineTuneSeed` but never touched
    // strength/expand still round-trips: seed surfaces verbatim,
    // strength + expand surface as null, and the shell's per-field
    // `useState(... ?? default)` shape picks the right default at
    // each call site.
    const props = buildEditRoomStudioProps(withRunArgs({
      project: baseProject,
      focusedRoom: {
        ...baseFocusedRoom,
        fineTuneStrength: null,
        fineTuneExpand: null,
        fineTuneSeed: "999",
      },
      focusedInputs: baseFocusedInputs,
      directiveStatuses: {},
      touchUps: { original: 0, A: 0, B: 0 },
      running: null,
      onRun: () => {},
      onExitToProject: () => {},
    }));
    expect(props.initialFineTune).toEqual({
      strength: null,
      expand: null,
      seed: "999",
    });
  });

  it("forwards touch-ups count + running + onRun + onExitToProject verbatim", () => {
    const onRun = () => {};
    const onExitToProject = () => {};
    const props = buildEditRoomStudioProps(withRunArgs({
      project: baseProject,
      focusedRoom: baseFocusedRoom,
      focusedInputs: baseFocusedInputs,
      directiveStatuses: {},
      touchUps: { original: 0, A: 3, B: 1 },
      running: 42,
      onRun,
      onExitToProject,
    }));
    expect(props.touchUps).toEqual({ original: 0, A: 3, B: 1 });
    expect(props.running).toBe(42);
    expect(props.onRun).toBe(onRun);
    expect(props.onExitToProject).toBe(onExitToProject);
  });

  // Issue #1344 (real `useInpaintRuns` wire) — three new fields.
  // #1365 — `onDirectionsCommit` was removed; the shell no longer
  // schedules its own 900ms debounce. The parent route forwards
  // `editDirectives(roomId, value)` directly as
  // `onDirectivesChange`. The `maskDataUrl`/`onMaskChange` pair
  // plumbs the painted-area snapshot up to the submit path.
  it("forwards `onDirectivesChange` through verbatim (the parent route's editDirectives closure)", () => {
    const onDirectivesChange = () => {};
    const props = buildEditRoomStudioProps(withRunArgs({
      project: baseProject,
      focusedRoom: baseFocusedRoom,
      focusedInputs: baseFocusedInputs,
      directiveStatuses: {},
      touchUps: { original: 0, A: 0, B: 0 },
      running: null,
      onRun: () => {},
      onExitToProject: () => {},
      onDirectivesChange,
      maskDataUrl: null,
      onMaskChange: () => {},
    }));
    expect(props.onDirectivesChange).toBe(onDirectivesChange);
  });

  // #1365 — `directions` is the live route-mapped value the studio's
  // textarea renders; the resolver pulls it from `focusedInputs.roomDirectives`.
  it("forwards `directions` (live route-mapped value) from `focusedInputs.roomDirectives`", () => {
    const props = buildEditRoomStudioProps(withRunArgs({
      project: baseProject,
      focusedRoom: baseFocusedRoom,
      focusedInputs: { ...baseFocusedInputs, roomDirectives: "warm walnut sofa" },
      directiveStatuses: {},
      touchUps: { original: 0, A: 0, B: 0 },
      running: null,
      onRun: () => {},
      onExitToProject: () => {},
      onDirectivesChange: () => {},
      maskDataUrl: null,
      onMaskChange: () => {},
    }));
    expect(props.directions).toBe("warm walnut sofa");
  });

  it("forwards `maskDataUrl` through verbatim (slice 2 wires the painted-area snapshot)", () => {
    const maskDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg";
    const props = buildEditRoomStudioProps(withRunArgs({
      project: baseProject,
      focusedRoom: baseFocusedRoom,
      focusedInputs: baseFocusedInputs,
      directiveStatuses: {},
      touchUps: { original: 0, A: 0, B: 0 },
      running: null,
      onRun: () => {},
      onExitToProject: () => {},
      onDirectivesChange: () => {},
      maskDataUrl,
      onMaskChange: () => {},
    }));
    expect(props.maskDataUrl).toBe(maskDataUrl);
  });

  it("forwards `onMaskChange` through verbatim (slice 2 wires the snapshot-capture closure)", () => {
    const onMaskChange = () => {};
    const props = buildEditRoomStudioProps(withRunArgs({
      project: baseProject,
      focusedRoom: baseFocusedRoom,
      focusedInputs: baseFocusedInputs,
      directiveStatuses: {},
      touchUps: { original: 0, A: 0, B: 0 },
      running: null,
      onRun: () => {},
      onExitToProject: () => {},
      onDirectivesChange: () => {},
      maskDataUrl: null,
      onMaskChange,
    }));
    expect(props.onMaskChange).toBe(onMaskChange);
  });
});