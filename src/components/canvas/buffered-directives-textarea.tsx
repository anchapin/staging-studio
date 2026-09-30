"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Issue #1159: the staging-directives textareas were fully controlled by
 * state that lives in the project detail view, so every keystroke
 * re-rendered the whole studio tree (canvas, overlay layer, inspector)
 * before the character appeared. On a furnished room that read as a
 * visible lag of several frames per key.
 *
 * This keeps the caret responsive by buffering the value locally and
 * lifting it on a short idle window (and immediately on blur, which the
 * #496 autosave already relies on). The parent stays the source of
 * truth: an external change is adopted whenever the field is not the
 * one being typed in.
 */
export const DIRECTIVES_COMMIT_DELAY_MS = 120;

export interface BufferedDirectivesTextareaProps {
  id: string;
  value: string;
  onCommit: (value: string) => void;
  onBlur?: () => void;
  /** Reports each keystroke immediately, for a character counter. */
  onLocalChange?: (value: string) => void;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
}

export default function BufferedDirectivesTextarea({
  id,
  value,
  onCommit,
  onBlur,
  onLocalChange,
  rows = 3,
  maxLength,
  placeholder,
  className,
  "aria-label": ariaLabel,
}: BufferedDirectivesTextareaProps) {
  const [draft, setDraft] = useState(value);
  const focusedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<string | null>(null);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  // Adopt external updates (room switch, autosave reconcile, undo) only
  // while the user is not mid-keystroke in this field.
  useEffect(() => {
    if (!focusedRef.current) setDraft(value);
  }, [value]);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending !== null) onCommitRef.current(pending);
  }, []);

  // A pending edit must never be lost if the field unmounts (room switch,
  // tab change) before the idle window elapses.
  useEffect(() => flush, [flush]);

  const handleChange = useCallback(
    (next: string) => {
      setDraft(next);
      onLocalChange?.(next);
      pendingRef.current = next;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, DIRECTIVES_COMMIT_DELAY_MS);
    },
    [flush, onLocalChange]
  );

  return (
    <textarea
      id={id}
      aria-label={ariaLabel}
      value={draft}
      onChange={(e) => handleChange(e.target.value)}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onBlur={() => {
        focusedRef.current = false;
        flush();
        onBlur?.();
      }}
      rows={rows}
      maxLength={maxLength}
      placeholder={placeholder}
      className={className}
    />
  );
}
