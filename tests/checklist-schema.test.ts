import { afterEach, describe, expect, it, vi } from "vitest";

import { checklistItemSchema, parseChecklistItems } from "@/lib/checklist-schema";

const llmPayload = {
  observedChallenge: "The entryway feels cramped and dark.",
  recommendation: "Introduce light-toned furniture and mirrors.",
  buyerPsychology: "Buyers want an airy first impression.",
  checklist: [
    { item: "Declutter entryway console", category: "DIY/Declutter", priority: "Critical" },
    { item: "Rent neutral sofa", category: "Rental Inventory", priority: "High" },
    { item: "Patch nail holes", category: "Minor Repair", priority: "Standard" },
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("checklistItemSchema", () => {
  it("accepts the canonical priorities produced by generate-copy", () => {
    for (const item of llmPayload.checklist) {
      expect(checklistItemSchema.safeParse(item).success).toBe(true);
    }
  });

  it("rejects legacy lowercase priorities on the write side", () => {
    const result = checklistItemSchema.safeParse({
      item: "Declutter entryway console",
      category: "DIY/Declutter",
      priority: "high",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown categories and priorities", () => {
    expect(
      checklistItemSchema.safeParse({
        item: "Item",
        category: "Furniture",
        priority: "Critical",
      }).success
    ).toBe(false);
    expect(
      checklistItemSchema.safeParse({
        item: "Item",
        category: "DIY/Declutter",
        priority: "urgent",
      }).success
    ).toBe(false);
  });
});

describe("parseChecklistItems", () => {
  it("preserves priorities from a generate-copy payload", () => {
    const parsed = parseChecklistItems(llmPayload.checklist, { roomId: "room-1" });
    expect(parsed).toEqual(llmPayload.checklist);
  });

  it("normalizes legacy lowercase values to the canonical enum", () => {
    const parsed = parseChecklistItems([
      { item: "Declutter shelves", category: "DIY/Declutter", priority: "high" },
      { item: "Rent armchairs", category: "Rental Inventory", priority: "medium" },
      { item: "Touch up paint", category: "Minor Repair", priority: "low" },
    ]);
    expect(parsed.map((item) => item.priority)).toEqual(["Critical", "High", "Standard"]);
  });

  it("drops malformed items without failing the whole list", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const parsed = parseChecklistItems([
      { item: "Valid item", category: "Minor Repair", priority: "High" },
      { item: 42, category: "Minor Repair", priority: "High" },
      { item: "Bad priority", category: "Minor Repair", priority: "urgent" },
      { item: "Missing category", priority: "High" },
      null,
      "not an object",
    ]);

    expect(parsed).toEqual([
      { item: "Valid item", category: "Minor Repair", priority: "High" },
    ]);
    expect(warn).toHaveBeenCalled();
  });

  it("returns an empty list for non-array input", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseChecklistItems(null)).toEqual([]);
    expect(parseChecklistItems(undefined)).toEqual([]);
    expect(parseChecklistItems("not an array")).toEqual([]);
    expect(parseChecklistItems({ checklist: [] })).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it("yields a renderable subset for a partial-copy room", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const parsed = parseChecklistItems(
      [
        { item: "Declutter closets", category: "DIY/Declutter", priority: "Critical" },
        { item: "Rent dining set", category: "Rental Inventory", priority: "medium" },
        { item: "Broken", category: "DIY/Declutter", priority: "asap" },
        17,
      ],
      { roomId: "room-77" }
    );

    expect(parsed).toEqual([
      { item: "Declutter closets", category: "DIY/Declutter", priority: "Critical" },
      { item: "Rent dining set", category: "Rental Inventory", priority: "High" },
    ]);
    expect(parsed.length).toBeGreaterThan(0);
    expect(
      warn.mock.calls.some(([message]) => String(message).includes("room-77"))
    ).toBe(true);
  });
});
