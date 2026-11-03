import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

/**
 * Regression pin for the TEMPORARY S1 size-check timing emitter added in
 * commit 2543696 (`src/app/actions/room-batch.ts`, `createRoomsBatch`).
 *
 * The emitter writes ONE `console.info(JSON.stringify({...}))` line per
 * batch with the fields `event`, `batchSize`, `checkedCount`,
 * `durations_ms`, `total_ms`, `oversizedIndex`. Nothing else in the repo
 * asserts on it, so a broken emitter would silently corrupt the
 * ">=100 real confirm batches" dataset the parallelize-or-not decision
 * (staging-studio async audit, issue #1493) depends on.
 *
 * These tests are TESTS-ONLY: the emitter and the sequential size-check
 * loop in `src/app/actions/room-batch.ts` are untouched.
 */

const mockPrisma = {
  project: {
    findUnique: vi.fn(),
  },
  room: {
    create: vi.fn(),
  },
  $transaction: vi.fn(),
};

const mockGetAuthedPrismaUser = vi.fn();
const mockRequireProjectOwnershipSafe = vi.fn();
const mockCreateSupabaseRequestClient = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: mockGetAuthedPrismaUser,
  requireProjectOwnershipSafe: mockRequireProjectOwnershipSafe,
}));

vi.mock("@/lib/supabase", () => ({
  createSupabaseRequestClient: mockCreateSupabaseRequestClient,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// The action module imports these at load time; keep them out of the
// test's module graph (the real ones pull in the OpenAI SDK / Prisma
// client / env requirements that this unit test does not exercise).
vi.mock("@/lib/room-type-detection", () => ({
  detectRoomType: vi.fn(),
}));

vi.mock("@/lib/retry", () => ({
  withRetry: vi.fn(async (fn: () => unknown) => fn()),
}));

vi.mock("@/lib/api-quota", () => ({
  DEFAULT_DAILY_LABEL_LIMIT: 20,
  DAILY_LIMIT_ENV_VAR: "DAILY_LABEL_LIMIT",
  claimDailyQuota: vi.fn(),
  dailyQuotaExceededPayload: vi.fn(),
  refundDailyQuota: vi.fn(),
  resolveDailyLimit: vi.fn(),
}));

const { createRoomsBatch } = await import("@/app/actions/room-batch");
const { MAX_ROOM_PHOTO_BYTES } = await import("@/lib/storage-cleanup");

const PROJECT_ID = "project-1";
const USER_ID = "user-1";
const STORAGE_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const SUPABASE_HOST = "ref.supabase.co";

/** The exact key set emitted by `room-batch.ts:131-140`. */
const EVENT_KEYS = [
  "event",
  "batchSize",
  "checkedCount",
  "durations_ms",
  "total_ms",
  "oversizedIndex",
];

type ListBehavior =
  | { kind: "size"; size: number }
  | { kind: "unreadable" }
  | { kind: "error" };

/**
 * Storage stub with controllable per-call latency and per-call result,
 * plus an in-flight counter so the sequentiality of the size-check loop
 * can be asserted (max concurrent `list()` calls must be 1).
 */
function setupStorage(behaviors: ListBehavior[], latencyMs = 5) {
  let calls = 0;
  let inFlight = 0;
  let maxInFlight = 0;

  const list = vi.fn(async (_folder: string, options?: { search?: string }) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      if (latencyMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, latencyMs));
      }
      const behavior = behaviors[calls];
      calls += 1;
      const name = options?.search ?? "";
      if (!behavior) return { data: [], error: null };
      if (behavior.kind === "error") {
        return { data: null, error: { message: "storage unavailable" } };
      }
      if (behavior.kind === "unreadable") {
        return { data: [{ name, metadata: null }], error: null };
      }
      return { data: [{ name, metadata: { size: behavior.size } }], error: null };
    } finally {
      inFlight -= 1;
    }
  });

  const remove = vi.fn(async (_paths: string[]) => ({ error: null }));
  const from = vi.fn((_bucket: string) => ({ list, remove }));

  mockCreateSupabaseRequestClient.mockResolvedValue({ storage: { from } });

  return {
    list,
    remove,
    from,
    getMaxInFlight: () => maxInFlight,
    getCallCount: () => calls,
  };
}

