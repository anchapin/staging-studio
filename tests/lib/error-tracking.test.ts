import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ZodError } from "zod";

import { AppErrorType, trackError } from "@/lib/error-tracking";
import { logger } from "@/lib/logger";

/**
 * Issue #1061: error-tracking classification + structured logging.
 *
 * The app routes wrap their handlers with `createErrorHandler` so any
 * thrown error flows into trackError() with an AppErrorType. The
 * downstream observability dashboards group by errorType, so a
 * regression in classifyErrorType() (e.g. classifying "prisma" errors
 * as AuthError instead of DatabaseError) silently breaks alerting.
 */

describe("trackError (issue #1061)", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    infoSpy = vi.spyOn(logger, "info").mockImplementation(() => logger);
    errorSpy = vi.spyOn(logger, "error").mockImplementation(() => logger);
    warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => logger);
  });

  afterEach(() => {
    infoSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  describe("error type classification", () => {
    it("classifies a ZodError as ValidationError", () => {
      const zodError = new ZodError([
        {
          code: "invalid_type",
          path: ["x"],
          message: "expected number",
          expected: "number",
          received: "undefined",
        },
      ]);
      trackError(zodError, {});
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ errorType: AppErrorType.ValidationError }),
        expect.stringContaining(AppErrorType.ValidationError)
      );
    });

    it("classifies a Supabase auth error as AuthError", () => {
      trackError(new Error("Invalid Supabase token"), {});
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ errorType: AppErrorType.AuthError }),
        expect.stringContaining(AppErrorType.AuthError)
      );
    });

    it("classifies a 'prisma' error as DatabaseError", () => {
      trackError(new Error("PrismaClientKnownRequestError on rooms"), {});
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ errorType: AppErrorType.DatabaseError }),
        expect.stringContaining(AppErrorType.DatabaseError)
      );
    });

    it("classifies a 'unique constraint' message as DatabaseError (case-insensitive)", () => {
      trackError(new Error("UNIQUE CONSTRAINT failed on the rooms table"), {});
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ errorType: AppErrorType.DatabaseError }),
        expect.any(String)
      );
    });

    it("classifies a 'fal' error as ExternalApiError", () => {
      trackError(new Error("fal.ai upstream returned 502"), {});
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ errorType: AppErrorType.ExternalApiError }),
        expect.any(String)
      );
    });

    it("classifies a 'fetch' network error as ExternalApiError", () => {
      trackError(new Error("TypeError: fetch failed"), {});
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ errorType: AppErrorType.ExternalApiError }),
        expect.any(String)
      );
    });

    it("classifies a non-Error throw as UnknownError and stringifies the payload", () => {
      trackError("oops, a string was thrown", {});
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          errorType: AppErrorType.UnknownError,
          message: "oops, a string was thrown",
        }),
        expect.any(String)
      );
    });

    it("classifies an Error with no recognizable keyword as UnknownError", () => {
      trackError(new Error("the kettle boiled over"), {});
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ errorType: AppErrorType.UnknownError }),
        expect.any(String)
      );
    });
  });

  describe("structured log shape", () => {
    it("includes the stack trace when the error is an Error", () => {
      const error = new Error("with a stack");
      trackError(error, { path: "/api/x", method: "POST" });
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "app_error",
          message: "with a stack",
          stack: expect.any(String),
          path: "/api/x",
          method: "POST",
        }),
        expect.stringContaining("with a stack")
      );
    });

    it("omits the stack field when the thrown value is not an Error", () => {
      trackError({ code: "OBJ" }, {});
      const call = errorSpy.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(call.stack).toBeUndefined();
      expect(call.message).toBe("[object Object]");
    });

    it("spreads arbitrary context into the log payload", () => {
      trackError(new Error("x"), {
        requestId: "req_abc",
        sessionId: "sess_xyz",
        customField: 42,
      });
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: "req_abc",
          sessionId: "sess_xyz",
          customField: 42,
        }),
        expect.any(String)
      );
    });
  });

  describe("non-throwing semantics", () => {
    it("never throws — a logger that throws does not propagate", () => {
      errorSpy.mockImplementation(() => {
        throw new Error("logger is on fire");
      });
      expect(() => trackError(new Error("application error"), {})).not.toThrow();
    });

    it("returns void", () => {
      expect(trackError(new Error("x"), {})).toBeUndefined();
    });
  });
});