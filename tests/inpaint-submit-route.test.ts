import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

import { POST } from "@/app/api/inpaint/route";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { evaluateInpaintQualityGate } from "@/lib/inpaint-quality-gate";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

// Issue #1262: the inpaint route now goes through the inference
// abstraction in a fire-and-forget background tick, after pre-writing
// the InpaintRequest row with a locally-generated UUID. We mock the
// abstraction so the test does not depend on a real provider.
const mockInferenceSubmit = vi.hoisted(() => vi.fn());

vi.mock("@/lib/inference", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/inference")>();
  return {
    ...actual,
    // `assertInferenceConfigured` is a no-op for tests; it would
    // otherwise throw because the test env has no provider key.
    assertInferenceConfigured: vi.fn(),
    getInferenceClient: vi.fn(async () => ({
      subscribe: vi.fn(),
      submit: mockInferenceSubmit,
      status: vi.fn(),
      result: vi.fn(),
    })),
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    room: { findFirst: vi.fn() },
    inpaintRequest: {
      count: vi.fn(),
      create: vi.fn(),
      // Issue #1262: the background tick now calls `update` to flip
      // status / write providerJobId / write resultUrl.
      update: vi.fn(),
    },
    // Real (unmocked) @/lib/api-quota reads and writes the ledger through
    // these, so the inpaint cap is exercised for real here rather than
    // stubbed — see the "quota ledger" tests at the bottom.
    // Issue #1111: `claimDailyQuota` reads via `findUnique`, writes via
    // `updateMany` (conditional increment), `create` (first-of-day), and
    // `findUnique` (post-write read). `refundDailyQuota` writes via
    // `updateMany` (conditional decrement). The mocks below are
    // minimal-faithful — they default to "no row exists" / "claim
    // succeeded" and individual tests tighten them as needed.
    dailyApiUsage: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: vi.fn(),
}));

vi.mock("@/lib/inpaint-quality-gate", () => ({
  evaluateInpaintQualityGate: vi.fn(),
}));

const inferenceSubmit = mockInferenceSubmit as unknown as Mock;
const create = prisma.inpaintRequest.create as unknown as Mock;
const update = prisma.inpaintRequest.update as unknown as Mock;
const findFirst = prisma.room.findFirst as unknown as Mock;
const count = prisma.inpaintRequest.count as unknown as Mock;
const findUsage = prisma.dailyApiUsage.findUnique as unknown as Mock;
const upsertUsage = prisma.dailyApiUsage.upsert as unknown as Mock;
const claimUpdateMany = prisma.dailyApiUsage.updateMany as unknown as Mock;
const claimCreate = prisma.dailyApiUsage.create as unknown as Mock;
const authedUser = getAuthedPrismaUser as unknown as Mock;
const qualityGate = evaluateInpaintQualityGate as unknown as Mock;

const USER_ID = "user-1";
const ROOM_ID = "room-1";
// Issue #1262: the requestId is now locally generated, NOT the provider's
// own id. The provider's id flows into `providerJobId` via the
// background tick, never into the response.
const PROVIDER_REQUEST_ID = "provider-req-1";

const VALID_BODY = {
  imageUrl: "https://example.supabase.co/storage/v1/object/public/staging-images/before.png",
  maskUrl: "data:image/png;base64,BBB",
  promptDirectives: "Brighten the room, add warm neutrals",
  aesthetic: "Modern",
  roomId: ROOM_ID,
  variantSlot: 0,
  sourceSlot: null,
};

async function callSubmitRoute(): Promise<Response> {
  const request = new Request("http://localhost/api/inpaint", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(VALID_BODY),
  });
  return POST(request as unknown as NextRequest);
}