/** A schema-valid entry whose beforeImageUrl points at this project's batch folder. */
function entry(index: number) {
  return {
    fileName: `room-${index}.jpg`,
    roomType: "Living Room",
    beforeImageUrl: `https://${SUPABASE_HOST}/storage/v1/object/public/room-photos/batch-rooms/${PROJECT_ID}/room-${index}-${STORAGE_UUID}.jpg`,
  };
}

/** A schema-valid entry with no Supabase storage path (fal.ai host). */
function nonStorageEntry(index: number) {
  return {
    fileName: `room-${index}.jpg`,
    roomType: "Living Room",
    beforeImageUrl: `https://fal.ai/media/room-${index}.jpg`,
  };
}

/** Bucket-relative object paths, as `removeStorageObjects` passes them to `remove()`. */
function objectPath(index: number) {
  return `batch-rooms/${PROJECT_ID}/room-${index}-${STORAGE_UUID}.jpg`;
}

let infoSpy: MockInstance<typeof console.info>;
let warnSpy: MockInstance<typeof console.warn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthedPrismaUser.mockResolvedValue({ id: USER_ID });
  mockRequireProjectOwnershipSafe.mockResolvedValue({ project: { id: PROJECT_ID } });
  mockPrisma.project.findUnique.mockResolvedValue({ id: PROJECT_ID, rooms: [] });
  mockPrisma.room.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "room-created",
    name: data.name,
    beforeImageUrl: data.beforeImageUrl,
  }));
  mockPrisma.$transaction.mockImplementation(async (arg: unknown) =>
    Array.isArray(arg) ? Promise.all(arg) : arg
  );
  infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** All raw `console.info` arguments captured by the spy. */
function infoArgs(): string[] {
  const calls = infoSpy.mock.calls as unknown[][];
  return calls
    .map((call) => call[0])
    .filter((arg): arg is string => typeof arg === "string");
}

/** All `s1_size_check_timing` events captured from the console.info spy. */
function timingEvents(): Array<Record<string, unknown>> {
  return infoArgs()
    .map((arg) => JSON.parse(arg) as Record<string, unknown>)
    .filter((payload) => payload.event === "s1_size_check_timing");
}

