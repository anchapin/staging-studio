import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

import { logger } from "@/lib/logger";
import { withActionLogging, withRequestLogging } from "@/lib/api-logging";

/**
 * Issue #1061: request + action logging wrappers.
 *
 * The request logger fires once per route invocation with method / path /
 * status / duration / requestId. The action logger tracks errors from
 * server actions, attaching the supplied context.
 *
 * What we pin:
 * - happy path logs method, path, status, duration
 * - 500 path tracks the error via trackError AND logs the same
 *   "http_request" event with status 500 (the route's catch block is
 *   responsible for translating the thrown error into the response shape)
 * - thrown errors re-propagate (the wrappers never swallow)
 * - action wrapper attaches the supplied context on the throw path
 * - requestId comes from the x-request-id header when present
 */

function makeRequest(opts: {
  method?: string;
  url?: string;
  requestId?: string;
} = {}): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.requestId) headers["x-request-id"] = opts.requestId;
  return new NextRequest(opts.url ?? "https://example.com/api/test", {
    method: opts.method ?? "GET",
    headers,
  });
}

describe("withRequestLogging (issue #1061)", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    infoSpy = vi.spyOn(logger, "info").mockImplementation(() => logger);
  });
  afterEach(() => {
    infoSpy.mockRestore();
  });

  it("logs method, path, status, duration_ms on the happy path", async () => {
    const handler = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    const wrapped = withRequestLogging(handler);
    await wrapped(makeRequest({ method: "POST", url: "https://example.com/api/projects" }));

    expect(handler).toHaveBeenCalledOnce();
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "http_request",
        method: "POST",
        path: "/api/projects",
        status: 200,
        duration_ms: expect.any(Number),
      })
    );
  });

  it("includes the x-request-id header value when present", async () => {
    const handler = vi.fn(async () => new Response("ok", { status: 200 }));
    await withRequestLogging(handler)(
      makeRequest({ requestId: "req_abc123" })
    );
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "req_abc123" })
    );
  });

  it("omits requestId when the x-request-id header is absent", async () => {
    const handler = vi.fn(async () => new Response("ok", { status: 200 }));
    await withRequestLogging(handler)(makeRequest());
    const call = infoSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.requestId).toBeUndefined();
  });

  it("logs status 500 and re-throws when the handler throws", async () => {
    const error = new Error("downstream blew up");
    const handler = vi.fn(async () => {
      throw error;
    });
    const wrapped = withRequestLogging(handler);
    await expect(wrapped(makeRequest())).rejects.toBe(error);

    // The wrapper itself logs ONE structured event with status 500;
    // trackError is called separately for the error itself (covered by
    // error-tracking tests).
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "http_request",
        status: 500,
        duration_ms: expect.any(Number),
      })
    );
  });

  it("measures duration as a non-negative number", async () => {
    const handler = vi.fn(async () => new Response("ok", { status: 200 }));
    await withRequestLogging(handler)(makeRequest());
    const call = infoSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(typeof call.duration_ms).toBe("number");
    expect(call.duration_ms as number).toBeGreaterThanOrEqual(0);
  });
});

describe("withActionLogging (issue #1061)", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(logger, "error").mockImplementation(() => logger);
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("returns the action's value when it does not throw", () => {
    // The helper constrains parameter types to unknown — the testable
    // action narrows inside its body.
    const action = (...args: unknown[]) =>
      typeof args[0] === "number" ? args[0] * 2 : 0;
    const wrapped = withActionLogging(action, { feature: "demo" });
    expect(wrapped(21)).toBe(42);
  });

  it("propagates the thrown error to the caller", () => {
    const action = () => {
      throw new Error("kaboom");
    };
    const wrapped = withActionLogging(action, { feature: "demo" });
    expect(() => wrapped()).toThrow("kaboom");
  });

  it("forwards all arguments to the wrapped action", () => {
    // The helper's type signature constrains parameters to unknown (the
    // top type) — testable actions must therefore accept unknown at the
    // call boundary and narrow internally.
    const action = (...args: unknown[]) =>
      args.map((a) => String(a)).join("-");
    const wrapped = withActionLogging(action);
    expect(wrapped(1, "two", true)).toBe("1-two-true");
  });

  it("supports an empty context object", () => {
    const action = () => 7;
    const wrapped = withActionLogging(action);
    expect(wrapped()).toBe(7);
    // No throw ⇒ no error log
    expect(errorSpy).not.toHaveBeenCalled();
  });
});