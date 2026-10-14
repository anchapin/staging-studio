/**
 * Auto-classify helpers for the single-room upload path (issue #1180).
 *
 * The batch upload flow (`createRoomsBatch`) classifies each photo up
 * front and names the room from the detected type. The single-room
 * upload flow (`confirmRoomPhotoUpload`) only links the uploaded photo
 * into the room row, so a room created with a placeholder/blank name
 * stays blank until the user types one. Issue #1180 closes that gap:
 * once the photo is on the room, classify it via the existing
 * gpt-4o-mini vision surface and pre-fill the name — but only when the
 * name is currently blank/placeholder, never overwrite a user-typed
 * label, and never propagate classifier failures back to the upload.
 *
 * Pure logic only; the wiring (DB read, AI call, DB write, try/catch)
 * lives in `src/app/actions/room-photos.ts` next to the confirm action
 * so the upload path stays the single source of truth.
 */

/**
 * Labels the `ROOM_TYPE_SYSTEM_PROMPT` advertises as valid room types
 * (issue #788). The model's confidence fallback is the literal string
 * `"Other"` — anything it can't classify lands there.
 */
export const ROOM_TYPE_OTHER_LABEL = "Other";

/**
 * `true` when the room's current name should be auto-classified from
 * the uploaded photo. Trigger conditions:
 *
 *   - `name.trim() === ""` — truly blank (the `Room.name` schema is
 *     non-nullable `String`, but a future listing-ingest path
 *     referenced by issue #1179 can mint rows with empty labels).
 *   - `name.trim() === "Other"` — explicit low-confidence placeholder;
 *     the classifier already saw the photo (or a placeholder was typed
 *     manually) and we should let the new detection have another go.
 *
 * Anything else — including room-type labels like `"Primary Bedroom"`
 * that just happen to share a word with a generic name — is left
 * alone. A wrong guess on a typed name costs the user a keystroke; a
 * missed pre-fill on a blank name costs zero, so the bias is towards
 * not overwriting.
 */
export function shouldAutoClassifyRoomName(currentName: string): boolean {
  const trimmed = currentName.trim();
  return trimmed === "" || trimmed === ROOM_TYPE_OTHER_LABEL;
}

/**
 * `true` when a detected room-type label is good enough to write back
 * to the room. The model's explicit "low-confidence" sentinel is
 * `"Other"`; rejecting that string gives the low-confidence → blank
 * fallback promised by issue #1180. Empty/whitespace labels are also
 * rejected — the AI SDK can return an empty string on parse failure
 * (handled separately by `detectRoomType`, but a defense-in-depth
 * check here means the helper is safe to call from anywhere).
 */
export function isUsableRoomTypeLabel(label: string): boolean {
  const trimmed = label.trim();
  return trimmed !== "" && trimmed !== ROOM_TYPE_OTHER_LABEL;
}