import { describe, expect, it } from "vitest";

import {
  DEFAULT_MOODBOARD_THEME_ID,
  MOODBOARD_MICRO_PARAMETERS,
  MOODBOARD_THEMES,
  NEURAL_STAGING_ENGINE_LABEL,
  formatActiveThemeCount,
  getMoodboardTheme,
  moodboardCardClasses,
  themeImageGradient,
  themeStatusLabel,
  type MoodboardThemeId,
} from "@/lib/moodboard-themes";

const EXPECTED_PALETTES: Record<string, string[]> = {
  "warm-organic-modern": ["#EDE7DF", "#D8C7B5", "#C47847", "#5A5F4B"],
  "japandi-minimalist": ["#EFECE6", "#D4C3A3", "#7B7368", "#2C2926"],
  "european-transitional": ["#F4F1EC", "#B89B66", "#424B3E", "#1E1D1C"],
  "california-coastal-luxe": ["#FAF9F5", "#CFBA9D", "#97AFA7", "#9A8268"],
};

describe("MoodboardSelector data (issue #621)", () => {
  it("defines exactly 4 themes with unique ids", () => {
    expect(MOODBOARD_THEMES).toHaveLength(4);
    const ids = MOODBOARD_THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(4);
  });

  it("renders the four spec themes in order with correct directive codes", () => {
    expect(MOODBOARD_THEMES.map((t) => t.name)).toEqual([
      "Warm Organic Modern",
      "Japandi Minimalist",
      "European Transitional",
      "California Coastal Luxe",
    ]);
    expect(MOODBOARD_THEMES.map((t) => t.directive)).toEqual([
      "Directive A1",
      "Directive B2",
      "Directive C3",
      "Directive D4",
    ]);
  });

  it("pins the exact color chip hex values per theme", () => {
    for (const theme of MOODBOARD_THEMES) {
      expect(theme.palette.map((c) => c.hex)).toEqual(
        EXPECTED_PALETTES[theme.id]
      );
    }
  });

  it("gives every chip a name and a valid #RRGGBB hex", () => {
    for (const theme of MOODBOARD_THEMES) {
      expect(theme.palette).toHaveLength(4);
      for (const chip of theme.palette) {
        expect(chip.name.trim()).not.toBe("");
        expect(chip.hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    }
  });

  it("gives every theme a description and image alt text", () => {
    for (const theme of MOODBOARD_THEMES) {
      expect(theme.description.trim()).not.toBe("");
      expect(theme.imageAlt.trim()).not.toBe("");
    }
  });

  it("defaults to Warm Organic Modern (Theme 1 active)", () => {
    expect(DEFAULT_MOODBOARD_THEME_ID).toBe("warm-organic-modern");
  });
});

describe("getMoodboardTheme", () => {
  it("returns the theme for a known id", () => {
    const theme = getMoodboardTheme("japandi-minimalist");
    expect(theme?.name).toBe("Japandi Minimalist");
  });

  it("returns null for an unknown id", () => {
    expect(getMoodboardTheme("mid-century-modern")).toBeNull();
  });
});

describe("themeStatusLabel", () => {
  it("labels the active theme", () => {
    expect(themeStatusLabel(true)).toBe("Active Directive");
  });

  it("labels an inactive theme", () => {
    expect(themeStatusLabel(false)).toBe("Select");
  });
});

describe("formatActiveThemeCount", () => {
  it("formats the singular counter", () => {
    expect(formatActiveThemeCount(1)).toBe("1 Theme Active");
  });

  it("formats the plural counter", () => {
    expect(formatActiveThemeCount(2)).toBe("2 Themes Active");
  });

  it("formats zero", () => {
    expect(formatActiveThemeCount(0)).toBe("0 Themes Active");
  });
});

describe("themeImageGradient", () => {
  it("derives a linear gradient from the palette hexes", () => {
    const warm = getMoodboardTheme("warm-organic-modern");
    expect(warm).not.toBeNull();
    const gradient = themeImageGradient(warm!.palette);
    expect(gradient.startsWith("linear-gradient(")).toBe(true);
    expect(gradient).toContain("#EDE7DF");
  });

  it("uses the first, second, and darkest palette colors", () => {
    const [, japandi] = MOODBOARD_THEMES;
    const gradient = themeImageGradient(japandi.palette);
    expect(gradient).toContain("#EFECE6");
    expect(gradient).toContain("#D4C3A3");
    expect(gradient).toContain("#2C2926");
    expect(gradient).not.toContain("#7B7368");
  });
});

describe("MoodboardThemeId type", () => {
  it("accepts the four theme ids", () => {
    const ids: MoodboardThemeId[] = [
      "warm-organic-modern",
      "japandi-minimalist",
      "european-transitional",
      "california-coastal-luxe",
    ];
    expect(ids).toHaveLength(4);
  });
});

describe("MOODBOARD_MICRO_PARAMETERS", () => {
  it("defines the preservation slider with its 94% default", () => {
    expect(MOODBOARD_MICRO_PARAMETERS.preservationStrictness.label).toBe(
      "Architectural Preservation Strictness"
    );
    expect(MOODBOARD_MICRO_PARAMETERS.preservationStrictness.defaultValue).toBe(
      94
    );
  });

  it("defines the foliage slider with its 65% default", () => {
    expect(MOODBOARD_MICRO_PARAMETERS.foliageFill.label).toBe(
      "Generative Foliage & Organic Fill"
    );
    expect(MOODBOARD_MICRO_PARAMETERS.foliageFill.defaultValue).toBe(65);
  });

  it("labels the Neural Staging Engine badge", () => {
    expect(NEURAL_STAGING_ENGINE_LABEL.startsWith("Neural Staging Engine")).toBe(
      true
    );
  });
});

describe("moodboardCardClasses", () => {
  it("styles the active card with the terracotta border and tinted surface", () => {
    const classes = moodboardCardClasses(true);
    expect(classes).toContain("border-2");
    expect(classes).toContain("border-secondary");
    expect(classes).toContain("bg-surface-container-low");
  });

  it("styles the inactive card with the hairline border and hover affordance", () => {
    const classes = moodboardCardClasses(false);
    expect(classes).toContain("border-outline-variant/40");
    expect(classes).toContain("hover:border-outline-variant");
    expect(classes).not.toContain("border-secondary");
  });
});
