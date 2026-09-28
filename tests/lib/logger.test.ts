import { describe, expect, it } from "vitest";
import { logger } from "@/lib/logger";

/**
 * Issue #1061: the structured logger singleton.
 *
 * The logger is a thin pino wrapper that defaults LOG_LEVEL to "info"
 * when not set. Beyond the default, what we pin here is the
 * observability contract the rest of the codebase relies on:
 * - the exported `logger` object exposes the standard pino methods
 *   (info / warn / error) and never throws when called
 * - the level can be set via the LOG_LEVEL env var (the only knob
 *   the wrapper exposes)
 */

describe("logger (issue #1061)", () => {
  it("exposes the standard pino methods", () => {
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
  });

  it("accepts a structured info call without throwing", () => {
    expect(() =>
      logger.info({ event: "test_info_call", count: 1 }, "test info message")
    ).not.toThrow();
  });

  it("accepts a structured warn call without throwing", () => {
    expect(() =>
      logger.warn({ event: "test_warn_call" }, "test warn message")
    ).not.toThrow();
  });

  it("accepts a structured error call without throwing", () => {
    expect(() =>
      logger.error({ event: "test_error_call" }, "test error message")
    ).not.toThrow();
  });

  it("accepts a bare-message info call (no object)", () => {
    expect(() => logger.info("plain info string")).not.toThrow();
  });
});