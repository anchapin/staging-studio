"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

interface ConfirmDialogProps {
  /** Controls dialog visibility */
  open: boolean;
  /** Called when the user chooses to cancel or the dialog is dismissed */
  onCancel: () => void;
  /** Called when the user confirms the destructive action */
  onConfirm: () => void;
  /** Dialog title */
  title: string;
  /** Explanatory message */
  message: string;
  /** Label for the cancel button */
  cancelLabel?: string;
  /** Label for the confirm/destructive button */
  confirmLabel?: string;
}

export function ConfirmDialog({
  open,
  onCancel,
  onConfirm,
  title,
  message,
  cancelLabel = "Cancel",
  confirmLabel = "Delete",
}: ConfirmDialogProps) {
  const [mounted, setMounted] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Focus management and keyboard handling
  useEffect(() => {
    if (!mounted || !open) return;

    // Save current focus and trap focus inside dialog
    previousActiveElement.current = document.activeElement as HTMLElement;

    // Focus the dialog container on open
    const timer = setTimeout(() => {
      dialogRef.current?.focus();
    }, 0);

    return () => clearTimeout(timer);
  }, [open, mounted]);

  // Restore focus when dialog closes
  useEffect(() => {
    if (!open && previousActiveElement.current) {
      previousActiveElement.current.focus();
    }
  }, [open]);

  if (!mounted || !open) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
    // Trap focus
    if (e.key === "Tab" && dialogRef.current) {
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="presentation"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onCancel}
        aria-hidden="true"
      />

      {/* Dialog */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="relative z-50 w-full max-w-sm rounded-xl border border-border bg-background p-6 shadow-lg focus:outline-none"
      >
        <h2
          id="confirm-dialog-title"
          className="text-base font-semibold text-foreground"
        >
          {title}
        </h2>
        <p
          id="confirm-dialog-message"
          className="mt-2 text-sm text-muted-foreground"
        >
          {message}
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="outline" size="sm" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              onConfirm();
              onCancel();
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
