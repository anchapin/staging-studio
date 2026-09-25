import { describe, expect, it } from "vitest";

/**
 * Unit tests for Sentry error tracking integration.
 * Verifies that the sentry.client.config.ts exports and utilities
 * work correctly when Sentry is initialized.
 */

describe("sentry.client.config", () => {
  // The sentry.client.config module initializes Sentry on import.
  // We test that the module exports are available and correctly typed.
  describe("exports", () => {
    it("should export captureError utility", async () => {
      const mod = await import("@/../sentry.client.config");
      expect(typeof mod.captureError).toBe("function");
    });

    it("should export setUserContext utility", async () => {
      const mod = await import("@/../sentry.client.config");
      expect(typeof mod.setUserContext).toBe("function");
    });

    it("should export addBreadcrumb utility", async () => {
      const mod = await import("@/../sentry.client.config");
      expect(typeof mod.addBreadcrumb).toBe("function");
    });
  });

  describe("captureError", () => {
    it("should return undefined when Sentry DSN is not configured", async () => {
      // Save original env
      const original = process.env.NEXT_PUBLIC_SENTRY_DSN;
      delete process.env.NEXT_PUBLIC_SENTRY_DSN;

      const { captureError } = await import("@/../sentry.client.config");
      const result = captureError(new Error("test error"));
      expect(result).toBeUndefined();

      // Restore
      if (original !== undefined) {
        process.env.NEXT_PUBLIC_SENTRY_DSN = original;
      }
    });

    it("should accept Error objects", async () => {
      const { captureError } = await import("@/../sentry.client.config");
      expect(() => captureError(new Error("test"))).not.toThrow();
    });

    it("should accept additional context", async () => {
      const { captureError } = await import("@/../sentry.client.config");
      expect(() =>
        captureError(new Error("test"), { roomId: "123", userId: "456" })
      ).not.toThrow();
    });
  });

  describe("setUserContext", () => {
    it("should accept null to clear user context", async () => {
      const { setUserContext } = await import("@/../sentry.client.config");
      expect(() => setUserContext(null)).not.toThrow();
    });

    it("should accept user object with id", async () => {
      const { setUserContext } = await import("@/../sentry.client.config");
      expect(() =>
        setUserContext({ id: "123", email: "test@example.com" })
      ).not.toThrow();
    });
  });

  describe("addBreadcrumb", () => {
    it("should accept message and category", async () => {
      const { addBreadcrumb } = await import("@/../sentry.client.config");
      expect(() => addBreadcrumb("User clicked button", "ui.action")).not.toThrow();
    });

    it("should accept optional data object", async () => {
      const { addBreadcrumb } = await import("@/../sentry.client.config");
      expect(() =>
        addBreadcrumb("API request", "network", { url: "/api/test", status: 200 })
      ).not.toThrow();
    });
  });
});

describe("sentry.server.config", () => {
  describe("exports", () => {
    it("should export captureServerError utility", async () => {
      const mod = await import("@/../sentry.server.config");
      expect(typeof mod.captureServerError).toBe("function");
    });
  });

  describe("captureServerError", () => {
    it("should return undefined when Sentry DSN is not configured", async () => {
      const original = process.env.NEXT_PUBLIC_SENTRY_DSN;
      delete process.env.NEXT_PUBLIC_SENTRY_DSN;

      const { captureServerError } = await import("@/../sentry.server.config");
      const result = captureServerError(new Error("server test error"));
      expect(result).toBeUndefined();

      if (original !== undefined) {
        process.env.NEXT_PUBLIC_SENTRY_DSN = original;
      }
    });

    it("should accept Error objects", async () => {
      const { captureServerError } = await import("@/../sentry.server.config");
      expect(() => captureServerError(new Error("server error"))).not.toThrow();
    });

    it("should accept additional context", async () => {
      const { captureServerError } = await import("@/../sentry.server.config");
      expect(() =>
        captureServerError(new Error("server error"), { route: "/api/test" })
      ).not.toThrow();
    });
  });
});

describe("instrumentation", () => {
  describe("register", () => {
    it("should export register function", async () => {
      const mod = await import("@/../instrumentation");
      expect(typeof mod.register).toBe("function");
    });

    it("should not throw when called", async () => {
      const { register } = await import("@/../instrumentation");
      await expect(register()).resolves.not.toThrow();
    });
  });
});
