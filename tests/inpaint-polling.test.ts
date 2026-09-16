import { describe, expect, it } from "vitest";

import {
  classifyStatusResponse,
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
      });
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
});
