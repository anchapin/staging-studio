import { z } from "zod";

import { segmentConceptSchema } from "@/lib/ai-route-schemas";

/**
 * Upper bound for `editedLabel` in a selection event. Labels are short
 * batch-panel names for a detected instance (find-and-replace initiative
 * #238); 60 chars is comfortably above any real label while capping the
 * Postgres-bloat vector of unbounded free text.
 */
export const SELECTION_LOG_EDITED_LABEL_MAX = 60;

/**
 * Zod schema for selection events persisted by `logSelectionEvent`
 * (src/app/actions/selection-log.ts, issue #714).
 *
 * Purpose: bounds every client-supplied SelectionLog field before the
 * Prisma create. `roomId` must be a non-empty string (ownership is
 * re-checked by the action); `concept` reuses
 * {@link segmentConceptSchema} (1–30 chars, lowercase letters, spaces,
 * and hyphens only) so the training corpus stays byte-compatible with
 * concept-chip detection input; `instanceIndex` must be a non-negative
 * integer (position in the score-ranked detection response);
 * `score` must be a finite number (provider confidence — zod already
 * rejects NaN for `z.number()`, `.finite()` adds ±Infinity);
 * `editedLabel` is optional (matching the nullable Prisma column) but
 * when present must be 1–60 non-empty characters after trimming.
 * `.strict()` rejects unknown keys so stale clients fail loudly.
 *
 * Contract: the action validates input through this schema BEFORE the
 * ownership check and create, returning the first zod issue message on
 * failure — never persisting unvalidated fields.
 *
 * Side effects: none (pure validation).
 */
export const selectionLogSchema = z
  .object({
    roomId: z.string().min(1),
    concept: segmentConceptSchema,
    instanceIndex: z.number().int().min(0),
    score: z.number().finite(),
    editedLabel: z
      .string()
      .trim()
      .min(1, { message: "Edited label must be 1–60 characters." })
      .max(SELECTION_LOG_EDITED_LABEL_MAX, {
        message: "Edited label must be 1–60 characters.",
      })
      .optional(),
  })
  .strict();
