import { describe, expect, it, vi } from "vitest";

import {
  classifyStatusResponse,
  pollInpaintStatus,
  type FetchInpaintStatus,
  type InpaintStatusResponse,
} from "@/lib/inpaint-polling";

describe("classifyStatusResponse", () => {
  describe("completed", () => {
    it("returns completed with imageUrl when status is completed and imageUrl present", () => {
      const body: InpaintStatusResponse = {
        status: "completed",
        imageUrl: "https://example.supabase.co/storage/v1/object/public/out.png",
      };

      expect(classifyStatusResponse(true, 200, body)).toEqual({
        kind: "completed",
        imageUrl: "https://example.supabase.co/storage/v1/object/public/out.png",
        persisted: true,
      });
    });

    it("carries persisted:false through so consumers can reject expiring fal URLs (issue #687)", () => {
      expect(
        classifyStatusResponse(true, 200, {
          status: "completed",
          imageUrl: "https://fal.media/flux/tmp/expiring.png",
          persisted: false,
        })
      ).toEqual({
        kind: "completed",
        imageUrl: "https://fal.media/flux/tmp/expiring.png",
        persisted: false,
      });
    });

    it("normalizes an absent persisted flag to true (durable by default)", () => {
      expect(
        classifyStatusResponse(true, 200, {
          status: "completed",
          imageUrl: "https://example.supabase.co/storage/v1/object/public/out.png",
        })
      ).toMatchObject({ kind: "completed", persisted: true });
    });

    it("returns retryable when status is completed but imageUrl is missing", () => {
      const body: InpaintStatusResponse = {
        status: "completed",
        message: "Image not found",
      };

      expect(classifyStatusResponse(true, 200, body)).toEqual({
        kind: "retryable",
        message: "Image not found",
      });
    });

    it("uses error over a missing message and falls back to a generic message when completed but no url", () => {
      expect(
        classifyStatusResponse(true, 200, { status: "completed", error: "boom" })
      ).toEqual({ kind: "retryable", message: "boom" });

      expect(classifyStatusResponse(true, 200, { status: "completed" })).toEqual({
        kind: "retryable",
        message: "The image was processed but could not be retrieved.",
      });
    });
  });

  describe("pending", () => {
    it("returns pending with the given status for ok responses", () => {
      expect(classifyStatusResponse(true, 200, { status: "IN_PROGRESS" })).toEqual({
        kind: "pending",
        status: "IN_PROGRESS",
      });
    });

    it("falls back to 'unknown' when ok but no status field", () => {
      expect(classifyStatusResponse(true, 200, {})).toEqual({
        kind: "pending",
        status: "unknown",
      });
    });
  });

  describe("retryable", () => {
    it("treats 5xx as retryable by default", () => {
      expect(
        classifyStatusResponse(false, 502, { error: "bad gateway" })
      ).toEqual({ kind: "retryable", message: "bad gateway" });
    });

    it("keeps retryable when body.retryable is explicitly true regardless of http status", () => {
      expect(
        classifyStatusResponse(false, 400, { message: "transient", retryable: true })
      ).toEqual({ kind: "retryable", message: "transient" });
    });

    it("prefers body.message over body.error for the failure message", () => {
      expect(
        classifyStatusResponse(false, 500, { message: "m", error: "e" })
      ).toEqual({ kind: "retryable", message: "m" });
    });
  });

  describe("terminal", () => {
    it("treats 4xx as terminal when retryable is not set", () => {
      expect(classifyStatusResponse(false, 404, {})).toEqual({
        kind: "terminal",
        message: "Inpainting status check failed (HTTP 404).",
      });
    });

    it("forces terminal when body.retryable is explicitly false even on 5xx", () => {
      expect(
        classifyStatusResponse(false, 503, { error: "down", retryable: false })
      ).toEqual({ kind: "terminal", message: "down" });
    });
  });

  describe("terminal ERROR status (issue #686)", () => {
    it("treats an ok ERROR response as terminal", () => {
      expect(
        classifyStatusResponse(true, 200, {
          status: "ERROR",
          message: "The image editing process encountered an error. Please try again.",
          retryable: false,
        })
      ).toEqual({
        kind: "terminal",
        message: "The image editing process encountered an error. Please try again.",
      });
    });

    it("treats a non-ok ERROR response as terminal even without retryable: false", () => {
      expect(
        classifyStatusResponse(false, 500, { status: "ERROR", error: "boom" })
      ).toEqual({ kind: "terminal", message: "boom" });
    });

    it("falls back to a generic message when ERROR carries none", () => {
      expect(classifyStatusResponse(true, 200, { status: "ERROR" })).toEqual({
        kind: "terminal",
        message: "The image editing process encountered an error. Please try again.",
      });
    });

    it("stops polling immediately on a terminal ERROR response", async () => {
      const fetchStatus = vi.fn().mockResolvedValue({
        ok: false,
        httpStatus: 500,
        body: {
          status: "ERROR",
          error: "Inpainting failed",
          message: "The image editing process encountered an error. Please try again.",
          retryable: false,
        },
      });

      await expect(
        pollInpaintStatus(fetchStatus as unknown as FetchInpaintStatus, "req-1", {
          sleep: vi.fn(),
        })
      ).rejects.toMatchObject({
        name: "InpaintPollError",
        reason: "terminal",
        message: "The image editing process encountered an error. Please try again.",
      });

      expect(fetchStatus).toHaveBeenCalledTimes(1);
    });
  });
});

describe("pollInpaintStatus completion result", () => {
  it("resolves with the imageUrl and persisted:true for a durable completion", async () => {
    const fetchStatus = vi.fn().mockResolvedValue({
      ok: true,
      httpStatus: 200,
      body: {
        status: "completed",
        imageUrl: "https://example.supabase.co/storage/v1/object/public/out.png",
        persisted: true,
      },
    });

    await expect(
      pollInpaintStatus(fetchStatus as unknown as FetchInpaintStatus, "req-1", {
        sleep: vi.fn(),
      })
    ).resolves.toEqual({
      imageUrl: "https://example.supabase.co/storage/v1/object/public/out.png",
      persisted: true,
    });
  });

  it("resolves with persisted:false for a non-durable completion (issue #687)", async () => {
    const fetchStatus = vi.fn().mockResolvedValue({
      ok: true,
      httpStatus: 200,
      body: {
        status: "completed",
        imageUrl: "https://fal.media/flux/tmp/expiring.png",
        persisted: false,
      },
    });

    await expect(
      pollInpaintStatus(fetchStatus as unknown as FetchInpaintStatus, "req-1", {
        sleep: vi.fn(),
      })
    ).resolves.toEqual({
      imageUrl: "https://fal.media/flux/tmp/expiring.png",
      persisted: false,
    });
  });
});
