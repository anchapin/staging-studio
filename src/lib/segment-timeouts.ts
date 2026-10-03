/**
 * Timeouts for /api/segment/furnishings (issues #1118, #1119).
 *
 * The fal SAM subscribe and each mask fetch are armed with this budget.
 * The mask fetches run in parallel after the subscribe, so the route's
 * worst case is SEGMENT_WORST_CASE_MS, which its `maxDuration` must cover.
 */
export const DETECTION_TIMEOUT_MS = 90_000;

/** Subscribe leg + parallel mask-fetch leg. */
export const SEGMENT_WORST_CASE_MS = 2 * DETECTION_TIMEOUT_MS;