describe("createRoomsBatch — s1_size_check_timing emitter", () => {
  it("(a) emits exactly one event for a successful batch of N", async () => {
    setupStorage([
      { kind: "size", size: 1000 },
      { kind: "size", size: 2000 },
      { kind: "size", size: 3000 },
    ]);

    const result = await createRoomsBatch(PROJECT_ID, [entry(0), entry(1), entry(2)]);

    expect(result.success).toBe(true);

    const events = timingEvents();
    expect(events).toHaveLength(1);

    const event = events[0];
    expect(Object.keys(event).sort()).toEqual([...EVENT_KEYS].sort());
    expect(event.event).toBe("s1_size_check_timing");
    expect(event.batchSize).toBe(3);
    expect(event.checkedCount).toBe(3);
    expect(Array.isArray(event.durations_ms)).toBe(true);
    expect((event.durations_ms as number[])).toHaveLength(3);
    for (const duration of event.durations_ms as number[]) {
      expect(typeof duration).toBe("number");
      expect(duration).toBeGreaterThanOrEqual(0);
    }
    expect(event.total_ms).toBe(
      (event.durations_ms as number[]).reduce((sum, ms) => sum + ms, 0)
    );
    expect(event.oversizedIndex).toBeNull();
  });

  it("(b) emits one event with oversizedIndex 1 and reclaims every path", async () => {
    const storage = setupStorage([
      { kind: "size", size: 1000 },
      { kind: "size", size: MAX_ROOM_PHOTO_BYTES + 1 },
      { kind: "size", size: 3000 },
    ]);

    const result = await createRoomsBatch(PROJECT_ID, [entry(0), entry(1), entry(2)]);

    expect(result.success).toBe(false);
    expect(result.error).toContain("too large");

    const events = timingEvents();
    expect(events).toHaveLength(1);
    expect(events[0].oversizedIndex).toBe(1);
    expect(events[0].batchSize).toBe(3);
    // The loop stops at the oversized entry, so only two sizes were checked.
    expect(events[0].checkedCount).toBe(2);
    expect((events[0].durations_ms as number[])).toHaveLength(2);

    // Every uploaded path is reclaimed, not just the oversized one.
    expect(storage.remove).toHaveBeenCalledTimes(1);
    expect(storage.remove.mock.calls[0][0]).toEqual([
      objectPath(0),
      objectPath(1),
      objectPath(2),
    ]);
    expect(mockPrisma.room.create).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("(c) emits exactly one event for an empty batch (no storage paths)", async () => {
    const storage = setupStorage([]);

    const result = await createRoomsBatch(PROJECT_ID, [nonStorageEntry(0)]);

    expect(result.success).toBe(true);

    const events = timingEvents();
    expect(events).toHaveLength(1);
    expect(Object.keys(events[0]).sort()).toEqual([...EVENT_KEYS].sort());
    expect(events[0].batchSize).toBe(0);
    expect(events[0].checkedCount).toBe(0);
    expect(events[0].durations_ms).toEqual([]);
    expect(events[0].total_ms).toBe(0);
    expect(events[0].oversizedIndex).toBeNull();
    expect(storage.getCallCount()).toBe(0);
  });

  it("(d) treats an unreadable size as passing through", async () => {
    const storage = setupStorage([
      { kind: "unreadable" },
      { kind: "error" },
    ]);

    const result = await createRoomsBatch(PROJECT_ID, [entry(0), entry(1)]);

    expect(result.success).toBe(true);

    const events = timingEvents();
    expect(events).toHaveLength(1);
    expect(events[0].oversizedIndex).toBeNull();
    expect(events[0].checkedCount).toBe(2);
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it("(e) logs no ids, paths, or sizes", async () => {
    const secretSize = 987654321;
    setupStorage([
      { kind: "size", size: secretSize },
      { kind: "size", size: 42 },
    ]);

    await createRoomsBatch(PROJECT_ID, [entry(0), entry(1)]);

    const events = timingEvents();
    expect(events).toHaveLength(1);

    const raw = infoArgs().join("\n");

    expect(Object.keys(events[0]).sort()).toEqual([...EVENT_KEYS].sort());
    for (const forbidden of [
      PROJECT_ID,
      USER_ID,
      SUPABASE_HOST,
      "room-photos",
      "batch-rooms",
      "room-0",
      STORAGE_UUID,
      String(secretSize),
    ]) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it("(f) keeps the size-check loop sequential (max 1 in-flight list call)", async () => {
    const storage = setupStorage(
      [
        { kind: "size", size: 1000 },
        { kind: "size", size: 2000 },
        { kind: "size", size: 3000 },
        { kind: "size", size: 4000 },
      ],
      5
    );

    const result = await createRoomsBatch(PROJECT_ID, [
      entry(0),
      entry(1),
      entry(2),
      entry(3),
    ]);

    expect(result.success).toBe(true);
    expect(storage.getMaxInFlight()).toBe(1);
    expect(storage.list).toHaveBeenCalledTimes(4);
    const listCalls = storage.list.mock.calls as unknown[][];
    expect(listCalls.map((call) => (call[1] as { search?: string } | undefined)?.search)).toEqual([
      `room-0-${STORAGE_UUID}.jpg`,
      `room-1-${STORAGE_UUID}.jpg`,
      `room-2-${STORAGE_UUID}.jpg`,
      `room-3-${STORAGE_UUID}.jpg`,
    ]);

    const events = timingEvents();
    expect(events).toHaveLength(1);
    expect(events[0].checkedCount).toBe(4);
    expect((events[0].durations_ms as number[])).toHaveLength(4);
  });

  it("emits no timing event when the request fails validation", async () => {
    setupStorage([]);

    const result = await createRoomsBatch(PROJECT_ID, []);

    expect(result.success).toBe(false);
    expect(timingEvents()).toHaveLength(0);
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
