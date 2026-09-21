import { describe, expect, it } from "vitest";
import { getAestheticChips } from "@/lib/aesthetic-chips";

describe("getAestheticChips", () => {
  it("returns aesthetic-specific chips for Organic Modern Luxury", () => {
    const chips = getAestheticChips("Organic Modern Luxury");
    expect(chips).toContain("Neutral linen sofa");
    expect(chips).toContain("Light oak accents");
    expect(chips).toContain("Organic textured rug");
    expect(chips.length).toBe(4);
  });

  it("returns aesthetic-specific chips for Warm Transitional", () => {
    const chips = getAestheticChips("Warm Transitional");
    expect(chips).toContain("Classic wooden dining set");
    expect(chips).toContain("Cozy upholstered chairs");
    expect(chips.length).toBe(4);
  });

  it("returns aesthetic-specific chips for Coastal Minimal", () => {
    const chips = getAestheticChips("Coastal Minimal");
    expect(chips).toContain("Light oak console table");
    expect(chips).toContain("White linen sofa");
    expect(chips.length).toBe(4);
  });

  it("returns aesthetic-specific chips for Urban Industrial", () => {
    const chips = getAestheticChips("Urban Industrial");
    expect(chips).toContain("Metal and wood table");
    expect(chips).toContain("Leather accent chair");
    expect(chips.length).toBe(4);
  });

  it("returns aesthetic-specific chips for Classic Elegant", () => {
    const chips = getAestheticChips("Classic Elegant");
    expect(chips).toContain("Tufted velvet sofa");
    expect(chips).toContain("Crystal chandelier");
    expect(chips.length).toBe(4);
  });

  it("returns generic chips for unknown aesthetic", () => {
    const chips = getAestheticChips("Scandinavian Nordic");
    expect(chips).toContain("Modern sofa");
    expect(chips).toContain("Wooden coffee table");
    expect(chips).toContain("Area rug");
    expect(chips.length).toBe(4);
  });

  it("returns generic chips for empty string", () => {
    const chips = getAestheticChips("");
    expect(chips).toEqual(["Modern sofa", "Wooden coffee table", "Area rug", "Floor lamp"]);
  });

  it("returns generic chips for whitespace-only string", () => {
    const chips = getAestheticChips("   ");
    expect(chips).toEqual(["Modern sofa", "Wooden coffee table", "Area rug", "Floor lamp"]);
  });

  it("returns generic chips for null/undefined", () => {
    expect(getAestheticChips(null as unknown as string)).toEqual([
      "Modern sofa",
      "Wooden coffee table",
      "Area rug",
      "Floor lamp",
    ]);
    expect(getAestheticChips(undefined as unknown as string)).toEqual([
      "Modern sofa",
      "Wooden coffee table",
      "Area rug",
      "Floor lamp",
    ]);
  });

  it("trims whitespace around aesthetic name", () => {
    const chips = getAestheticChips("  Coastal Minimal  ");
    expect(chips).toContain("Light oak console table");
  });
});
