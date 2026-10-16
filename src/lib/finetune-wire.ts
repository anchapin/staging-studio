/**
 * FineTune wire-shape helpers (issue #1362b, Stage B).
 *
 * Two pure helpers the project route uses to translate the
 * persisted FineTune state (`Room.fineTuneStrength: Int`,
 * `Room.fineTuneExpand: Int`, `Room.fineTuneSeed: String`) into the
 * shape the DashScope submit path consumes:
 *
 *  - `clamp(value, min, max)` — defensively bound the 0..100 UI
 *    strength to the 0..1 DashScope wire range. Persisted values
 *    already pass through Zod (0..100 int) so this is belt-and-
 *    braces against a stale or hand-edited row.
 *  - `parseSeedOrUndefined(value)` — parse the user's typed seed
 *    (digits-only string, max 6 chars per `roomMetadataSchema`) into
 *    a `number` for the wire. Returns `undefined` for empty / blank
 *    inputs so DashScope rolls fresh (the user's "Random" intent).
 *
 * Pure / no side effects. Pinned by `tests/finetune-wire.test.ts`
 * (boundary cases: empty string, whitespace, leading zeros, digits
 * only, non-digit characters rejected).
 */

/** Clamp `value` to the inclusive `[min, max]` range. */
export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Parse a digits-only seed string into a `number`, or `undefined`
 * when the input is empty / blank.
 *
 * Rules:
 *  - `null` / `undefined` ⇒ `undefined` (no seed; let DashScope roll
 *    fresh).
 *  - Whitespace-only or empty string ⇒ `undefined`.
 *  - Non-digit characters rejected (return `undefined`). The
 *    FineTune input already strips non-digits at the UI layer; this
 *    is defense in depth.
 *  - Otherwise, `Number.parseInt(value, 10)`.
 *
 * Note: `roomMetadataSchema.fineTuneSeed` caps at 6 digits (max
 * 999999) — DashScope's seed field accepts 0..999999, so the schema
 * cap matches the wire range and no further clamping is needed here.
 */
export function parseSeedOrUndefined(
  value: string | null | undefined
): number | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (!/^\d+$/.test(trimmed)) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  // `parseInt` on a 6-digit digits-only string always returns a
  // finite number, but `Number.isFinite` is cheap insurance against
  // a malformed input slipping through the regex.
  return Number.isFinite(parsed) ? parsed : undefined;
}