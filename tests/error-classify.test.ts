import { describe, expect, it } from "vitest";

import {
  classifyIntegrationError,
  type IntegrationErrorCopyTable,
} from "@/lib/error-classify";

const COPY: IntegrationErrorCopyTable = {
  rateLimit: { error: "Rate limit exceeded", message: "Busy. Try soon." },
  auth: { error: "Configuration error", message: "Config broken." },
  timeout: { error: "Request timeout", message: "Too slow." },
  network: { error: "Network error", message: "Unreachable." },
  notFound: { error: "Request not found", message: "Gone." },
  unknown: { error: "Generation failed", message: "Unexpected." },
};

interface ClassCase {
  name: string;
  thrown: () => unknown;
  expectedStatus: number;
  expectedRetryable: boolean;
  expectedErrorLabel: string;
}

// Table-driven: each class + case variations (casing, errno codes, error
// names, thrown non-Errors) with status AND retryable asserted together so
// the routes cannot drift on either.
const CASES: ClassCase[] = [
  // auth/credentials → 401, non-retryable
  {
    name: "auth: credentials",
    thrown: () => new Error("Invalid credentials provided"),
    expectedStatus: 401,
    expectedRetryable: false,
    expectedErrorLabel: "Configuration error",
  },
  {
    name: "auth: authentication (case variation)",
    thrown: () => new Error("authentication failed upstream"),
    expectedStatus: 401,
    expectedRetryable: false,
    expectedErrorLabel: "Configuration error",
  },
  {
    name: "auth: API Key (mixed case)",
    thrown: () => new Error("Invalid API Key"),
    expectedStatus: 401,
    expectedRetryable: false,
    expectedErrorLabel: "Configuration error",
  },
  {
    name: "auth: api key (lowercase)",
    thrown: () => new Error("missing api key for service"),
    expectedStatus: 401,
    expectedRetryable: false,
    expectedErrorLabel: "Configuration error",
  },
  // timeout → 408, retryable
  {
    name: "timeout: lowercase",
    thrown: () => new Error("request timeout after 30s"),
    expectedStatus: 408,
    expectedRetryable: true,
    expectedErrorLabel: "Request timeout",
  },
  {
    name: "timeout: UPPER CASE",
    thrown: () => new Error("Request TIMEOUT"),
    expectedStatus: 408,
    expectedRetryable: true,
    expectedErrorLabel: "Request timeout",
  },
  {
    name: "timeout: timed out phrase",
    thrown: () => new Error("connection timed out"),
    expectedStatus: 408,
    expectedRetryable: true,
    expectedErrorLabel: "Request timeout",
  },
  {
    name: "timeout: ETIMEDOUT errno",
    thrown: () => new Error("connect ETIMEDOUT 1.2.3.4:443"),
    expectedStatus: 408,
    expectedRetryable: true,
    expectedErrorLabel: "Request timeout",
  },
  {
    name: "timeout: AbortError name (fetch abort)",
    thrown: () => Object.assign(new Error("This operation was aborted"), { name: "AbortError" }),
    expectedStatus: 408,
    expectedRetryable: true,
    expectedErrorLabel: "Request timeout",
  },
  {
    name: "timeout: TimeoutError name",
    thrown: () => Object.assign(new Error("Signals timeout"), { name: "TimeoutError" }),
    expectedStatus: 408,
    expectedRetryable: true,
    expectedErrorLabel: "Request timeout",
  },
  // not-found → 404, non-retryable
  {
    name: "notFound: not found phrase",
    thrown: () => new Error("Request not found"),
    expectedStatus: 404,
    expectedRetryable: false,
    expectedErrorLabel: "Request not found",
  },
  {
    name: "notFound: NOT_FOUND code (case variation)",
    thrown: () => new Error("Upstream replied NOT_FOUND"),
    expectedStatus: 404,
    expectedRetryable: false,
    expectedErrorLabel: "Request not found",
  },
  // network → 503, retryable
  {
    name: "network: fetch failed",
    thrown: () => new Error("fetch failed"),
    expectedStatus: 503,
    expectedRetryable: true,
    expectedErrorLabel: "Network error",
  },
  {
    name: "network: network keyword",
    thrown: () => new Error("Network error while connecting"),
    expectedStatus: 503,
    expectedRetryable: true,
    expectedErrorLabel: "Network error",
  },
  {
    name: "network: ECONNREFUSED errno",
    thrown: () => new Error("connect ECONNREFUSED 127.0.0.1:443"),
    expectedStatus: 503,
    expectedRetryable: true,
    expectedErrorLabel: "Network error",
  },
  {
    name: "network: socket hang up",
    thrown: () => new Error("socket hang up"),
    expectedStatus: 503,
    expectedRetryable: true,
    expectedErrorLabel: "Network error",
  },
  {
    // DNS failure is connectivity, NOT a missing resource — network must
    // be classified before notFound.
    name: "network: ENOTFOUND beats notFound",
    thrown: () => new Error("getaddrinfo ENOTFOUND api.fal.ai"),
    expectedStatus: 503,
    expectedRetryable: true,
    expectedErrorLabel: "Network error",
  },
  // rate limit → 429, retryable (generate-copy parity)
  {
    name: "rateLimit: rate limit",
    thrown: () => new Error("Rate limit exceeded"),
    expectedStatus: 429,
    expectedRetryable: true,
    expectedErrorLabel: "Rate limit exceeded",
  },
  {
    name: "rateLimit: quota",
    thrown: () => new Error("quota exceeded for project"),
    expectedStatus: 429,
    expectedRetryable: true,
    expectedErrorLabel: "Rate limit exceeded",
  },
  // unknown → 500, retryable
  {
    name: "unknown: plain Error",
    thrown: () => new Error("something broke"),
    expectedStatus: 500,
    expectedRetryable: true,
    expectedErrorLabel: "Generation failed",
  },
  {
    name: "unknown: thrown non-Error object",
    thrown: () => ({ code: 42 }),
    expectedStatus: 500,
    expectedRetryable: true,
    expectedErrorLabel: "Generation failed",
  },
  {
    name: "unknown: thrown null",
    thrown: () => null,
    expectedStatus: 500,
    expectedRetryable: true,
    expectedErrorLabel: "Generation failed",
  },
  {
    name: "unknown: thrown string",
    thrown: () => "weird failure",
    expectedStatus: 500,
    expectedRetryable: true,
    expectedErrorLabel: "Generation failed",
  },
];

