/**
 * Completion payload of a finished inpaint poll — the subset of the status
 * response body that the persistence decision depends on (issue #687).
 * `persisted` is `false` when the server generated an image but could not
 * upload it to durable storage, in which case `imageUrl` is an expiring
 * fal CDN URL.
 */
export interface InpaintCompletionPayload {
  /** Final staged image URL (durable storage URL, or expiring fal URL). */
  imageUrl?: unknown;
  /** Whether the URL was persisted to durable storage; absent means yes. */
  persisted?: unknown;
}

/** Decision returned by {@link shouldPersistResult}. */
export type InpaintPersistDecision =
  | { persist: true; reason: "durable" }
  | { persist: false; reason: "not-persisted"; warning: string };

/**
 * Warning shown when a completed inpaint result was not durably persisted.
 * Surfaced as an error toast by the editor (errors persist until dismissed,
 * so the warning stays visible).
 */
export const INPAINT_NOT_PERSISTED_WARNING =
  "The staged image was generated but could not be saved to permanent storage, " +
  "so it was not applied to the room or saved to version history — the temporary " +
  "image link expires. Please try again.";

/**
 * Decides whether a completed inpaint result may be persisted client-side
 * (room variant slot patch + InpaintVersion row).
 *
 * Purpose (issue #687): fal result URLs expire, so a completion payload
 * marked `persisted: false` must never be written into `Room.afterImageUrl*`
 * or `InpaintVersion.resultUrl` — both would rot, and a later "restore
 * version" would resurrect a dead link.
 *
 * Contract: ONLY an explicit `persisted === false` blocks persistence
 * (carrying the warning copy to surface); `true`, absent, or any other
 * value means the normal completion flow.
 *
 * Side effects: none — pure function.
 */
export function shouldPersistResult(
  payload: InpaintCompletionPayload
): InpaintPersistDecision {
  if (payload.persisted === false) {
    return {
      persist: false,
      reason: "not-persisted",
      warning: INPAINT_NOT_PERSISTED_WARNING,
    };
  }
  return { persist: true, reason: "durable" };
}
