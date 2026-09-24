import { z } from "zod";

export const checklistItemSchema = z.object({
  item: z.string(),
  completed: z.boolean(),
  notes: z.string(),
});
