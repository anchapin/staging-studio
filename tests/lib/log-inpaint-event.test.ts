import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { logInpaintEvent } from "@/lib/logInpaintEvent";
import { logger } from "@/lib/logger";

/**
 * Issue #1061: inpaint event telemetry.
 *
 * Per issue #997, this helper replaces a no-op stub with structured
 * event logging that the observability dashboard groups on. Every
 * inpaint run emits exactly one event with status {submitted,
 * completed, failed} so the dashboard can count daily runs and
 * success/failure ratios.
 */

describe("logInpaintEvent (issue #1061)", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    infoSpy = vi.spyOn(logger, "info").mockImplementation(() => logger);
  });
  afterEach(() => {
    infoSpy.mockRestore();
  });

  it("emits an `inpaint` event tagged with the input fields", () => {
    logInpaintEvent({
      userId: "user_1",
      requestId: "req_1",
      roomId: "room_1",
      variantSlot: 0,
      status: "submitted",
    });
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "inpaint",
        userId: "user_1",
        requestId: "req_1",
        roomId: "room_1",
        variantSlot: 0,
        status: "submitted",
      })
    );
  });

  it("supports the `completed` status", () => {
    logInpaintEvent({
      userId: "u",
      requestId: "r",
      roomId: "rm",
      variantSlot: 1,
      status: "completed",
    });
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed" })
    );
  });

  it("supports the `failed` status", () => {
    logInpaintEvent({
      userId: "u",
      requestId: "r",
      roomId: "rm",
      variantSlot: 0,
      status: "failed",
    });
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" })
    );
  });

  it("returns void (no caller expectation of a result)", () => {
    expect(
      logInpaintEvent({
        userId: "u",
        requestId: "r",
        roomId: "rm",
        variantSlot: 0,
        status: "submitted",
      })
    ).toBeUndefined();
  });

  it("emits exactly one structured log per call", () => {
    logInpaintEvent({
      userId: "u",
      requestId: "r",
      roomId: "rm",
      variantSlot: 0,
      status: "submitted",
    });
    expect(infoSpy).toHaveBeenCalledTimes(1);
  });
});