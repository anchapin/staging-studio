import { describe, expect, it } from "vitest";
import {
  FURNISHINGS_ERROR_COPY,
  INVALID_FURNISHINGS_REQUEST_MESSAGE,
} from "@/app/api/segment/furnishings/route";
import { INPAINT_ERROR_COPY } from "@/lib/inpaint-submit";

describe("user-facing error copy (issue #1052)", () => {
  it("uses plain-language copy for the furnishings service-unreachable case", () => {
    expect(FURNISHINGS_ERROR_COPY.auth.message).toBe(
      "We couldn't reach the staging service — please try again in a moment."
    );
  });

  it("uses plain-language copy for the furnishings invalid-request validation", () => {
    expect(INVALID_FURNISHINGS_REQUEST_MESSAGE).toBe(
      "We couldn't read the room details — try reloading the room."
    );
  });

  it("uses plain-language copy for the inpaint service-unreachable case", () => {
    expect(INPAINT_ERROR_COPY.auth.message).toBe(
      "We couldn't reach the staging service — please try again in a moment."
    );
  });

  it("does not leak programmer-speak into any rewritten message", () => {
    const messages = [
      FURNISHINGS_ERROR_COPY.auth.message,
      INVALID_FURNISHINGS_REQUEST_MESSAGE,
      INPAINT_ERROR_COPY.auth.message,
    ];
    for (const message of messages) {
      expect(message).not.toMatch(/Unable to connect/);
      expect(message).not.toMatch(/Please check your configuration/);
      expect(message).not.toMatch(/Please provide a valid/);
    }
  });
});
