/**
 * Centralised error tracking module.
 *
 * Responsibilities:
 * 1. Capture errors with rich context (userId, requestId, session, metadata)
 * 2. Classify errors by type so operators can filter/dashoard by category
 * 3. Record structured metadata for post-mortem debugging
 * 4. Provide a safe wrapper for server actions that always emits a log line
 *    even when an error escapes
 *
 * Error type taxonomy (mutually exclusive):
 *   validation  - Zod / input validation failures
 *   auth        - session, JWT, token, permission errors
 *   database    - Prisma DB errors (constraint, connection, query)
 *   external_api - AI providers (OpenAI), fal.ai, Browserless
 *   business    - logic errors: already-signed, setup-required, etc.
 *   system      - unhandled exceptions, uncaught promises
 *   unknown     - anything that doesn't match above
 *
 * DO NOT add external services here (Sentry, Datadog, etc.) — this module
 * only emits structured JSON logs. External integrations can be layered on top.
 */

import { componentLogger } from "@/lib/logger";

const log = componentLogger("error-tracking");

// ─── Context bundle ──────────────────────────────────────────────────────────

/** Fields that are optionally available at the point an error is captured. */
export interface ErrorContext {
  userId?: string | null;
  requestId?: string;
  sessionId?: string;
  roomId?: string;
  projectId?: string;
  action?: string;
  metadata?: Record<string, unknown>;
}

// ─── Error classification ─────────────────────────────────────────────────────

export type ErrorCategory =
  | "validation"
  | "auth"
  | "database"
  | "external_api"
  | "business"
  | "system"
  | "unknown";

/**
 * Maps an error type string (from error-classify.ts) to an ErrorCategory.
 * Used by trackError() to produce the `category` field on the log line.
 */
export function classifyCategory(errorType: string): ErrorCategory {
  switch (errorType) {
    case "validation":
    case "invalid-request":
    case "missing-required-fields":
    case "invalid-project":
    case "invalid-concept":
    case "invalid-signature":
      return "validation";

    case "unauthorized":
    case "invalid-token":
    case "invalid-preview-token":
    case "setup-required":
      return "auth";

    case "database":
    case "prisma-error":
    case "connection-error":
      return "database";

    case "external-service-error":
    case "copy-generation-failed":
    case "inpaint-submit-failed":
    case "inpaint-fetch-failed":
    case "inpaint-status-failed":
    case "inpaint-terminal-error":
    case "segmentation-failed":
    case "detection-failed":
    case "pdf-generation-failed":
    case "pdf-authentication-failed":
    case "export-failed":
      return "external_api";

    case "already-signed":
    case "save-failed":
    case "business-logic":
      return "business";

    case "system":
    case "unhandled":
    case "unhandled-rejection":
      return "system";

    default:
      return "unknown";
  }
}

// ─── Structured error record ─────────────────────────────────────────────────

export interface TrackedError {
  /** Human-readable message */
  message: string;
  /** Machine-readable error type (mirrors api-errors codes + extended types) */
  errorType: string;
  /** High-level category for dashboard filtering */
  category: ErrorCategory;
  /** HTTP status code when the error originated in an API route */
  statusCode?: number;
  /** Structured metadata specific to this error instance */
  metadata: Record<string, unknown>;
  /** Contextual fields captured at the point of capture */
  context: Required<ErrorContext>;
  /** ISO timestamp */
  timestamp: string;
}

/**
 * Core capture function — always emits a structured log line.
 * Safe to call in finally blocks or catch clauses.
 */
export function trackError(
  err: unknown,
  context: ErrorContext = {},
  errorType: string = "unknown",
  statusCode?: number
): TrackedError {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;

  const enrichedContext: Required<ErrorContext> = {
    userId: context.userId ?? null,
    requestId: context.requestId ?? null,
    sessionId: context.sessionId ?? null,
    roomId: context.roomId ?? null,
    projectId: context.projectId ?? null,
    action: context.action ?? null,
    metadata: context.metadata ?? {},
  };

  const category = classifyCategory(errorType);

  const record: TrackedError & {
    stack?: string;
    errMessage?: string;
    errName?: string;
  } = {
    message,
    errorType,
    category,
    statusCode,
    metadata: enrichedContext.metadata,
    context: enrichedContext,
    timestamp: new Date().toISOString(),
    // Include raw error info for post-mortem (not emitted to client)
    ...(stack && { stack }),
    ...(err instanceof Error && { errName: err.name }),
  };

  // Always log — operators need to see every error regardless of level
  if (category === "system" || category === "unknown") {
    log.error(record, ` [${category.toUpperCase()}] ${message}`);
  } else if (category === "external_api") {
    log.warn(record, ` [${category.toUpperCase()}] ${message}`);
  } else {
    log.info(record, ` [${category.toUpperCase()}] ${message}`);
  }

  return record;
}

// ─── Server-action wrapper ────────────────────────────────────────────────────

/**
 * Wraps a server action function so that any thrown error is captured with
 * structured context and re-thrown. Use this instead of bare try/catch when
 * you want guaranteed logging.
 *
 * @example
 *   export async function myAction(payload: Payload) {
 *     return withTrackedAction(
 *       { action: "myAction", userId, projectId },
 *       async () => { /* ... *\/ }
 *     );
 *   }
 */
export async function withTrackedAction<C extends ErrorContext>(
  context: C,
  fn: () => Promise<unknown>
): Promise<unknown> {
  try {
    return await fn();
  } catch (err) {
    trackError(
      err,
      context,
      // Attempt to derive error type from the error itself
      err instanceof Error ? (err as { code?: string }).code ?? "system" : "unknown"
    );
    throw err;
  }
}

/**
 * Wraps a synchronous action function (for 'use server' actions that don't
 * return a Promise). Guarantees a log line is emitted even on fatal errors.
 */
export function withTrackedActionSync<C extends ErrorContext>(
  context: C,
  fn: () => unknown
): unknown {
  try {
    return fn();
  } catch (err) {
    trackError(
      err,
      context,
      err instanceof Error ? (err as { code?: string }).code ?? "system" : "unknown"
    );
    throw err;
  }
}
