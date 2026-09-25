import { describe, expect, it } from "vitest";

import { resolveLoginErrorMessage } from "@/lib/login-error";

describe("resolveLoginErrorMessage", () => {
  it("returns null when no error param is present (no banner)", () => {
    expect(resolveLoginErrorMessage(null)).toBeNull();
    expect(resolveLoginErrorMessage(undefined)).toBeNull();
    expect(resolveLoginErrorMessage("")).toBeNull();
  });

  it("maps the known auth_callback_failed value to a human-readable message", () => {
    const message = resolveLoginErrorMessage("auth_callback_failed");
    expect(message).toBeTruthy();
    expect(message).toMatch(/sign-in/i);
  });

  it("returns a non-empty fallback for unknown error values", () => {
    const message = resolveLoginErrorMessage("something_unexpected");
    expect(message).toBeTruthy();
    expect(message).toMatch(/try again/i);
    expect(message).not.toBe(resolveLoginErrorMessage("auth_callback_failed"));
  });
});
