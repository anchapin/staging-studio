/**
 * Feature flag: SAM click-to-select ("Select Object") mask tool.
 *
 * Issue #202 (post-demo revival): the tool is re-enabled with the real
 * design pass the demo skipped — immediate per-click feedback (spinner +
 * busy state on the tool button itself, wait cursor on the canvas), an
 * editor-open pre-warm ping that warms the route/auth/DB path at zero
 * provider cost, a bounded in-session mask cache (repeat selections of an
 * already-segmented point are free), and cold/warm latency events
 * (`segment-timing.ts`) for operator measurement.
 *
 * `fal-ai/sam` has no embedding input/output (see `segment-mask.ts`), so
 * the SAM image encoder still runs inside each billed call on fal's
 * servers; the pre-warm removes OUR side's cold-path costs only. Multi-
 * select is the next wave (issue #203).
 *
 * The flag remains the kill switch: flipping it to `false` hides the tool
 * and its hint copy, gates the pre-warm, and skips the select-object e2e
 * specs — nothing else changes.
 */
export const SAM_TOOL_ENABLED = true;