beforeEach(() => {
  vi.resetAllMocks();
  authedUser.mockResolvedValue({ id: USER_ID });
  count.mockResolvedValue(0);
  findFirst.mockResolvedValue({
    id: ROOM_ID,
    name: "Living Room",
    afterImageUrl: null,
    afterImageUrl2: null,
  });
  qualityGate.mockResolvedValue([]);
  inferenceSubmit.mockResolvedValue({ request_id: PROVIDER_REQUEST_ID });
  create.mockResolvedValue({});
  update.mockResolvedValue({});
  findUsage.mockResolvedValue(null);
  upsertUsage.mockResolvedValue({ count: 1 });
  // Issue #1111: default the atomic-claim mocks so the standard happy
  // path lands a successful claim. `claimUpdateMany` is the
  // conditional-increment step inside `claimDailyQuota`; the first
  // call (claimOnce) returns 1 row to signal "claim succeeded". The
  // `claimCreate` covers the first-of-day fallback inside
  // `claimDailyQuota` and is not exercised when the update already
  // succeeded, but it is set up so tests that exhaust the cap and
  // then re-attempt can rely on a known behavior.
  claimUpdateMany.mockResolvedValue({ count: 1 });
  claimCreate.mockImplementation(() => {
    throw new Error(
      "claimCreate should not be called when claimUpdateMany already succeeded"
    );
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/inpaint — InpaintRequest pre-write (issue #1262)", () => {
  it("pre-writes the row with a local UUID and status=IN_QUEUE before firing the background submit", async () => {
    create.mockResolvedValue({ id: "local-uuid-1" });
    update.mockResolvedValue({});

    const response = await callSubmitRoute();
    const body = await response.json();

    expect(response.status).toBe(200);
    // Exactly one create — the row is written ONCE, with a local id,
    // before the background submit is even kicked off.
    expect(create).toHaveBeenCalledTimes(1);
    const createCall = create.mock.calls[0]?.[0];
    const createData = (createCall as { data: Record<string, unknown> }).data;
    expect(createData.roomId).toBe(ROOM_ID);
    expect(createData.variantSlot).toBe(0);
    expect(createData.sourceSlot).toBeNull();
    expect(createData.status).toBe("IN_QUEUE");
    // providerJobId is NOT set at pre-write time — it lands in the
    // background `update` call once the provider returns its id.
    expect(createData).not.toHaveProperty("providerJobId");
    // The id is a fresh local UUID — distinct from the provider's id
    // because the route returns BEFORE the provider responds.
    expect(typeof createData.id).toBe("string");
    expect(createData.id).not.toBe(PROVIDER_REQUEST_ID);
    // The response carries the same local id so the client polls for it.
    expect(body.requestId).toBe(createData.id);
  });

  it("does NOT issue the background submit when the pre-write fails (#1262)", async () => {
    create.mockRejectedValue(new Error("db down"));

    const response = await callSubmitRoute();

    expect(response.status).toBe(500);
    // Failed pre-write must not trigger the provider call, otherwise a
    // 500 would invite the client into a retry that double-bills.
    expect(inferenceSubmit).not.toHaveBeenCalled();
  });

  it("does NOT await the background submit — the response returns before it settles (#1262)", async () => {
    // The background submit settles in microtasks; the route's
    // response must already be built by the time it does.
    let resolveSubmit!: (value: unknown) => void;
    inferenceSubmit.mockImplementation(
      () => new Promise((resolve) => {
        resolveSubmit = resolve;
      })
    );

    const response = await callSubmitRoute();
    expect(response.status).toBe(200);
    // We never resolved the submit — the response still came back.
    // (Resolve it now so the detached promise does not leak across tests.)
    resolveSubmit({ request_id: PROVIDER_REQUEST_ID });
  });
});

/**
 * Issue #1131: the inpaint cap used to be metered by COUNTING
 * `InpaintRequest` rows, which cascade-delete with the room — so deleting
 * the rooms staged today dropped the count and refunded the whole cap at
 * zero cost. Usage is now a `DailyApiUsage` counter row, charged once the
 * fal job is queued. `@/lib/api-quota` is deliberately NOT mocked here, so
 * these assertions run against the real ledger code.
 *
 * Issue #1262 rewrites the timing: the cap is still READ in the request
 * handler (no change), and the counter row is still WRITTEN (no change) —
 * but the write is fired in a detached promise instead of awaited, so the
 * assertions below verify the call happens without depending on its
 * resolution order.
 *
 * Issue #1111 rewrites the mechanism: the unit is ATOMICALLY CLAIMED via
 * `claimDailyQuota` BEFORE the pre-write and the background submit fire
 * (mirrors the other four paid surfaces — issue #1132). A successful
 * claim is the only way the background submit is allowed to fire; a
 * pre-write failure refunds the claim so a transient DB blip does not
 * bill for work that was not done. The conditional-increment
 * (`updateMany WHERE count <= limit - N`) replaces the post-submit
 * `upsertUsage` write, which is why the assertions below look at
 * `updateMany` + `findUnique` rather than `upsert`.
 */
describe("POST /api/inpaint — inpaint quota ledger (issue #1131 / #1111)", () => {
  it("atomically claims one inpaint unit before the pre-write and background submit (#1111)", async () => {
    const response = await callSubmitRoute();
    const body = await response.json();

    expect(response.status).toBe(200);
    // The cap is READ from the ledger, never derived from deletable
    // rows. #1111 still reads it before the claim (via
    // `getDailyUsage` → `findUnique`) so the 429 payload can carry
    // the same `used`/`limit`/`resetsAt` shape the other surfaces
    // expose.
    expect(findUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_surface_dayKey: expect.objectContaining({
            userId: USER_ID,
            surface: "inpaint",
          }),
        },
      })
    );
    expect(count).not.toHaveBeenCalled();
    // ...and the counter is incremented via the atomic claim BEFORE
    // the background submit fires (issue #1132's conditional
    // increment — serialized by Postgres so a concurrent burst can
    // no longer all read the same pre-spend count and all reach the
    // provider).
    expect(claimUpdateMany).toHaveBeenCalledTimes(1);
    const claimCall = claimUpdateMany.mock.calls[0]?.[0] as {
      where: { count: { lte: number } };
      data: { count: { increment: number } };
    };
    expect(claimCall.where.count.lte).toBeGreaterThanOrEqual(0);
    expect(claimCall.data.count.increment).toBe(1);
    // The pre-#1111 post-submit upsert is gone — the claim IS the
    // charge, not a separate "record after the bill" step.
    expect(upsertUsage).not.toHaveBeenCalled();
    void body;
  });

  it("fires the atomic claim first, then the pre-write, then the background submit (#1111 / #1262 ordering)", async () => {
    const order: string[] = [];
    claimUpdateMany.mockImplementation(async () => {
      order.push("claim");
      return { count: 1 };
    });
    create.mockImplementation(async () => {
      order.push("record");
      return {};
    });
    inferenceSubmit.mockImplementation(async () => {
      order.push("submit");
      return { request_id: PROVIDER_REQUEST_ID };
    });

    await callSubmitRoute();
    // Wait one tick so the detached promise settles. The route's
    // synchronous response is unaffected by the background ordering.
    await new Promise((resolve) => setImmediate(resolve));

    expect(order).toEqual(["claim", "record", "submit"]);
  });
});

