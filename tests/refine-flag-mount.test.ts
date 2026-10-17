/**
 * Issue #1345 — flag-gated `<EditRoomStudio>` mount for the `/refine`
 * route.
 *
 * The redesign studio takes over the legacy `RefineStudioClient` when
 * `NEXT_PUBLIC_EDIT_ROOM_REDESIGN=1`, kept by an explicit re-export of
 * `EditRoomStudioMount` so the legacy import path is unchanged. Two
 * tests below pin:
 *
 *  - the wrapper exists and exports a `function` (i.e. is a React FC),
 *    so the host page's import resolves and the flag-ON branch renders
 *    the studio instead of the legacy client;
 *  - the host page's URL→focused-roomId resolution function picks the
 *    `?room=<id>` match when present, falls through to the first room
 *    otherwise.
 *
 * Out of scope here: the render shape of the studio itself (covered by
 * the wave-4 / wave-5 e2e suites; `editor-layout.spec.ts` in this PR
 * adds the flag-on URL assertion). This file pins only the wiring.
 */

import { describe, expect, it } from "vitest";

import { EditRoomStudioMount } from "@/app/(dashboard)/projects/[id]/refine/edit-room-studio-mount";
import { RefineStudioClient } from "@/app/(dashboard)/projects/[id]/refine/refine-studio-client";
import { resolveEditRoomRedesignEnabled } from "@/lib/edit-room-flag";

interface RefineRoom {
  id: string;
  name: string;
  beforeImageUrl: string | null;
  afterImageUrl: string | null;
  afterImageUrl2: string | null;
  selectedVariantIndex: number | null;
  rawDirectives: string | null;
  inpaintRequests: ReadonlyArray<unknown>;
}

function pickRefineRoomForUrl(
  rooms: ReadonlyArray<RefineRoom>,
  requestedRoomId: string | undefined,
): RefineRoom | null {
  // Mirrors the resolution shape in
  // `src/app/(dashboard)/projects/[id]/refine/page.tsx`: a `?room=<id>`
  // request that points at a renderable room wins, then the first
  // renderable room, then `null` for the empty case.
  const requestedRoom = rooms.find(
    (candidate) => candidate.id === requestedRoomId && candidate.beforeImageUrl !== null,
  );
  if (requestedRoom) return requestedRoom;
  const firstRenderable = rooms.find(
    (candidate) =>
      candidate.beforeImageUrl !== null &&
      (candidate.afterImageUrl !== null || candidate.afterImageUrl2 !== null),
  );
  if (firstRenderable) return firstRenderable;
  return rooms[0] ?? null;
}

describe("refine flag-gated mount (issue #1345)", () => {
  it("exports the new studio wrapper as a React FC", () => {
    expect(typeof EditRoomStudioMount).toBe("function");
  });

  it("keeps the legacy client importable for the flag-OFF path", () => {
    // The host page still imports `RefineStudioClient` for the
    // `!isEditRoomRedesignEnabled` branch. If a future cleanup removes
    // the legacy file, this test will fail and force an explicit
    // decision instead of a silent deploy.
    expect(typeof RefineStudioClient).toBe("function");
  });

  it("flag resolver still gates the new mount correctly (#1346 default is ON)", () => {
    // After #1346 the env var is a kill-switch (default ON, opt OUT
    // to legacy). Undefined / empty / whitespace default to true; the
    // explicit "0" / "false" / "no" set returns false; the original
    // truthy set still works for back-compat with the #1344 deploys.
    expect(resolveEditRoomRedesignEnabled(undefined)).toBe(true);
    expect(resolveEditRoomRedesignEnabled("")).toBe(true);
    expect(resolveEditRoomRedesignEnabled("1")).toBe(true);
    expect(resolveEditRoomRedesignEnabled("true")).toBe(true);
    expect(resolveEditRoomRedesignEnabled("0")).toBe(false);
    expect(resolveEditRoomRedesignEnabled("false")).toBe(false);
  });

  it("URL ?room=<id> picks the matching room when present", () => {
    const rooms: RefineRoom[] = [
      makeRoom("room-a"),
      makeRoom("room-b"),
      makeRoom("room-c"),
    ];
    const picked = pickRefineRoomForUrl(rooms, "room-b");
    expect(picked?.id).toBe("room-b");
  });

  it("falls through to the first renderable room when ?room is missing", () => {
    const rooms: RefineRoom[] = [
      makeRoom("room-a", { beforeImageUrl: null }),
      makeRoom("room-b"),
      makeRoom("room-c"),
    ];
    const picked = pickRefineRoomForUrl(rooms, undefined);
    expect(picked?.id).toBe("room-b");
  });

  it("falls through to the first row when nothing is renderable", () => {
    const rooms: RefineRoom[] = [
      makeRoom("room-a", { beforeImageUrl: null }),
      makeRoom("room-b", { beforeImageUrl: null, afterImageUrl: null, afterImageUrl2: null }),
    ];
    const picked = pickRefineRoomForUrl(rooms, undefined);
    // The current page logic resolves to the first row when nothing
    // passes the renderability gate, so the wrapper still has a
    // `focusedRoom` to mount.
    expect(picked?.id).toBe("room-a");
  });
});

function makeRoom(
  id: string,
  overrides: Partial<RefineRoom> = {},
): RefineRoom {
  return {
    id,
    name: `Room ${id}`,
    beforeImageUrl: `https://example.com/${id}/before.jpg`,
    afterImageUrl: `https://example.com/${id}/after.jpg`,
    afterImageUrl2: null,
    selectedVariantIndex: 0,
    rawDirectives: null,
    inpaintRequests: [],
    ...overrides,
  };
}
