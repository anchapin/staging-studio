export type IntegrationErrorClass =
  | "rateLimit"
  | "auth"
  | "timeout"
  | "network"
  | "notFound"
  | "unknown";

export interface IntegrationErrorCopy {
  /** Short machine-readable label, e.g. "Configuration error". */
  error: string;
  /** User-facing sentence explaining the failure. */
  message: string;
  /** Optional machine-readable error code for programmatic handling. */
  code?: string;
}

/**
 * Per-handler response copy keyed by error class. `unknown` is required as
 * the fallback: a class that has no entry in the table inherits the
 * `unknown` copy while keeping its own status/retryable, so a handler can
 * opt in to only the classes it expects without breaking on the rest.
 */
export type IntegrationErrorCopyTable = {
  [C in Exclude<IntegrationErrorClass, "unknown">]?: IntegrationErrorCopy;
} & { unknown: IntegrationErrorCopy };

export interface ClassifiedIntegrationError {
  status: number;
  retryable: boolean;
  error: string;
  message: string;
  code: string;
}

interface ClassRule {
  errorClass: IntegrationErrorClass;
  patterns: string[];
  status: number;
  retryable: boolean;
}

// Order matters — first match wins:
// - rateLimit precedes auth so e.g. "rate limit exceeded for API key"
//   reports the transient condition, not a config failure.
// - network precedes notFound so DNS codes like ENOTFOUND are classified
//   as connectivity failures, not missing resources.
// Patterns are matched case-insensitively against the lowercased message.
const CLASS_RULES: ClassRule[] = [
  {
    errorClass: "rateLimit",
    patterns: ["rate", "limit", "quota"],
    status: 429,
    retryable: true,
  },
  {
    errorClass: "auth",
    patterns: ["credentials", "auth", "api key"],
    status: 401,
    retryable: false,
  },
  {
    errorClass: "timeout",
    patterns: ["timeout", "timed out", "etimedout"],
    status: 408,
    retryable: true,
  },
  {
    errorClass: "network",
    patterns: [
      "network",
      "fetch",
      "econnrefused",
      "econnreset",
      "econnaborted",
      "enotfound",
      "socket",
    ],
    status: 503,
    retryable: true,
  },
  {
    errorClass: "notFound",
    patterns: ["not found", "not_found"],
    status: 404,
    retryable: false,
  },
];

const UNKNOWN_RULE: ClassRule = {
  errorClass: "unknown",
  patterns: [],
  status: 500,
  retryable: true,
};

const TIMEOUT_ERROR_NAMES = new Set(["AbortError", "TimeoutError"]);

function extractErrorText(error: unknown): { message: string; name: string } {
  if (error instanceof Error) {
    return { message: error.message, name: error.name };
  }
  if (typeof error === "string") {
    return { message: error, name: "" };
  }
  return { message: "", name: "" };
}

/**
 * Classify a thrown error from a third-party integration into a single
 * HTTP-facing shape: { status, retryable, error, message }.
 *
 * Status/retryable come from the unified class table so the integration
 * routes cannot drift; the route supplies only its user-facing copy.
 */
export function classifyIntegrationError(
  error: unknown,
  context: IntegrationErrorCopyTable
): ClassifiedIntegrationError {
  const { message, name } = extractErrorText(error);
  const haystack = message.toLowerCase();

  let rule: ClassRule;
  if (TIMEOUT_ERROR_NAMES.has(name)) {
    rule = CLASS_RULES.find((r) => r.errorClass === "timeout") ?? UNKNOWN_RULE;
  } else {
    rule =
      CLASS_RULES.find((r) => r.patterns.some((p) => haystack.includes(p))) ??
      UNKNOWN_RULE;
  }

  const copy = context[rule.errorClass] ?? context.unknown;

  return {
    status: rule.status,
    retryable: rule.retryable,
    error: copy.error,
    message: copy.message,
    code: copy.code ?? "integration-error",
  };
}
