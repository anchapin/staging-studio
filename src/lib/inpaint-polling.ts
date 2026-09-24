/** Parsed status payload returned by the inpainting status endpoint. */
export interface InpaintStatusResponse {
  /**
   * Queue status (e.g. `"completed"` while processing, per the API route);
   * `"ERROR"` is the terminal failure marker (issue #686).
   */
  status?: string;
  /** Final staged image URL, present only on successful completion. */
  imageUrl?: string;
  /** Provider/error detail when the request failed. */
  error?: string;
  /** Human-readable message (errors and some pending states). */
  message?: string;
  /** Explicit retry hint; `true` forces retryable, `false` forces terminal. */
  retryable?: boolean;
  /**
   * Whether the completed image was persisted to durable storage
   * (issue #687). `false` means `imageUrl` is an expiring fal CDN URL;
   * absent means durable.
   */
  persisted?: boolean;
}

/** Transport-level result of one status fetch: HTTP outcome plus parsed body. */
export interface InpaintStatusHttpResponse {
  /** Whether the HTTP call returned a 2xx status. */
  ok: boolean;
  /** Numeric HTTP status code of the response. */
  httpStatus: number;
  /** JSON body (best-effort parse) of the status response. */
  body: InpaintStatusResponse;
}

/**
 * Injectable fetcher for one status check — the seam that makes
 * {@link pollInpaintStatus} testable. Implementations call
 * `GET /api/inpaint/[requestId]/status` in production; `signal` must be
 * honored for aborts to propagate.
 */
export type FetchInpaintStatus = (
  requestId: string,
  signal?: AbortSignal
) => Promise<InpaintStatusHttpResponse>;

/** Why a poll ended without a result image. */
export type PollFailureReason = "aborted" | "terminal" | "timeout" | "max-attempts";

/**
 * Error thrown by {@link pollInpaintStatus} when polling cannot produce
 * a result. `reason` classifies the failure (`aborted`, `terminal`,
 * `timeout`, `max-attempts`) and `details` carries the underlying error
 * when one exists.
 */
export class InpaintPollError extends Error {
  /** Machine-readable failure classification. */
  readonly reason: PollFailureReason;
  /** Optional underlying error/response context for the failure. */
  readonly details?: unknown;

  /**
   * @param reason Failure classification (see {@link PollFailureReason}).
   * @param message Human-readable description of the failure.
   * @param details Optional underlying error or response data.
   */
  constructor(reason: PollFailureReason, message: string, details?: unknown) {
    super(message);
    this.name = "InpaintPollError";
    this.reason = reason;
    this.details = details;
  }
}

/** Classification of one status response ({@link classifyStatusResponse}). */
export type StatusOutcome =
  | { kind: "completed"; imageUrl: string; persisted: boolean }
  | { kind: "pending"; status: string }
  | { kind: "retryable"; message: string }
  | { kind: "terminal"; message: string };

/**
 * Successful result of {@link pollInpaintStatus}: the final image URL plus
 * whether it was persisted to durable storage (issue #687 — an expiring
 * fal URL arrives with `persisted: false`).
 */
export interface InpaintPollResult {
  /** Final staged image URL. */
  imageUrl: string;
  /** Whether the URL is durable storage (`false` = expiring fal CDN URL). */
  persisted: boolean;
}

/**
 * Tuning knobs for {@link pollInpaintStatus}; every field is optional and
 * defaults to the production cadence (1s → 5s exponential backoff, 30
 * attempts, 5-minute wall-clock cap).
 */
export interface PollOptions {
  /** Initial delay between attempts in ms (default 1000). */
  intervalMs?: number;
  /** Backoff ceiling in ms (default 5000). */
  maxIntervalMs?: number;
  /** Hard cap on attempts before `max-attempts` failure (default 30). */
  maxAttempts?: number;
  /** Wall-clock cap in ms before `timeout` failure (default 5 minutes). */
  maxWaitMs?: number;
  /** Abort signal; aborts throw `{ reason: "aborted" }` immediately. */
  signal?: AbortSignal;
  /** Injectable sleep for tests; defaults to a real abortable timeout. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Called with each pending status string as polling progresses. */
  onProgress?: (status: string) => void;
}

const DEFAULT_INTERVAL_MS = 1000;
const DEFAULT_MAX_INTERVAL_MS = 5000;
const DEFAULT_MAX_ATTEMPTS = 60;
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

/**
 * Classifies one status response into a {@link StatusOutcome}.
 *
 * Purpose: pure decision core of the polling loop, so the rules are
 * testable without HTTP. Rules: 2xx + `"completed"` + non-empty
 * `imageUrl` → `completed` (normalizing `persisted` so only an explicit
 * `false` marks the URL as a non-durable fal CDN URL — issue #687);
 * 2xx + `"completed"` without a URL →
 * `retryable`; any response with `status === "ERROR"` → `terminal`
 * (issue #686); other 2xx → `pending`; non-2xx → `retryable` when
 * `body.retryable === true` OR (HTTP ≥ 500 AND `body.retryable !==
 * false`), else `terminal`.
 *
 * Side effects: none — pure function.
 */
export function classifyStatusResponse(
  ok: boolean,
  httpStatus: number,
  body: InpaintStatusResponse
): StatusOutcome {
  if (ok && body.status === "completed") {
    if (typeof body.imageUrl === "string" && body.imageUrl.length > 0) {
      return {
        kind: "completed",
        imageUrl: body.imageUrl,
        persisted: body.persisted !== false,
      };
    }
    return {
      kind: "retryable",
      message:
        body.message || body.error || "The image was processed but could not be retrieved.",
    };
  }

  // fal ERROR mirrors "completed"'s special-casing: the status marker alone
  // is authoritative and terminal (issue #686), regardless of the HTTP
  // status or an absent retryable hint — a dead job must stop the poller.
  if (body.status === "ERROR") {
    return {
      kind: "terminal",
      message:
        body.message ||
        body.error ||
        "The image editing process encountered an error. Please try again.",
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

/**
 * Polls the inpainting status endpoint until completion or failure.
 *
 * Purpose: production loop behind `GET /api/inpaint/[requestId]/status`
 * consumers. Uses exponential backoff from `intervalMs` doubling up to
 * `maxIntervalMs`, bounded by both `maxAttempts` and `maxWaitMs`.
 *
 * Contract: `fetchStatus` is called with `(requestId, options.signal)` on
 * every attempt. Transport errors are retried (backoff continues);
 * `retryable` outcomes are retried; `terminal` outcomes throw
 * immediately. Never resolves to an empty URL — completion always
 * carries a non-empty `imageUrl`.
 *
 * Side effects: invokes the injected fetcher and sleep; fires
 * `options.onProgress` for each pending status. No env vars needed.
 *
 * @param fetchStatus Injectable status fetcher (see
 *   {@link FetchInpaintStatus}).
 * @param requestId The `InpaintRequest.id` being polled.
   * @param options Optional tuning/signals (see {@link PollOptions}).
   * @returns The completed staged image URL plus its durability flag
   *   (issue #687: `persisted: false` marks an expiring fal CDN URL).
   * @throws {@link InpaintPollError} with `reason` `"aborted"`,
   *   `"terminal"`, `"timeout"`, or `"max-attempts"`.
   */
export async function pollInpaintStatus(
  fetchStatus: FetchInpaintStatus,
  requestId: string,
  options: PollOptions = {}
): Promise<InpaintPollResult> {
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
        return { imageUrl: outcome.imageUrl, persisted: outcome.persisted };
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
