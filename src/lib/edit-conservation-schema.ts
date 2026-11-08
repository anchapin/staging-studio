import { z } from "zod";

/**
 * Wire schema for the edit-conservation QA payload (issue #1446, wiring
 * slice).
 *
 * The payload carries the measurements the ABACUS-style checks consume:
 * per-region change scores (the scene-conservation check) and, for a
 * future counting source, per-category detections and requested counts
 * (the object-count check). Every field is optional — a caller with no
 * measurements sends `{}` and the gate reports nothing.
 *
 * The measurements are produced by the browser (`lib/edit-conservation-
 * measure.ts`); the server only evaluates them, and the evaluation is
 * advisory (it can never fail, block, or reject an edit).
 *
 * Bounds: the arrays are capped so a malformed (or hostile) body cannot
 * make the evaluation expensive.
 *
 * Side effects: none (pure validation).
 */

const MAX_REGIONS = 512;
const MAX_DETECTIONS = 512;
const MAX_EXPECTED_COUNTS = 64;

const conservationRegionSchema = z.object({
  regionId: z.string().min(1).max(64),
  changedFraction: z.number().min(0).max(1),
  insideMask: z.boolean().optional(),
});

const conservationDetectionSchema = z.object({
  category: z.string().min(1).max(120),
  confidence: z.number().min(0).max(1).optional(),
});

const expectedCountSchema = z.object({
  category: z.string().min(1).max(120),
  count: z.number().int().min(0).max(1000).optional(),
  add: z.number().int().min(0).max(1000).optional(),
  remove: z.number().int().min(0).max(1000).optional(),
});

/**
 * Zod schema for the `POST /api/inpaint/:requestId/conservation` body.
 *
 * Contract: `.strict()` — an unknown field is a 400, not a silently
 * ignored key (the same policy the inpaint request schema uses).
 */
export const editConservationRequestSchema = z
  .object({
    regions: z
      .object({
        before: z.array(conservationRegionSchema).max(MAX_REGIONS).optional(),
        after: z.array(conservationRegionSchema).max(MAX_REGIONS).optional(),
      })
      .optional(),
    detections: z
      .object({
        before: z.array(conservationDetectionSchema).max(MAX_DETECTIONS).optional(),
        after: z.array(conservationDetectionSchema).max(MAX_DETECTIONS).optional(),
      })
      .optional(),
    expectedCounts: z.array(expectedCountSchema).max(MAX_EXPECTED_COUNTS).optional(),
    mask: z
      .object({
        regionIds: z.array(z.string().min(1).max(64)).max(MAX_REGIONS),
      })
      .optional(),
    tolerance: z.number().min(0).max(1).optional(),
    maxViolations: z.number().int().min(0).max(100).optional(),
    minConfidence: z.number().min(0).max(1).optional(),
  })
  .strict();

/** The validated shape of an edit-conservation request body. */
export type EditConservationRequestInput = z.infer<
  typeof editConservationRequestSchema
>;
