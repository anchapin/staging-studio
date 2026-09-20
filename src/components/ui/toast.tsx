"use client";

import { useEffect, useState } from "react";
import { X, RefreshCw } from "lucide-react";

export interface Toast {
  id: string;
  type: "success" | "error" | "info";
  message: string;
  retryable?: boolean;
  onRetry?: () => void;
  retryLabel?: string;
}

interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: string) => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(true);
    // Non-error toasts auto-dismiss at 4s; errors persist until manually dismissed
    const timeout = toast.type === "error" ? 8000 : 4000;
    const timer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(() => onDismiss(toast.id), 300);
    }, timeout);
    return () => clearTimeout(timer);
  }, [toast.id, toast.type, onDismiss]);

  const bgColor = {
    success: "bg-success/10 border-success/20",
    error: "bg-destructive/10 border-destructive/20",
    info: "bg-info/10 border-info/20",
  }[toast.type];

  const textColor = {
    success: "text-success",
    error: "text-destructive",
    info: "text-info",
  }[toast.type];

  const iconColor = {
    success: "text-success",
    error: "text-destructive",
    info: "text-info",
  }[toast.type];

  return (
    <div
      role={toast.type === "error" ? "alert" : "status"}
      aria-live={toast.type === "error" ? "assertive" : "polite"}
      className={`
        flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg
        ${bgColor} ${textColor}
        transition-all duration-300 ease-out
        ${isVisible ? "translate-x-0 opacity-100" : "translate-x-full opacity-0"}
      `}
    >
      {toast.type === "success" && (
        <svg className={`w-5 h-5 ${iconColor}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      )}
      {toast.type === "error" && (
        <svg className={`w-5 h-5 ${iconColor}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      )}
      {toast.type === "info" && (
        <svg className={`w-5 h-5 ${iconColor}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
            ${iconColor}
          `}
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Retry
        </button>
      )}

      <button
        onClick={() => {
          setIsVisible(false);
          setTimeout(() => onDismiss(toast.id), 300);
        }}
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
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 max-w-sm w-full px-4">
      <div className="max-h-[50vh] overflow-y-auto flex flex-col gap-2">
        {toasts.map((toast) => (
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
    setToasts((prev) => [...prev, { ...toast, id }]);
    return id;
  };

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const showError = (
    message: string,
    retryable = false,
    onRetry?: () => void,
    retryLabel?: string
  ) => {
    return addToast({ type: "error", message, retryable, onRetry, retryLabel });
  };

  const showSuccess = (message: string) => {
    return addToast({ type: "success", message });
  };

  const showInfo = (message: string) => {
    return addToast({ type: "info", message });
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
