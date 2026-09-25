/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { withErrorHandler, ApiError } from "@/lib/api-error-handler";
import { API_ERROR_INTERNAL_SERVER, API_ERROR_INVALID_REQUEST } from "@/lib/api-errors";

describe("withErrorHandler", () => {
  it("returns the handler response when no error is thrown", async () => {
    const handler = withErrorHandler(async (req: NextRequest) =>
      NextResponse.json({ ok: true })
    );
    const response = await handler(new NextRequest("http://localhost"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("catches a thrown Error and returns a structured 500 JSON response", async () => {
    const handler = withErrorHandler(async (req: NextRequest) => {
      throw new Error("database connection failed");
    });
    const response = await handler(new NextRequest("http://localhost"));

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: {
        code: API_ERROR_INTERNAL_SERVER,
        message: "An unexpected error occurred",
      },
    });
  });

  it("catches a thrown non-Error value and returns a safe 500 response", async () => {
    const handler = withErrorHandler(async (req: NextRequest) => {
      throw "something went wrong";
    });
    const response = await handler(new NextRequest("http://localhost"));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe(API_ERROR_INTERNAL_SERVER);
    expect(body.error.message).toBe("An unexpected error occurred");
  });

  it("catches a thrown ApiError and returns its shaped response", async () => {
    const handler = withErrorHandler(async (req: NextRequest) => {
      throw new ApiError({
        code: API_ERROR_INVALID_REQUEST,
        message: "The request body is invalid.",
        status: 400,
        details: [{ path: "name", message: "required" }],
      });
    });
    const response = await handler(new NextRequest("http://localhost"));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: {
        code: API_ERROR_INVALID_REQUEST,
        message: "The request body is invalid.",
        details: [{ path: "name", message: "required" }],
      },
    });
  });

  it("passes through a handler that returns a 4xx response without wrapping", async () => {
    const handler = withErrorHandler(async (req: NextRequest) =>
      NextResponse.json({ error: "not found" }, { status: 404 })
    );
    const response = await handler(new NextRequest("http://localhost"));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not found" });
  });

  it("logs the error event before returning", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockReturnValue(undefined);

    const handler = withErrorHandler(async (req: NextRequest) => {
      throw new Error("unhandled");
    });
    await handler(new NextRequest("http://localhost/api/test"));

    expect(consoleSpy).toHaveBeenCalledOnce();
    const [logCtx, logErr] = consoleSpy.mock.calls[0]!;
    expect(JSON.parse(logCtx as string)).toMatchObject({
      event: "unhandled_route_error",
      path: "/api/test",
    });
    expect(logErr).toBeInstanceOf(Error);
    expect((logErr as Error).message).toBe("unhandled");

    consoleSpy.mockRestore();
  });
});
