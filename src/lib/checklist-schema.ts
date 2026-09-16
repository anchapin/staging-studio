import { z } from "zod";

export const CHECKLIST_PRIORITIES = ["Critical", "High", "Standard"] as const;
export type ChecklistPriority = (typeof CHECKLIST_PRIORITIES)[number];

export const CHECKLIST_CATEGORIES = [
  "DIY/Declutter",
  "Rental Inventory",
  "Minor Repair",
] as const;
export type ChecklistCategory = (typeof CHECKLIST_CATEGORIES)[number];

export type ChecklistItem = {
  item: string;
  category: ChecklistCategory;
  priority: ChecklistPriority;
};

export const checklistItemSchema = z.object({
  item: z.string(),
  category: z.enum(CHECKLIST_CATEGORIES),
  priority: z.enum(CHECKLIST_PRIORITIES),
});

const PRIORITY_ALIASES: Record<string, ChecklistPriority> = {
  Critical: "Critical",
  High: "High",
  Standard: "Standard",
  high: "Critical",
  medium: "High",
  low: "Standard",
};

const storedChecklistItemSchema = z.object({
  item: z.string(),
  category: z.enum(CHECKLIST_CATEGORIES),
  priority: z.string().transform((value, ctx) => {
    const normalized = PRIORITY_ALIASES[value];
    if (!normalized) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unknown checklist priority: ${value}`,
      });
      return z.NEVER;
    }
    return normalized;
  }),
});

export function parseChecklistItems(
  value: unknown,
  options?: { roomId?: string }
): ChecklistItem[] {
  const prefix = options?.roomId ? `[checklist roomId=${options.roomId}]` : "[checklist]";

  if (!Array.isArray(value)) {
    console.warn(`${prefix} checklistItems is not an array; rendering without checklist`);
    return [];
  }

  const items: ChecklistItem[] = [];
  value.forEach((entry, index) => {
    const result = storedChecklistItemSchema.safeParse(entry);
    if (!result.success) {
      console.warn(
        `${prefix} dropping malformed checklist item at index ${index}: ${result.error.issues
          .map((issue) => issue.message)
          .join("; ")}`
      );
      return;
    }
    items.push(result.data);
  });

  return items;
}
