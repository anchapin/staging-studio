"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  pollInpaintStatus,
  type FetchInpaintStatus,
  type InpaintStatusResponse,
} from "@/lib/inpaint-polling";

const POLL_OPTIONS = {
  intervalMs: 1000,
  maxIntervalMs: 5000,
  maxAttempts: 30,
  maxWaitMs: 5 * 60_000,
};

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
  onCompleted?: (resultImageUrl: string) => void;
  showSuccess: (message: string) => void;
  showError: (message: string, retryable?: boolean, onRetry?: () => void) => void;
}

export interface UseInpaintStatusResult {
  isProcessing: boolean;
  statusText: string;
  start: (submit: StartInpaint) => Promise<void>;
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
  const runRef = useRef<((submit: StartInpaint) => Promise<void>) | undefined>(undefined);

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

    try {
      const requestId = await submit(signal);
      if (signal.aborted) return;
      setStatusText("Processing image...");

      const resultImageUrl = await pollInpaintStatus(fetchInpaintStatus, requestId, {
        ...POLL_OPTIONS,
        signal,
        onProgress: (status) => setStatusText(`Processing: ${status}`),
      });
      if (signal.aborted) return;

      callbacksRef.current.showSuccess("Inpainting completed successfully!");
      callbacksRef.current.onCompleted?.(resultImageUrl);
      setIsProcessing(false);
      setStatusText("");
    } catch (error) {
      if (signal.aborted) return;
      setIsProcessing(false);
      setStatusText("");
      const message = error instanceof Error ? error.message : "Inpainting failed";
      callbacksRef.current.showError(message, true, () => {
        const retrySubmit = lastSubmitRef.current;
        if (retrySubmit) {
          void runRef.current?.(retrySubmit);
        }
      });
    }
  }, []);
  runRef.current = run;

  return { isProcessing, statusText, start: run };
}