describe("classifyIntegrationError", () => {
  it.each(CASES)(
    "$name → $expectedStatus (retryable: $expectedRetryable)",
    ({ thrown, expectedStatus, expectedRetryable, expectedErrorLabel }) => {
      const classified = classifyIntegrationError(thrown(), COPY);
      expect(classified.status).toBe(expectedStatus);
      expect(classified.retryable).toBe(expectedRetryable);
      expect(classified.error).toBe(expectedErrorLabel);
    }
  );

  it("rateLimit wins over auth when both match", () => {
    const classified = classifyIntegrationError(
      new Error("rate limit exceeded for API key"),
      COPY
    );
    expect(classified.status).toBe(429);
    expect(classified.retryable).toBe(true);
  });

  it("auth wins over timeout when both match", () => {
    const classified = classifyIntegrationError(
      new Error("authentication timeout"),
      COPY
    );
    expect(classified.status).toBe(401);
    expect(classified.retryable).toBe(false);
  });

  it("class without table entry inherits unknown copy but keeps class status/retryable", () => {
    const classified = classifyIntegrationError(new Error("fetch failed"), {
      unknown: COPY.unknown,
    });
    expect(classified.status).toBe(503);
    expect(classified.retryable).toBe(true);
    expect(classified.error).toBe(COPY.unknown.error);
    expect(classified.message).toBe(COPY.unknown.message);
  });

  it("returns the handler-supplied copy for a matched class", () => {
    const classified = classifyIntegrationError(new Error("timed out"), {
      unknown: COPY.unknown,
      timeout: { error: "PDF export timed out", message: "Try again shortly." },
    });
    expect(classified.status).toBe(408);
    expect(classified.retryable).toBe(true);
    expect(classified.error).toBe("PDF export timed out");
    expect(classified.message).toBe("Try again shortly.");
  });
});
