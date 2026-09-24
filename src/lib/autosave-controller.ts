import { useEffect, useRef, useState } from "react";

/**
 * Debounced autosave decision logic for the lookbook edit page
 * (issue #250).
 *
 * Purpose: owns WHEN saves happen — ~1s after the last keystroke, or
 * immediately on blur — and whether pending work is complete, so the
 * React components stay thin and the timing rules are pin-able with
 * fake timers. The controller is framework-free: persistence is
 * injected as an async `save` callback (the `saveRoomCopyEdits` server
 * action in the app), state is observable via `status`, and `flush()`
 * gives "leaving Edit mode" / "Export PDF" a way to await in-flight
 * writes.
 *
 * Contract:
 * - `edit(payload)` marks state dirty and (re)schedules the idle timer;
 *   only the LAST payload is saved (trailing-edge debounce).
 * - `blur()` saves immediately when dirty and cancels the pending idle
 *   timer (no double save).
 * - A save started while another is in flight runs after it completes.
 * - `flush()` forces any scheduled-but-not-started save to start now
 *   and resolves `true` only when no dirty work remains.
 * - A failed save surfaces as `"error"` status (never silent);
 *   `retry()` re-attempts.
 *
 * Side effects: none beyond the injected `save` callback and
 * `setTimeout` — pure scheduling logic, no React, no Prisma, no env.
 */

/** Save-state surfaced to the UI (Saving…/Saved/Try again indicator). */
export type AutosaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

export interface AutosaveOptions<T> {
  /** Persists one payload; resolves `true` on success. */
  save: (payload: T) => Promise<boolean>;
  /** Idle window before an edit auto-saves. Default 1000ms. */
  idleMs?: number;
  /** Notified on every status transition (for the save indicator). */
  onStatusChange?: (status: AutosaveStatus) => void;
}

export class AutosaveController<T> {
  private readonly save: (payload: T) => Promise<boolean>;
  private readonly idleMs: number;
  private _onStatusChange: ((status: AutosaveStatus) => void) | undefined;
  public get onStatusChange(): ((status: AutosaveStatus) => void) | undefined {
    return this._onStatusChange;
  }
  public set onStatusChange(fn: ((status: AutosaveStatus) => void) | undefined) {
    this._onStatusChange = fn;
  }

  private _status: AutosaveStatus = "idle";
  private pending: T | null = null;
  private hasPending = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(options: AutosaveOptions<T>) {
    this.save = options.save;
    this.idleMs = options.idleMs ?? 1000;
    this._onStatusChange = options.onStatusChange;
  }

  get status(): AutosaveStatus {
    return this._status;
  }

  private setStatus(status: AutosaveStatus): void {
    this._status = status;
    this._onStatusChange?.(status);
  }

  /** Records a change and restarts the ~1s idle window. */
  edit(payload: T): void {
    this.pending = payload;
    this.hasPending = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.setStatus("dirty");
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.saveNow();
    }, this.idleMs);
  }

  /** Saves immediately (field blur) instead of waiting out the idle window. */
  blur(): void {
    if (!this.hasPending) return;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    void this.saveNow();
  }

  /** Re-attempts after a failure surfaced as `"error"`. */
  retry(): void {
    if (this._status !== "error" || !this.hasPending) return;
    void this.saveNow();
  }

  /**
   * Forces scheduled work to start now and waits for all of it.
   * Resolves `false` when dirty work remains (save failed) — callers
   * (Export PDF, leaving Edit mode) must not proceed over lost edits.
   */
  async flush(): Promise<boolean> {
    if (this.hasPending) {
      if (this.timer !== null) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      this.saveNow();
    }
    if (this.inFlight) await this.inFlight;
    return !this.hasPending;
  }

  private saveNow(): Promise<void> {
    if (this.inFlight) {
      // A save is running; it chains the pending payload on completion.
      return this.inFlight;
    }
    if (!this.hasPending) return Promise.resolve();

    const run = async () => {
      this.setStatus("saving");
      let ok = true;
      let failedPayload: T | null = null;
      while (this.hasPending) {
        const payload = this.pending as T;
        this.pending = null;
        this.hasPending = false;
        ok = await this.save(payload);
        if (!ok) {
          failedPayload = payload;
          break;
        }
      }
      this.inFlight = null;
      if (ok) {
        this.setStatus("saved");
      } else {
        // Keep the failed payload pending so retry()/edit()/flush() can
        // act on it — never silently drop user edits.
        this.pending = failedPayload;
        this.hasPending = true;
        this.setStatus("error");
      }
    };

    this.inFlight = run();
    return this.inFlight;
  }
}

const _controllers = new Map<string, AutosaveController<unknown>>();

function getAutoSaveController(roomId: string): AutosaveController<unknown> {
  let controller = _controllers.get(roomId);
  if (!controller) {
    controller = new AutosaveController<unknown>({ save: async () => true });
    _controllers.set(roomId, controller);
  }
  return controller;
}

export function useAutoSaveStatus(roomId: string): AutosaveStatus {
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const controllerRef = useRef<AutosaveController<unknown> | null>(null);

  if (!controllerRef.current) {
    controllerRef.current = getAutoSaveController(roomId);
    controllerRef.current.onStatusChange?.(controllerRef.current.status);
  }

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    const prev = controller.onStatusChange;
    controller.onStatusChange = (s) => {
      setStatus(s);
      prev?.(s);
    };
    setStatus(controller.status);
    return () => {
      controller.onStatusChange = prev ?? undefined;
    };
  }, [roomId]);

  return status;
}
