"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  classifyStatusResponse,
  InpaintPollError,
  type FetchInpaintStatus,
  type InpaintStatusResponse,
  type StatusOutcome,
} from "@/lib/inpaint-polling";
import {
  createBackoff,
  nextDelay,
  type BackoffOptions,
  type BackoffState,
} from "@/lib/inpaint-backoff";
import { resolveInpaintRetry } from "@/lib/inpaint-retry";

const POLL_OPTIONS = {
  intervalMs: 1000,
  maxIntervalMs: 30_000,
  maxAttempts: 30,
  maxWaitMs: 5 * 60_000,
};

const _backoffStates = new Map<string, BackoffState>();

function _getBackoff(requestId: string): BackoffState {
  if (!_backoffStates.has(requestId)) {
    _backoffStates.set(requestId, createBackoff(POLL_OPTIONS));
  }
  return _backoffStates.get(requestId)!;
}

const _pollBackoffOptions: BackoffOptions = {
  intervalMs: POLL_OPTIONS.intervalMs,
  maxIntervalMs: POLL_OPTIONS.maxIntervalMs,
};

async function _pollWithBackoff(
  fetchStatus: FetchInpaintStatus,
  requestId: string,
  signal?: AbortSignal,
  onProgress?: (status: string) => void,
): Promise<{ imageUrl: string; persisted: boolean }> {
  for (let i = 0; i < POLL_OPTIONS.maxAttempts; i++) {
    if (signal?.aborted) {
      throw new InpaintPollError("aborted", "Polling was aborted.");
    }

    let outcome: StatusOutcome;
    try {
      const response = await fetchStatus(requestId, signal);
      outcome = classifyStatusResponse(response.ok, response.httpStatus, response.body);
    } catch (error) {
      if (signal?.aborted) return { imageUrl: "", persisted: false };
      if (error instanceof InpaintPollError) throw error;
      const action = resolveInpaintRetry(error, requestId);
      if (action.kind === "resubmit") throw error;
      // "resume" — poll-phase error; re-poll the same requestId
      continue;
    }

    if (outcome.kind === "completed") {
      return { imageUrl: outcome.imageUrl, persisted: outcome.persisted };
    }
    if (outcome.kind === "terminal") {
      throw new InpaintPollError("terminal", outcome.message);
    }

    onProgress?.(outcome.kind === "retryable" ? outcome.message : outcome.status);
    const state = _getBackoff(requestId);
    const delayMs = nextDelay(state, _pollBackoffOptions);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new InpaintPollError("max-attempts", "Polling timed out.");
}

const MIN_PROCESSING_MS = 600;

const fetchInpaintStatus: FetchInpaintStatus = async (requestId, signal) => {
  const response = await fetch(`/api/inpaint/${encodeURIComponent(requestId)}/status`, {
    signal,
  });
  let body: InpaintStatusResponse;
  try {
    body = (await response.json()) as InpaintStatusResponse;
  } catch {
    body = {};
  }
  return { ok: response.ok, httpStatus: response.status, body };
};

export type StartInpaint = (signal: AbortSignal) => Promise<string>;

export interface UseInpaintStatusCallbacks {
  /**
   * Fired when a run completes. `persisted` is `false` when the image URL
   * is an expiring fal CDN URL that was not saved to durable storage
   * (issue #687) — consumers must warn and skip persisting it.
   */
  onCompleted?: (resultImageUrl: string, persisted: boolean) => void;
  showSuccess: (message: string) => void;
  showError: (
    message: string,
    retryable?: boolean,
    onRetry?: () => void,
    retryLabel?: string
  ) => void;
}

export interface UseInpaintStatusResult {
  isProcessing: boolean;
  statusText: string;
  start: (submit: StartInpaint) => Promise<void>;
  retryPoll: () => void;
}

export function useInpaintStatus(
  callbacks: UseInpaintStatusCallbacks
): UseInpaintStatusResult {
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusText, setStatusText] = useState("");
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;
  const controllerRef = useRef<AbortController | null>(null);
  const lastSubmitRef = useRef<StartInpaint | null>(null);
  // Issue #698: requestId captured once the submit phase succeeded —
  // marks the run as "past the paid POST" so a later poll-phase failure
  // can resume polling instead of resubmitting.
  const lastRequestIdRef = useRef<string | null>(null);
  const runRef = useRef<((submit: StartInpaint) => Promise<void>) | undefined>(undefined);
  const processingStartRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, []);

  const run = useCallback(async (submit: StartInpaint): Promise<void> => {
    lastSubmitRef.current = submit;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const { signal } = controller;

    setIsProcessing(true);
    setStatusText("Starting inpainting...");
    processingStartRef.current = Date.now();

    try {
      const requestId = await submit(signal);
      if (signal.aborted) return;
      lastRequestIdRef.current = requestId;
      setStatusText("Processing image...");

      const result = await _pollWithBackoff(
        fetchInpaintStatus,
        requestId,
        signal,
        (status) => setStatusText(`Processing: ${status}`),
      );
      if (signal.aborted) return;

      const elapsed = Date.now() - (processingStartRef.current ?? 0);
      const remaining = MIN_PROCESSING_MS - elapsed;
      if (remaining > 0) {
        await new Promise((resolve) => setTimeout(resolve, remaining));
      }
      if (signal.aborted) return;

      // Issue #687: a non-durable completion (expiring fal URL) is not a
      // success — suppress the generic success toast so the completion
      // warning is the only signal the user sees.
      if (result.persisted) {
        callbacksRef.current.showSuccess("Inpainting completed successfully!");
      }
      callbacksRef.current.onCompleted?.(result.imageUrl, result.persisted);
      setIsProcessing(false);
      setStatusText("");
    } catch (error) {
      if (signal.aborted) return;
      setIsProcessing(false);
      setStatusText("");
      const message = error instanceof Error ? error.message : "Inpainting failed";
      // Issue #698: classify the failure phase at capture time. A
      // poll-phase failure means the submit already produced a requestId
      // — a billed fal job exists and may still be running — so Retry
      // re-polls that existing requestId (the editor's resume-by-requestId
      // pattern) instead of submitting a second paid job. Only
      // submit-phase failures re-run the POST closure.
      const retryAction = resolveInpaintRetry(error, lastRequestIdRef.current);
      callbacksRef.current.showError(
        message,
        true,
        () => {
          if (retryAction.kind === "resume") {
            void runRef.current?.(async () => retryAction.requestId);
            return;
          }
          const retrySubmit = lastSubmitRef.current;
          if (retrySubmit) {
            void runRef.current?.(retrySubmit);
          }
        },
        "Retry inpainting"
      );
    }
  }, []);
  runRef.current = run;

  const retryPoll = useCallback(() => {
    const id = lastRequestIdRef.current;
    if (!id) return;
    void runRef.current?.(async () => id);
  }, []);

  return { isProcessing, statusText, start: run, retryPoll };
}
