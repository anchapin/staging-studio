export interface InpaintStatusResponse {
  status?: string;
  imageUrl?: string;
  error?: string;
  message?: string;
  retryable?: boolean;
}

export interface InpaintStatusHttpResponse {
  ok: boolean;
  httpStatus: number;
  body: InpaintStatusResponse;
}

export type FetchInpaintStatus = (
  requestId: string,
  signal?: AbortSignal
) => Promise<InpaintStatusHttpResponse>;

export type PollFailureReason = "aborted" | "terminal" | "timeout" | "max-attempts";

export class InpaintPollError extends Error {
  readonly reason: PollFailureReason;
  readonly details?: unknown;

  constructor(reason: PollFailureReason, message: string, details?: unknown) {
    super(message);
    this.name = "InpaintPollError";
    this.reason = reason;
    this.details = details;
  }
}

export type StatusOutcome =
  | { kind: "completed"; imageUrl: string }
  | { kind: "pending"; status: string }
  | { kind: "retryable"; message: string }
  | { kind: "terminal"; message: string };

export interface PollOptions {
  intervalMs?: number;
  maxIntervalMs?: number;
  maxAttempts?: number;
  maxWaitMs?: number;
  signal?: AbortSignal;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  onProgress?: (status: string) => void;
}

const DEFAULT_INTERVAL_MS = 1000;
const DEFAULT_MAX_INTERVAL_MS = 5000;
const DEFAULT_MAX_ATTEMPTS = 30;
const DEFAULT_MAX_WAIT_MS = 5 * 60_000;

const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new InpaintPollError("aborted", "Polling was aborted."));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });

function ensureNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new InpaintPollError("aborted", "Polling was aborted.");
  }
}

export function classifyStatusResponse(
  ok: boolean,
  httpStatus: number,
  body: InpaintStatusResponse
): StatusOutcome {
  if (ok && body.status === "completed") {
    if (typeof body.imageUrl === "string" && body.imageUrl.length > 0) {
      return { kind: "completed", imageUrl: body.imageUrl };
    }
    return {
      kind: "retryable",
      message:
        body.message || body.error || "The image was processed but could not be retrieved.",
    };
  }

  if (ok) {
    return { kind: "pending", status: body.status ?? "unknown" };
  }

  const message =
    body.message || body.error || `Inpainting status check failed (HTTP ${httpStatus}).`;

  const explicitlyRetryable = body.retryable === true;
  const retryable =
    explicitlyRetryable || (httpStatus >= 500 && body.retryable !== false);

  return retryable
    ? { kind: "retryable", message }
    : { kind: "terminal", message };
}

export async function pollInpaintStatus(
  fetchStatus: FetchInpaintStatus,
  requestId: string,
  options: PollOptions = {}
): Promise<string> {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const maxIntervalMs = options.maxIntervalMs ?? DEFAULT_MAX_INTERVAL_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const sleep = options.sleep ?? defaultSleep;
  const startedAt = Date.now();
  let delayMs = Math.max(intervalMs, 1);
  let attempts = 0;
  let lastFailureMessage = "";

  for (;;) {
    ensureNotAborted(options.signal);

    if (attempts >= maxAttempts) {
      throw new InpaintPollError(
        "max-attempts",
        lastFailureMessage || `Inpainting did not complete within ${maxAttempts} attempts.`
      );
    }

    if (Date.now() - startedAt >= maxWaitMs) {
      throw new InpaintPollError(
        "timeout",
        lastFailureMessage ||
          `Inpainting did not complete within ${Math.round(maxWaitMs / 1000)} seconds.`
      );
    }

    attempts += 1;

    let response: InpaintStatusHttpResponse;
    try {
      response = await fetchStatus(requestId, options.signal);
    } catch (error) {
      if (options.signal?.aborted) {
        throw new InpaintPollError("aborted", "Polling was aborted.", error);
      }
      lastFailureMessage =
        error instanceof Error && error.message
          ? error.message
          : "Failed to check inpainting status.";
      await sleep(delayMs, options.signal);
      delayMs = Math.min(delayMs * 2, maxIntervalMs);
      continue;
    }

    const outcome = classifyStatusResponse(response.ok, response.httpStatus, response.body);

    switch (outcome.kind) {
      case "completed":
        return outcome.imageUrl;
      case "pending":
        options.onProgress?.(outcome.status);
        break;
      case "terminal":
        throw new InpaintPollError("terminal", outcome.message);
      case "retryable":
        lastFailureMessage = outcome.message;
        break;
    }

    await sleep(delayMs, options.signal);
    delayMs = Math.min(delayMs * 2, maxIntervalMs);
  }
}
