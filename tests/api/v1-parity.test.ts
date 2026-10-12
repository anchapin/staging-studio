import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

// Issue #1125: the v1 stubs must validate the EXACT schema their
// unversioned twin enforces (shared by construction, not by copy), and
// every v1 error response must carry a machine-readable `code`.

const mockGetAuthedPrismaUser = vi.hoisted(() => vi.fn());
const mockRoomFindFirst = vi.hoisted(() => vi.fn());
const mockInpaintRequestFindFirst = vi.hoisted(() => vi.fn());
const mockDailyApiUsageFindUnique = vi.hoisted(() => vi.fn());
// Issue #1123: the v1 inpaint status route now runs the Postgres-backed poll
// limiter, which records through create/update on the first (allowed) poll.
const mockDailyApiUsageCreate = vi.hoisted(() => vi.fn());
const mockDailyApiUsageUpdate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: mockGetAuthedPrismaUser,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    room: { findFirst: mockRoomFindFirst },
    inpaintRequest: { findFirst: mockInpaintRequestFindFirst },
    dailyApiUsage: { findUnique: mockDailyApiUsageFindUnique, create: mockDailyApiUsageCreate, update: mockDailyApiUsageUpdate },
  },
}));

// Import after mocking
import { POST as POST_INPAINT } from "@/app/api/v1/inpaint/route";
import { POST as POST_GENERATE_COPY } from "@/app/api/v1/generate-copy/route";
import { POST as POST_SEGMENT } from "@/app/api/v1/segment/route";
import { POST as POST_SEGMENT_FURNISHINGS } from "@/app/api/v1/segment/furnishings/route";
import { GET as GET_INPAINT_STATUS } from "@/app/api/v1/inpaint/[requestId]/route";

const USER_ID = "user-1";
const ROOM_ID = "room-1";
const ALLOWLISTED_IMAGE = "https://project.supabase.co/storage/v1/object/public/rooms/r/photo.jpg";

function call(
  handler: (request: NextRequest, ...rest: never[]) => Promise<Response>,
  body: unknown,
  rest: unknown[] = []
): Promise<Response> {
  const request = new Request("http://localhost/api/v1/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return handler(request as unknown as NextRequest, ...(rest as never[]));
}

async function jsonOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthedPrismaUser.mockResolvedValue({ id: USER_ID });
  mockRoomFindFirst.mockResolvedValue({ id: ROOM_ID });
  mockInpaintRequestFindFirst.mockResolvedValue({ id: "req-1" });
  mockDailyApiUsageFindUnique.mockResolvedValue({ count: 0, timestamps: [] });
  mockDailyApiUsageCreate.mockResolvedValue({});
  mockDailyApiUsageUpdate.mockResolvedValue({});
});

describe("v1/twin request parity (issue #1125)", () => {
  it("v1 inpaint accepts the real inpaintSubmitSchema shape", async () => {
    const res = await call(POST_INPAINT, {
      roomId: ROOM_ID,
      imageUrl: ALLOWLISTED_IMAGE,
      maskUrl: "data:image/png;base64,abc",
      promptDirectives: "modern farmhouse kitchen",
      aesthetic: "scandinavian",
      variantSlot: 1,
    });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.version).toBe("v1");
  });

  it("v1 inpaint rejects the old invented shape (maskImageUrl/prompt, no variantSlot)", async () => {
    const res = await call(POST_INPAINT, {
      roomId: ROOM_ID,
      imageUrl: ALLOWLISTED_IMAGE,
      maskImageUrl: ALLOWLISTED_IMAGE,
      prompt: "modern farmhouse kitchen",
    });
    expect(res.status).toBe(400);
    const body = await jsonOf(res);
    expect(body.code).toBe("invalid-request");
  });

  it("v1 generate-copy accepts the real { roomId }-only shape", async () => {
    const res = await call(POST_GENERATE_COPY, { roomId: ROOM_ID });
    expect(res.status).toBe(200);
  });

  it("v1 generate-copy rejects { tone } (strict, matches twin)", async () => {
    const res = await call(POST_GENERATE_COPY, { roomId: ROOM_ID, tone: "persuasive" });
    expect(res.status).toBe(400);
    const body = await jsonOf(res);
    expect(body.code).toBe("invalid-request");
  });

  it("v1 segment rejects the old invented clickPoint shape (strict, matches twin)", async () => {
    const res = await call(POST_SEGMENT, {
      roomId: ROOM_ID,
      imageUrl: ALLOWLISTED_IMAGE,
      clickPoint: { x: 10, y: 20 },
    });
    expect(res.status).toBe(400);
    const body = await jsonOf(res);
    expect(body.code).toBe("invalid-request");
  });

  it("v1 segment accepts the twin shape with optional concept", async () => {
    const res = await call(POST_SEGMENT, { roomId: ROOM_ID, imageUrl: ALLOWLISTED_IMAGE });
    expect(res.status).toBe(200);
  });

  it("v1 segment rejects a non-allowlisted image host (allowlist parity with twin)", async () => {
    const res = await call(POST_SEGMENT, { roomId: ROOM_ID, imageUrl: "https://evil.example.com/photo.jpg" });
    expect(res.status).toBe(400);
    const body = await jsonOf(res);
    expect(body.code).toBe("invalid-request");
  });

  it("v1 segment/furnishings accepts the twin shape with concept", async () => {
    const res = await call(POST_SEGMENT_FURNISHINGS, { roomId: ROOM_ID, imageUrl: ALLOWLISTED_IMAGE, concept: "chair" });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.version).toBe("v1");
  });

  it("v1 segment/furnishings rejects an unknown key (strict, matches twin)", async () => {
    const res = await call(POST_SEGMENT_FURNISHINGS, { roomId: ROOM_ID, imageUrl: ALLOWLISTED_IMAGE, warm: true });
    expect(res.status).toBe(400);
    const body = await jsonOf(res);
    expect(body.code).toBe("invalid-request");
  });
});

