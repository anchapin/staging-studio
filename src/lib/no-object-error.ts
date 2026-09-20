import { NoObjectGeneratedError } from "ai";

/**
 * JSON-safe log fields extracted from an AI SDK `NoObjectGeneratedError`
 * (the model produced output that could not be parsed into the requested
 * schema). `cause` is the wrapped provider error, `finishReason`/`text`
 * describe what the model actually returned, `usage` records the tokens
 * billed for the failed attempt.
 */
export interface NoObjectGeneratedErrorFields {
  name: string;
  message: string;
  cause?: string;
  text?: string;
  finishReason?: string;
  usage?: Record<string, number>;
}

const USAGE_NUMERIC_KEYS = [
  "inputTokens",
  "outputTokens",
  "totalTokens",
  "reasoningTokens",
  "cachedInputTokens",
] as const;

function serializeCause(cause: unknown): string {
  if (cause instanceof Error) {
    return `${cause.name}: ${cause.message}`;
  }
  if (typeof cause === "string") {
    return cause;
  }
  try {
    return JSON.stringify(cause) ?? String(cause);
  } catch {
    return String(cause);
  }
}

function sanitizeUsage(usage: unknown): Record<string, number> {
  const numeric: Record<string, number> = {};
  if (typeof usage !== "object" || usage === null) return numeric;
  const record = usage as Record<string, unknown>;
  for (const key of USAGE_NUMERIC_KEYS) {
    const value = record[key];
    if (typeof value === "number") {
      numeric[key] = value;
    }
  }
  return numeric;
}

/**
 * Pure decision helper: if `error` is an AI SDK `NoObjectGeneratedError`,
 * returns JSON-safe fields (`cause`, `text`, `finishReason`, `usage`) for
 * structured logging; returns `null` for any other error so callers can
 * fall through to their existing handling untouched.
 */
export function describeNoObjectGeneratedError(
  error: unknown
): NoObjectGeneratedErrorFields | null {
  if (!NoObjectGeneratedError.isInstance(error)) return null;

  const fields: NoObjectGeneratedErrorFields = {
    name: error.name,
    message: error.message,
  };
  if (error.cause !== undefined) {
    fields.cause = serializeCause(error.cause);
  }
  if (error.text !== undefined) {
    fields.text = error.text;
  }
  if (error.finishReason !== undefined) {
    fields.finishReason = error.finishReason;
  }
  const usage = sanitizeUsage(error.usage);
  if (Object.keys(usage).length > 0) {
    fields.usage = usage;
  }
  return fields;
}