/**
 * Issue #1111 acceptance: the inpaint unit is held by the atomic claim
 * BEFORE the paid provider call (so a concurrent burst can no longer all
 * read the same pre-spend count and all reach the provider — issue
 * #1132). A degraded record (the background submit fails AFTER the row
 * was pre-written, i.e. the provider call ran but the persistence path
 * errored) MUST still leave the counter row incremented, because the paid
 * work was done. The pre-write failure path is the ONLY refund path —
 * there the provider call never fired.
 */
describe("POST /api/inpaint — atomic quota claim (issue #1111)", () => {
  it("returns 429 with the standard payload shape when the claim is denied", async () => {
    // Cap exhausted: the conditional increment inside claimDailyQuota
    // finds zero rows (count > limit-N so the WHERE clause filters
    // them out). The create-fallback then races against an existing
    // row and loses with P2002; the second claimOnce also returns 0;
    // claimDailyQuota resolves with claimed:false.
    claimUpdateMany.mockResolvedValue({ count: 0 });
    claimCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError(
        "Unique constraint failed on the fields: (`userId`,`surface`,`dayKey`)",
        { code: "P2002", clientVersion: "5.22.0" }
      )
    );
    findUsage.mockResolvedValue({ count: 20 });

    const response = await callSubmitRoute();
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.error).toBe("Daily limit reached");
    expect(body.retryable).toBe(true);
    expect(body.used).toBe(20);
    expect(body.limit).toBe(20);
    expect(body.resetsAt).toEqual(expect.any(String));
    expect(body.code).toBe("rate-limit-exceeded");
    // A denied claim must NOT pre-write the row (no InpaintRequest
    // is created, no provider call is fired) — otherwise the user's
    // tab would still cost nothing but the row would be orphaned in
    // IN_QUEUE forever.
    expect(create).not.toHaveBeenCalled();
    expect(inferenceSubmit).not.toHaveBeenCalled();
  });

  it("leaves the counter incremented when the background submit fails (degraded record keeps the charge, #1111)", async () => {
    // Pre-write succeeds, then the background IIFE's provider
    // submit rejects. The provider call DID run (Alibaba synchronous,
    // ~$0.04; fal queue submit fired and the queue job is enqueued)
    // so the unit must stay charged — a refund here would bill the
    // user for a job the system did not do.
    create.mockResolvedValue({ id: "local-uuid-3" });
    update.mockResolvedValue({});
    inferenceSubmit.mockRejectedValue(new Error("provider gone"));

    // Capture the claim-updateMany call count before the request so
    // we can detect a refund call (which would also be an updateMany
    // — distinguish by the `decrement` in the data payload).
    const claimCallsBefore = claimUpdateMany.mock.calls.length;

    const response = await callSubmitRoute();
    expect(response.status).toBe(200); // the route returns 200 even on degraded (issue #1262)

    // Wait for the background IIFE to settle so the
    // inpaint_background_submit_failed log + mark-error update both
    // happen before we assert on the claim state.
    await new Promise((resolve) => setImmediate(resolve));

    // The claim WAS landed (one increment).
    expect(claimUpdateMany.mock.calls.length).toBeGreaterThanOrEqual(1);
    const claimWrite = claimUpdateMany.mock.calls[0]?.[0] as {
      data: { count: { increment?: number; decrement?: number } };
    };
    expect(claimWrite.data.count.increment).toBe(1);

    // ...and NO decrement was issued after the background failure.
    const laterCalls = claimUpdateMany.mock.calls.slice(claimCallsBefore + 1);
    for (const call of laterCalls) {
      const data = (call as unknown as { data: { count: { decrement?: number } } }).data;
      expect(data.count.decrement ?? 0).toBe(0);
    }
  });

  it("refunds the claim when the InpaintRequest pre-write fails (#1111)", async () => {
    // Pre-write rejects (transient DB blip on the row write).
    // The unit is held by the claim, the provider call has NOT
    // fired yet (the IIFE is gated on a successful pre-write), so
    // the claim must be refunded — otherwise the user is charged
    // for a job that was never queued.
    create.mockRejectedValue(new Error("db down"));

    const response = await callSubmitRoute();
    expect(response.status).toBe(500);

    // Wait for the background to settle (it should NOT have started,
    // but the wait is a safety net).
    await new Promise((resolve) => setImmediate(resolve));

    // The claim landed AND was refunded — exactly one decrement
    // after the increment, against the same row.
    const writes = claimUpdateMany.mock.calls;
    expect(writes.length).toBeGreaterThanOrEqual(2);
    const claimWrite = writes[0]?.[0] as {
      data: { count: { increment?: number } };
    };
    expect(claimWrite.data.count.increment).toBe(1);
    const refundWrite = writes[1]?.[0] as {
      where: { count: { gte: number } };
      data: { count: { decrement?: number } };
    };
    expect(refundWrite.data.count.decrement).toBe(1);
    // No provider call ran.
    expect(inferenceSubmit).not.toHaveBeenCalled();
  });
});

describe("POST /api/inpaint — pipeline event wiring (issue #1116)", () => {
  it("logs the submitted inpaint event and echoes the requestId in x-request-id", async () => {
    create.mockResolvedValue({ id: "local-uuid-2" });
    update.mockResolvedValue({});

    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => logger);
    const response = await callSubmitRoute();

    const requestId = response.headers.get("x-request-id");
    expect(requestId).not.toBeNull();
    // The x-request-id is the LOCAL row id, not the provider's request id.
    expect(requestId).not.toBe(PROVIDER_REQUEST_ID);

    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "inpaint",
        userId: USER_ID,
        requestId: expect.any(String),
        roomId: ROOM_ID,
        variantSlot: 0,
        status: "submitted",
      })
    );
  });
});
