import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { saveInpaintVersion } from "@/app/actions/inpaint-versions";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { createSupabaseRequestClient } from "@/lib/supabase";
import { prisma } from "@/lib/prisma";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    room: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  createSupabaseRequestClient: vi.fn(),
}));

const roomFindFirst = prisma.room.findFirst as unknown as Mock;
const $transaction = prisma.$transaction as unknown as Mock;
const authedUser = getAuthedPrismaUser as unknown as Mock;
const supabaseFactory = createSupabaseRequestClient as unknown as Mock;

const USER_ID = "user-1";
const ROOM_ID = "room-1";
const THUMB_DATA_URL = "data:image/jpeg;base64,aGk=";
const UUID_SUFFIX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/;

type SupabaseHarness = {
  client: {
    storage: {
      from: (bucket: string) => {
        upload: Mock;
        getPublicUrl: (path: string) => { data: { publicUrl: string } };
        remove: Mock;
      };
    };
  };
  uploadedPaths: string[];
  removedPaths: string[];
};

function makeSupabaseHarness(): SupabaseHarness {
  const uploadedPaths: string[] = [];
  const removedPaths: string[] = [];
  const client = {
    storage: {
      from: (bucket: string) => ({
        upload: vi.fn(async (path: string) => {
          uploadedPaths.push(path);
          return { data: { path }, error: null };
        }),
        getPublicUrl: (path: string) => ({
          data: {
            publicUrl: `https://stub.supabase.co/storage/v1/object/public/${bucket}/${path}`,
          },
        }),
        remove: vi.fn(async (paths: string[]) => {
          removedPaths.push(...paths);
          return { data: [], error: null };
        }),
      }),
    },
  };
  return { client, uploadedPaths, removedPaths };
}

type TxMocks = {
  $queryRaw: Mock;
  count: Mock;
  findMany: Mock;
  deleteMany: Mock;
  create: Mock;
};

function makeTx(): { tx: TxMocks; txObj: Record<string, unknown> } {
  const tx: TxMocks = {
    $queryRaw: vi.fn(async () => []),
    count: vi.fn(async () => 0),
    findMany: vi.fn(async () => []),
    deleteMany: vi.fn(async () => ({ count: 0 })),
    create: vi.fn(async () => ({ id: "version-new" })),
  };
  const txObj = {
    $queryRaw: tx.$queryRaw,
    inpaintVersion: {
      count: tx.count,
      findMany: tx.findMany,
      deleteMany: tx.deleteMany,
      create: tx.create,
    },
  };
  return { tx, txObj };
}