describe("v1 error-code contract (issue #1125)", () => {
  // A schema-VALID body per route: the 403/429 paths sit after validation,
  // so the payload must get past it for the ownership/quota branch to run.
  const postHandlers: Array<[string, (r: NextRequest) => Promise<Response>, unknown, number]> = [
    ["inpaint", POST_INPAINT as never, { roomId: ROOM_ID, imageUrl: ALLOWLISTED_IMAGE, maskUrl: "data:image/png;base64,abc", promptDirectives: "x", aesthetic: "y", variantSlot: 1 }, 20],
    ["generate-copy", POST_GENERATE_COPY as never, { roomId: ROOM_ID }, 50],
    ["segment", POST_SEGMENT as never, { roomId: ROOM_ID, imageUrl: ALLOWLISTED_IMAGE }, 100],
    ["segment/furnishings", POST_SEGMENT_FURNISHINGS as never, { roomId: ROOM_ID, imageUrl: ALLOWLISTED_IMAGE }, 100],
  ];

  it.each(postHandlers)("401 carries code unauthorized (%s)", async (_name, handler) => {
    mockGetAuthedPrismaUser.mockResolvedValue(null);
    const res = await call(handler, {});
    expect(res.status).toBe(401);
    expect((await jsonOf(res)).code).toBe("unauthorized");
  });

  it.each(postHandlers)("403 carries code room-not-found (%s)", async (_name, handler, body) => {
    mockRoomFindFirst.mockResolvedValue(null);
    const res = await call(handler, body);
    expect(res.status).toBe(403);
    expect((await jsonOf(res)).code).toBe("room-not-found");
  });

  it.each(postHandlers)("429 carries code rate-limit-exceeded (%s)", async (_name, handler, bodyArg, expectedLimit) => {
    mockDailyApiUsageFindUnique.mockResolvedValue({ count: 999 });
    const res = await call(handler, bodyArg);
    expect(res.status).toBe(429);
    const body = await jsonOf(res);
    expect(body.code).toBe("rate-limit-exceeded");
    // Shared payload fields survive the wrap; limit is the route's own
    // (inpaint 20, copy 50, segment 100)
    expect(body.retryable).toBe(true);
    expect(body.limit).toBe(expectedLimit);
  });

  it("status GET 403 carries code request-not-found", async () => {
    mockInpaintRequestFindFirst.mockResolvedValue(null);
    const request = new Request("http://localhost/api/v1/inpaint/req-1", { method: "GET" });
    const res = await GET_INPAINT_STATUS(
      request as unknown as NextRequest,
      { params: Promise.resolve({ requestId: "req-1" }) } as never
    );
    expect(res.status).toBe(403);
    expect((await jsonOf(res)).code).toBe("request-not-found");
  });
});
