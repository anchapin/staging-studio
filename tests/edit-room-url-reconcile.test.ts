import { describe, expect, test } from "vitest";
import {
  mergeServerUrlFields,
  type MergeableProject,
  type MergeableRoom,
} from "@/lib/edit-room-url-reconcile";

describe("mergeServerUrlFields (#1376)", () => {
  function fixture(
    rooms: Partial<MergeableRoom>[],
  ): MergeableProject {
    return {
      rooms: rooms.map((r, i) => ({
        id: r.id ?? `room-${i}`,
        afterImageUrl: r.afterImageUrl,
        afterImageUrl2: r.afterImageUrl2,
        selectedVariantIndex: r.selectedVariantIndex,
      })),
    };
  }

  test("variant delete: server's explicit null wins over local's old URL", () => {
    // Setup: local thinks variant A still has an image; server just
    // cleared the slot via `deleteInpaintVariant` + `revalidatePath`.
    const local = fixture([
      {
        id: "r1",
        afterImageUrl: "https://cdn/A.jpg",
        afterImageUrl2: "https://cdn/B.jpg",
        selectedVariantIndex: 0,
      },
    ]);
    const server = fixture([
      {
        id: "r1",
        afterImageUrl: null,
        afterImageUrl2: "https://cdn/B.jpg",
        selectedVariantIndex: 0,
      },
    ]);

    const merged = mergeServerUrlFields(local, server);

    expect(merged.rooms[0].afterImageUrl).toBeNull(); // deleted
    expect(merged.rooms[0].afterImageUrl2).toBe("https://cdn/B.jpg"); // preserved
    expect(merged.rooms[0].selectedVariantIndex).toBe(0); // preserved
  });

  test("variant completion: server's new URL replaces local's old URL", () => {
    // Setup: an inpaint run completed server-side; the optimistic
    // local URL was already adopted via applyRoomUpdate, but a
    // concurrent server round-trip should also flow through.
    const local = fixture([{ id: "r1", afterImageUrl: "https://cdn/v1.jpg" }]);
    const server = fixture([{ id: "r1", afterImageUrl: "https://cdn/v2.jpg" }]);

    const merged = mergeServerUrlFields(local, server);

    expect(merged.rooms[0].afterImageUrl).toBe("https://cdn/v2.jpg");
  });

  test("server omits the field: local value is preserved (no clobber)", () => {
    // Setup: schema field is omitted from the server payload (older
    // Prisma select or a projection); local's optimistically-written
    // value must survive. The fix should not blast local state when
    // server field is undefined.
    const local = fixture([
      { id: "r1", afterImageUrl: "https://cdn/A.jpg", selectedVariantIndex: 0 },
    ]);
    const server = fixture([{ id: "r1" }]);

    const merged = mergeServerUrlFields(local, server);

    expect(merged.rooms[0].afterImageUrl).toBe("https://cdn/A.jpg");
    expect(merged.rooms[0].selectedVariantIndex).toBe(0);
  });

  test("server null beats server undefined: explicit delete wins over omission", () => {
    // Sharp edge: server *null* and server *undefined* mean different
    // things here. Null = "this variant was deleted"; undefined =
    // "the field was not included in the payload". The merge must
    // not fall back to the local value when the server explicitly
    // cleared the slot.
    const local = fixture([{ id: "r1", afterImageUrl: "https://cdn/A.jpg" }]);
    const serverNull = fixture([{ id: "r1", afterImageUrl: null }]);
    const serverOmit = fixture([{ id: "r1" }]);

    expect(mergeServerUrlFields(local, serverNull).rooms[0].afterImageUrl).toBeNull();
    expect(mergeServerUrlFields(local, serverOmit).rooms[0].afterImageUrl).toBe("https://cdn/A.jpg");
  });

  test("local-only rooms are preserved unchanged", () => {
    // Setup: the server returned a subset of rooms (or the local
    // snapshot somehow has a room the server doesn't know about);
    // merging must not drop them.
    const local = fixture([
      { id: "r1", afterImageUrl: "https://cdn/A.jpg" },
      { id: "r2", afterImageUrl: "https://cdn/B.jpg" },
    ]);
    const server = fixture([
      { id: "r1", afterImageUrl: null }, // only r1 cleared
    ]);

    const merged = mergeServerUrlFields(local, server);

    expect(merged.rooms).toHaveLength(2);
    expect(merged.rooms[0].afterImageUrl).toBeNull();
    expect(merged.rooms[1].afterImageUrl).toBe("https://cdn/B.jpg");
  });

  test("non-room fields on the project are passed through", () => {
    // Setup: project snapshot has more than `rooms` (name, address,
    // stagingPackage, etc.). The merge must not strip those — only
    // `rooms` is the merge target.
    interface FullProject extends MergeableProject {
      name: string;
      stagingPackage: string;
    }
    const local: FullProject = {
      rooms: [{ id: "r1", afterImageUrl: "https://cdn/A.jpg" }],
      name: "123 Main St",
      stagingPackage: "Flagship",
    };
    const server: FullProject = {
      rooms: [{ id: "r1", afterImageUrl: null }],
      name: "123 Main St",
      stagingPackage: "Flagship",
    };

    const merged = mergeServerUrlFields(local, server);

    expect(merged.name).toBe("123 Main St");
    expect(merged.stagingPackage).toBe("Flagship");
    expect(merged.rooms[0].afterImageUrl).toBeNull();
  });

  test("re-flip after server deletes a different variant", () => {
    // Multi-step: the user deletes variant A, then variant B in two
    // separate e2e runs (separate test cases share a parent describe).
    // After each delete, the merge must clear only the slot that the
    // server cleared.
    const local = fixture([
      {
        id: "r1",
        afterImageUrl: null,
        afterImageUrl2: "https://cdn/B.jpg",
        selectedVariantIndex: 1,
      },
    ]);
    const server = fixture([
      {
        id: "r1",
        afterImageUrl: null,
        afterImageUrl2: null,
        selectedVariantIndex: 1,
      },
    ]);

    const merged = mergeServerUrlFields(local, server);

    expect(merged.rooms[0].afterImageUrl).toBeNull();
    expect(merged.rooms[0].afterImageUrl2).toBeNull();
  });

  test("does not mutate the inputs (pure)", () => {
    const local = fixture([{ id: "r1", afterImageUrl: "https://cdn/A.jpg" }]);
    const localCopy = JSON.parse(JSON.stringify(local));
    const server = fixture([{ id: "r1", afterImageUrl: null }]);
    const serverCopy = JSON.parse(JSON.stringify(server));

    mergeServerUrlFields(local, server);

    expect(local).toEqual(localCopy);
    expect(server).toEqual(serverCopy);
  });
});
