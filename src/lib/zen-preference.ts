/**
 * Per-browser Zen Mode preference (issue #1191).
 *
 * The edit workspace's Zen choice persists to localStorage so someone
 * who turns Zen off stays out of it, and someone who chooses it gets
 * it back. Pure helpers take the storage as an argument so unit tests
 * pin the parsing; the browser adapter reads window.localStorage
 * safely (SSR render and privacy-blocked storage both degrade to
 * "no stored choice").
 */

export const ZEN_MODE_PREFERENCE_KEY = "staging-studio:zen-mode";

/** One-time exit hint flag, shown on a browser's first Zen activation. */
export const ZEN_HINT_SHOWN_KEY = "staging-studio:zen-hint-shown";

export type MinimalStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

/**
 * Reads the stored Zen choice. Returns null when nothing usable is
 * stored (never chosen, garbage value, unavailable storage), leaving
 * the caller's default in charge.
 */
export function readZenModePreference(
  storage: MinimalStorage | null | undefined
): boolean | null {
  try {
    const raw = storage?.getItem(ZEN_MODE_PREFERENCE_KEY);
    if (raw === "true") return true;
    if (raw === "false") return false;
    return null;
  } catch {
    return null;
  }
}

/** Persists the Zen choice; storage failures are swallowed (a hint, not a duty). */
export function writeZenModePreference(
  storage: MinimalStorage | null | undefined,
  value: boolean
): void {
  try {
    storage?.setItem(ZEN_MODE_PREFERENCE_KEY, value ? "true" : "false");
  } catch {
    // Unavailable storage: the session keeps the in-memory choice.
  }
}

/** Whether this browser has already seen the one-time Zen exit hint. */
export function readZenHintShown(
  storage: MinimalStorage | null | undefined
): boolean {
  try {
    return storage?.getItem(ZEN_HINT_SHOWN_KEY) === "true";
  } catch {
    return false;
  }
}

/** Marks the one-time Zen exit hint as shown. */
export function writeZenHintShown(
  storage: MinimalStorage | null | undefined
): void {
  try {
    storage?.setItem(ZEN_HINT_SHOWN_KEY, "true");
  } catch {
    // Unavailable storage: the hint may re-show next visit; harmless.
  }
}

/** The browser's localStorage, or null under SSR / blocked storage. */
export function getBrowserLocalStorage(): MinimalStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
