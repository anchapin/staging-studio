"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { X, RefreshCw } from "lucide-react";
import { applyDismissErrorOnSuccess } from "@/lib/toast-stale-error-dismiss";

// Slide-in duration must match the dismiss wait below (see handleDismiss
// and the auto-dismiss setTimeout) — the keyframe animation runs once on
// mount and the dismiss path schedules onDismiss after the same duration.
const TOAST_SLIDE_DURATION_MS = 300;
// Non-error toasts auto-dismiss at 4s; errors persist until manually dismissed
const TOAST_AUTO_DISMISS_DEFAULT_MS = 4000;

export interface Toast {
  id: string;
  type: "success" | "error" | "info";
  message: string;
  retryable?: boolean;
  onRetry?: () => void;
  retryLabel?: string;
  /** The selector of the element that triggered this toast, for focus return */
  triggerSelector?: string;
}

interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: string) => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  // Initialize to true so the slide-in CSS animation (`data-state=open` +
  // `animate-in slide-in-from-right-full`) starts at the visible end state.
  // Issue #1288: avoid setState-in-effect by removing the previous
  // `useEffect` that flipped this on mount — the keyframe animation
  // drives the entrance without a React render cycle.
  const [isVisible, setIsVisible] = useState(true);
  const dismissButtonRef = useRef<HTMLButtonElement>(null);

  /** Restore focus to the trigger element that opened the toast */
  const returnFocusToTrigger = useCallback(() => {
    if (toast.triggerSelector) {
      const triggerEl = document.querySelector<HTMLElement>(toast.triggerSelector);
      triggerEl?.focus();
    }
  }, [toast.triggerSelector]);

  useEffect(() => {
    // Auto-dismiss timer for non-error toasts; errors persist until manually
    // dismissed. Issue #1288: removed the `setIsVisible(true)` mount call —
    // the initial state already starts visible, and the slide-in plays via
    // CSS keyframes (`animate-in slide-in-from-right-full`).
    if (toast.type === "error") return;
    const timer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(() => {
        onDismiss(toast.id);
        returnFocusToTrigger();
      }, TOAST_SLIDE_DURATION_MS);
    }, TOAST_AUTO_DISMISS_DEFAULT_MS);
    return () => clearTimeout(timer);
  }, [toast.id, toast.type, onDismiss, returnFocusToTrigger]);

  const handleDismiss = () => {
    setIsVisible(false);
    setTimeout(() => {
      onDismiss(toast.id);
      returnFocusToTrigger();
    }, TOAST_SLIDE_DURATION_MS);
  };

  const colorMap = {
    success: {
      bg: "bg-success/10 border-success/20",
      text: "text-success",
      icon: "text-success",
    },
    error: {
      bg: "bg-destructive/10 border-destructive/20",
      text: "text-destructive",
      icon: "text-destructive",
    },
    info: {
      bg: "bg-info/10 border-info/20",
      text: "text-info",
      icon: "text-info",
    },
  }[toast.type];

  return (
    <div
      role={toast.type === "error" ? "alert" : "status"}
      aria-live={toast.type === "error" ? "assertive" : "polite"}
      data-state={isVisible ? "open" : "closed"}
      className={`
        flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg
        ${colorMap.bg} ${colorMap.text}
        duration-300 ease-out
        data-[state=open]:animate-in data-[state=open]:slide-in-from-right-full
        data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right-full
      `}
    >
      {toast.type === "success" && (
        <svg className={`w-5 h-5 ${colorMap.icon}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      )}
      {toast.type === "error" && (
        <svg className={`w-5 h-5 ${colorMap.icon}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      )}
      {toast.type === "info" && (
        <svg className={`w-5 h-5 ${colorMap.icon}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )}

      <p className="flex-1 text-sm font-medium">{toast.message}</p>

      {toast.retryable && toast.onRetry && (
        <button
          onClick={() => {
            toast.onRetry?.();
            onDismiss(toast.id);
          }}
          aria-label={toast.retryLabel ?? "Retry"}
          className={`
            flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium
            bg-white border border-gray-200 shadow-sm
            hover:bg-gray-50 transition-colors
            ${colorMap.icon}
          `}
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Retry
        </button>
      )}

      <button
        ref={dismissButtonRef}
        onClick={handleDismiss}
        aria-label="Dismiss notification"
        className="p-1 rounded hover:bg-black/5 transition-colors"
      >
        <X className="w-4 h-4 opacity-60" />
      </button>
    </div>
  );
}

interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  // Cap at 3 most recent toasts, newest on top (issue #396: stale error toasts
  // stacking over new success toasts)
  const visibleToasts = toasts.slice(-3).reverse();
  return (
    <div className="fixed top-20 right-4 z-50 max-w-sm w-full px-4">
      <div className="max-h-[50vh] overflow-y-auto flex flex-col gap-2">
        {visibleToasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
        ))}
      </div>
    </div>
  );
}

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = (toast: Omit<Toast, "id">) => {
    const id = Math.random().toString(36).substring(2, 9);
    const next = { ...toast, id };
    // Issue #1053: a later success dismisses any lingering error toasts from
    // the same flow so the stack can't visually contradict the outcome.
    setToasts((prev) => applyDismissErrorOnSuccess(prev, next));
    return id;
  };

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const showError = (
    message: string,
    retryable = false,
    onRetry?: () => void,
    retryLabel?: string,
    triggerSelector?: string
  ) => {
    return addToast({ type: "error", message, retryable, onRetry, retryLabel, triggerSelector });
  };

  const showSuccess = (message: string, triggerSelector?: string) => {
    return addToast({ type: "success", message, triggerSelector });
  };

  const showInfo = (message: string, triggerSelector?: string) => {
    return addToast({ type: "info", message, triggerSelector });
  };

  return {
    toasts,
    addToast,
    dismissToast,
    showError,
    showSuccess,
    showInfo,
  };
}