let supabase: SupabaseHarness;
let defaultTx: TxMocks;

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      blob: async () => new Blob(["thumb"], { type: "image/jpeg" }),
    }))
  );

  authedUser.mockResolvedValue({ id: USER_ID });
  roomFindFirst.mockResolvedValue({ id: ROOM_ID });

  supabase = makeSupabaseHarness();
  supabaseFactory.mockResolvedValue(supabase.client);

  const { tx, txObj } = makeTx();
  defaultTx = tx;
  $transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn(txObj)
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("saveInpaintVersion — race-safe FIFO cap + thumbnail path (issue #700)", () => {
  it("wraps the cap check, eviction, and insert in ONE transaction guarded by a room-row lock", async () => {
    const { tx, txObj } = makeTx();
    tx.count.mockResolvedValue(20);
    tx.findMany.mockResolvedValue([{ id: "old-1", thumbnailUrl: null }]);
    $transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn(txObj)
    );

    const result = await saveInpaintVersion({
      roomId: ROOM_ID,
      variantSlot: 0,
      resultUrl: "https://fal.media/r.png",
      thumbnailDataUrl: THUMB_DATA_URL,
    });

    expect(result).toEqual({ success: true, versionId: "version-new" });
    expect($transaction).toHaveBeenCalledTimes(1);

    // The room-row lock must be taken BEFORE the count (serialization point).
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    const [strings, roomIdArg] = tx.$queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      string
    ];
    expect(String.raw(strings)).toContain('SELECT id FROM "Room"');
    expect(String.raw(strings)).toContain("FOR UPDATE");
    expect(roomIdArg).toBe(ROOM_ID);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.count.mock.invocationCallOrder[0]
    );

    // FIFO arithmetic at the cap: evict exactly 1 oldest, then insert.
    expect(tx.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { roomId: ROOM_ID, variantSlot: 0 },
        orderBy: { createdAt: "asc" },
        take: 1,
      })
    );
    expect(tx.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["old-1"] } },
    });
    expect(tx.create).toHaveBeenCalledTimes(1);
  });

  it("stores a UUID-suffixed thumbnail path and links the row to its public URL", async () => {
    await saveInpaintVersion({
      roomId: ROOM_ID,
      variantSlot: 1,
      resultUrl: "https://fal.media/r.png",
      thumbnailDataUrl: THUMB_DATA_URL,
    });

    expect(supabase.uploadedPaths).toHaveLength(1);
    const path = supabase.uploadedPaths[0];
    expect(path).toMatch(new RegExp(`^rooms/${ROOM_ID}/versions/1/`));
    expect(path).toMatch(UUID_SUFFIX);

    expect(defaultTx.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        thumbnailUrl: `https://stub.supabase.co/storage/v1/object/public/room-photos/${path}`,
      }),
    });
  });

  it("does not evict or touch storage when the slot is below the cap", async () => {
    const { tx, txObj } = makeTx();
    tx.count.mockResolvedValue(5);
    $transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn(txObj)
    );

    const result = await saveInpaintVersion({
      roomId: ROOM_ID,
      variantSlot: 0,
      resultUrl: "https://fal.media/r.png",
      thumbnailDataUrl: THUMB_DATA_URL,
    });

    expect(result).toEqual({ success: true, versionId: "version-new" });
    expect(tx.findMany).not.toHaveBeenCalled();
    expect(tx.deleteMany).not.toHaveBeenCalled();
    expect(supabase.removedPaths).toHaveLength(0);
  });

  it("cleans up evicted thumbnails only after the transaction commits", async () => {
    const { tx, txObj } = makeTx();
    tx.count.mockResolvedValue(20);
    tx.findMany.mockResolvedValue([
      {
        id: "old-1",
        thumbnailUrl: `https://stub.supabase.co/storage/v1/object/public/room-photos/rooms/${ROOM_ID}/versions/0/123-old.jpg`,
      },
      { id: "old-2", thumbnailUrl: null },
    ]);
    $transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn(txObj)
    );

    await saveInpaintVersion({
      roomId: ROOM_ID,
      variantSlot: 0,
      resultUrl: "https://fal.media/r.png",
      thumbnailDataUrl: THUMB_DATA_URL,
    });

    // Null thumbnail URLs are filtered; survivors map back to storage paths.
    expect(supabase.removedPaths).toEqual([
      `room-photos/rooms/${ROOM_ID}/versions/0/123-old.jpg`,
    ]);
  });

  it("returns a failure (and never runs storage cleanup) when the transaction aborts", async () => {
    $transaction.mockRejectedValue(new Error("create failed"));

    const result = await saveInpaintVersion({
      roomId: ROOM_ID,
      variantSlot: 0,
      resultUrl: "https://fal.media/r.png",
      thumbnailDataUrl: THUMB_DATA_URL,
    });

    expect(result).toEqual({ success: false, error: "Failed to save version" });
    expect(supabase.removedPaths).toHaveLength(0);
  });

  it("keeps ≤20 rows per slot with distinct thumbnail URLs after parallel saves", async () => {
    // In-memory FIFO database; $transaction serializes callbacks exactly the
    // way the room-row FOR UPDATE lock serializes them in Postgres, so the
    // count → evict → insert read-modify-write is never interleaved.
    const CAP = 20;
    const PARALLEL_SAVES = 12;
    type Row = {
      id: string;
      roomId: string;
      variantSlot: number;
      thumbnailUrl: string | null;
      createdAt: Date;
    };
    const rows: Row[] = Array.from({ length: CAP }, (_, i) => ({
      id: `seed-${i}`,
      roomId: ROOM_ID,
      variantSlot: 0,
      thumbnailUrl: null,
      createdAt: new Date(i),
    }));
    let nextId = 0;
    let clock = CAP;
    let chain: Promise<unknown> = Promise.resolve();

    const slotRows = (roomId: string, variantSlot: number) =>
      rows.filter((r) => r.roomId === roomId && r.variantSlot === variantSlot);

    $transaction.mockImplementation(
      (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
        const tx = {
          $queryRaw: vi.fn(async () => []),
          inpaintVersion: {
            count: async ({ where }: { where: { roomId: string; variantSlot: number } }) =>
              slotRows(where.roomId, where.variantSlot).length,
            findMany: async ({
              where,
              take,
            }: {
              where: { roomId: string; variantSlot: number };
              take: number;
            }) =>
              slotRows(where.roomId, where.variantSlot)
                .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
                .slice(0, take)
                .map(({ id, thumbnailUrl }) => ({ id, thumbnailUrl })),
            deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
              const ids = new Set(where.id.in);
              for (let i = rows.length - 1; i >= 0; i -= 1) {
                if (ids.has(rows[i].id)) rows.splice(i, 1);
              }
              return { count: ids.size };
            },
            create: async ({ data }: { data: Omit<Row, "id" | "createdAt"> }) => {
              const row: Row = {
                id: `new-${nextId++}`,
                createdAt: new Date(clock++),
                ...data,
              };
              rows.push(row);
              return row;
            },
          },
        };
        const run = chain.then(() => fn(tx));
        chain = run.catch(() => {});
        return run;
      }
    );

    const results = await Promise.all(
      Array.from({ length: PARALLEL_SAVES }, (_, i) =>
        saveInpaintVersion({
          roomId: ROOM_ID,
          variantSlot: 0,
          resultUrl: `https://fal.media/r-${i}.png`,
          thumbnailDataUrl: THUMB_DATA_URL,
        })
      )
    );

    expect(results.every((r) => r.success)).toBe(true);

    // FIFO invariant: cap never exceeded, oldest evicted first.
    const finalRows = slotRows(ROOM_ID, 0);
    expect(finalRows).toHaveLength(CAP);
    const survivingSeedIds = finalRows
      .filter((r) => r.id.startsWith("seed-"))
      .map((r) => r.id);
    expect(survivingSeedIds).toEqual(
      Array.from(
        { length: CAP - PARALLEL_SAVES },
        (_, i) => `seed-${PARALLEL_SAVES + i}`
      )
    );

    // Distinct-thumbnail invariant: no two rows share an object key/URL.
    const newUrls = finalRows
      .filter((r) => r.id.startsWith("new-"))
      .map((r) => r.thumbnailUrl);
    expect(newUrls).toHaveLength(PARALLEL_SAVES);
    expect(new Set(newUrls).size).toBe(PARALLEL_SAVES);
    expect(supabase.uploadedPaths).toHaveLength(PARALLEL_SAVES);
    expect(new Set(supabase.uploadedPaths).size).toBe(PARALLEL_SAVES);
    for (const path of supabase.uploadedPaths) {
      expect(path).toMatch(UUID_SUFFIX);
    }
  });
});
