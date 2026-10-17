/**
 * Issue #1343 — `autosaveCopy` (pure resolver for the Room listing copy).
 *
 * The CopyPanel owns its own `useState<{ headline, body }>` and the
 * shell (`EditRoomStudio`) wires its `AutosaveController<ListingCopy>`
 * to call this resolver on every debounced edit. Keeping the
 * Prisma-write shape here (rather than inlined in the server action)
 * means the resolver is unit-pinnable without Prisma or React — see
 * `tests/autosave-copy.test.ts`.
 *
 * Field semantics (pinned by tests):
 *  - Both `headline` and `body` are *verbatim*: empty strings are
 *    allowed (the user can clear a field; an explicit clear is
 *    distinct from "never touched" in the lookbook render). Whitespace
 *    is preserved — trimming is the lookbook render's job. This
 *    matches the `autosaveDirectives` field contract used by the
 *    Staging tab's `<textarea>`.
 *
 * Out of scope:
 *  - Debounce/retry/flush mechanics — the `AutosaveController` owns
 *    those. This resolver is a single-synchronous call that returns
 *    one Prisma update payload.
 *  - The actual Prisma call — the `saveListingCopy` server action in
 *    `src/app/actions/room-copy.ts` wraps this resolver with auth +
 *    ownership + revalidation.
 *  - Length caps. The CopyPanel enforces `maxLength={600}` on the
 *    Description textarea via the HTML attribute; the server action
 *    also enforces a 600-char upper bound at the Zod layer.
 */

export interface ListingCopyPayload {
  /** Headline shown above the room narrative in the lookbook. */
  headline: string;
  /** Long-form description; the lookbook renders it under the headline. */
  body: string;
}

/**
 * The Prisma `RoomUpdateInput` shape limited to the two new listing-
 * copy columns. Built structurally narrow (only those two keys, no
 * `id`, no legacy fields) so the server action can spread it directly
 * into a `prisma.room.update` without whitelisting.
 */
export interface RoomListingCopyUpdate {
  lookbookHeadline: string;
  lookbookBody: string;
}

/**
 * Builds the Prisma `Room.update` data shape for the two listing-copy
 * columns. Same-input-same-output (pure); never throws.
 */
export function autosaveCopy(payload: ListingCopyPayload): RoomListingCopyUpdate {
  return {
    lookbookHeadline: payload.headline,
    lookbookBody: payload.body,
  };
}
