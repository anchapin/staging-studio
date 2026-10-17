import fs from "node:fs";
import path from "node:path";
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

    it("should export onRequestError equal to Sentry.captureRequestError (issue #1107)", async () => {
      // Server-side request error API hook — Next 15+ invokes this for
      // unhandled errors on the server, and it must be wired to the
      // Sentry hook so the SDK can ship them to the DSN. The wiring
      // only matters when the SDK actually fires; with no DSN the
      // SDK no-ops, but the binding itself must exist.
      const Sentry = await import("@sentry/nextjs");
      const mod = await import("@/../instrumentation");
      expect(typeof mod.onRequestError).toBe("function");
      expect(mod.onRequestError).toBe(Sentry.captureRequestError);
    });
  });
});

describe("issue #1107 wiring", () => {
  const repoRoot = path.resolve(__dirname, "..");

  it("next.config.ts wraps the user config with withSentryConfig", () => {
    // The Sentry webpack plugin (which discovers
    // sentry.client.config.ts and sentry.server.config.ts) is
    // installed by withSentryConfig; without this wrapping the SDK
    // never runs even though the config files exist on disk.
    const source = fs.readFileSync(
      path.join(repoRoot, "next.config.ts"),
      "utf8",
    );
    expect(source).toMatch(
      /import\s*\{\s*withSentryConfig\s*\}\s*from\s*["']@sentry\/nextjs\/config["']/,
    );
    expect(source).toMatch(/withSentryConfig\(\s*nextConfig\b/);
  });

  it("global-error.tsx only calls Sentry.captureException when DSN is set", () => {
    // The component sits behind a guard; if the guard regresses to
    // "always capture" the SDK init runs against an undefined DSN and
    // throws at module-load. The guard must stay.
    const source = fs.readFileSync(
      path.join(repoRoot, "src/app/global-error.tsx"),
      "utf8",
    );
    expect(source).toMatch(/process\.env\.NEXT_PUBLIC_SENTRY_DSN/);
    expect(source).toMatch(/Sentry\.captureException/);
    // The capture must be inside the if-block, not unconditional.
    const captureIdx = source.indexOf("Sentry.captureException");
    const dsnIdx = source.indexOf("NEXT_PUBLIC_SENTRY_DSN");
    expect(captureIdx).toBeGreaterThan(dsnIdx);
  });

  it(".env.example documents NEXT_PUBLIC_SENTRY_DSN", () => {
    const source = fs.readFileSync(
      path.join(repoRoot, ".env.example"),
      "utf8",
    );
    expect(source).toMatch(/NEXT_PUBLIC_SENTRY_DSN/);
  });

  it("docs/DEPLOYMENT.md documents NEXT_PUBLIC_SENTRY_DSN", () => {
    const source = fs.readFileSync(
      path.join(repoRoot, "docs/DEPLOYMENT.md"),
      "utf8",
    );
    expect(source).toMatch(/NEXT_PUBLIC_SENTRY_DSN/);
  });
});
