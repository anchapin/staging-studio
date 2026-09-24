/** Durable fal.ai result state read from an `InpaintRequest` row. */
export interface InpaintPersistenceState {
  /** Queue job status; `"COMPLETED"` means the result is final. */
  status: string;
  /** Stored result image URL, or `null` when none was persisted yet. */
  resultUrl: string | null;
}

/**
 * Decision returned by {@link decideInpaintPersistence}:
 * - `{ kind: "return-stored", url }` — reuse the persisted URL, skip fal.
 * - `{ kind: "persist" }` — no usable result; run inpainting and save it.
 */
export type InpaintPersistenceDecision =
  | { kind: "return-stored"; url: string }
  | { kind: "persist" };

/**
 * Decides whether an inpaint request can be short-circuited.
 *
 * Purpose: avoids re-billing fal.ai when a completed run already has a
 * durable result URL stored on the `InpaintRequest` row (fal.ai result
 * URLs expire, hence the persistence discipline).
 *
 * Contract: returns `return-stored` only for `status === "COMPLETED"`
 * with a non-empty string `resultUrl`; every other state says
 * `persist`.
 *
 * Side effects: none — pure function.
 */
export function decideInpaintPersistence(
  state: InpaintPersistenceState
): InpaintPersistenceDecision {
  if (
    state.status === "COMPLETED" &&
    typeof state.resultUrl === "string" &&
    state.resultUrl.length > 0
  ) {
    return { kind: "return-stored", url: state.resultUrl };
  }

  return { kind: "persist" };
}
