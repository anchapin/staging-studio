/**
 * Staging Aesthetic Moodboard & Materiality — theme definitions (issue #621).
 *
 * The four selectable aesthetic directives shown on the Client Project Setup
 * screen (Step 1). Each theme pairs a directive code, descriptive copy, and a
 * four-swatch materiality palette rendered as color chips on the moodboard
 * cards. Pure data + helpers only; presentation lives in
 * `src/components/dashboard/moodboard-selector.tsx`.
 */

import { cn } from "@/lib/utils";

export type MoodboardThemeId =
  | "warm-organic-modern"
  | "japandi-minimalist"
  | "european-transitional"
  | "california-coastal-luxe";

export interface MoodboardColorChip {
  name: string;
  hex: string;
}

export interface MoodboardTheme {
  id: MoodboardThemeId;
  name: string;
  directive: string;
  description: string;
  imageAlt: string;
  palette: readonly MoodboardColorChip[];
}

export const MOODBOARD_THEMES = [
  {
    id: "warm-organic-modern",
    name: "Warm Organic Modern",
    directive: "Directive A1",
    description:
      "Bouclé sofa, honed travertine, and limewash walls layered over warm neutrals — quiet luxury with tactile, earthy warmth.",
    imageAlt:
      "Warm organic interior with bouclé sofa, travertine table, and limewash walls",
    palette: [
      { name: "Linen Neutral", hex: "#EDE7DF" },
      { name: "Honed Travertine", hex: "#D8C7B5" },
      { name: "Terracotta Bronze", hex: "#C47847" },
      { name: "Olive Botanical", hex: "#5A5F4B" },
    ],
  },
  {
    id: "japandi-minimalist",
    name: "Japandi Minimalist",
    directive: "Directive B2",
    description:
      "Light blonde oak, wabi-sabi ceramics, and a linen platform daybed — restrained serenity where every object earns its place.",
    imageAlt:
      "Light blonde oak interior with wabi-sabi ceramics and linen platform daybed",
    palette: [
      { name: "Paper White", hex: "#EFECE6" },
      { name: "Blonde Oak", hex: "#D4C3A3" },
      { name: "River Stone", hex: "#7B7368" },
      { name: "Sumi Ink", hex: "#2C2926" },
    ],
  },
  {
    id: "european-transitional",
    name: "European Transitional",
    directive: "Directive C3",
    description:
      "Calacatta marble fireplace, brass sconces, and velvet armchairs — old-world craftsmanship calibrated for contemporary living.",
    imageAlt:
      "Calacatta marble fireplace with brass sconces and velvet armchairs",
    palette: [
      { name: "Chalk Plaster", hex: "#F4F1EC" },
      { name: "Vintage Brass", hex: "#B89B66" },
      { name: "Cypress Velvet", hex: "#424B3E" },
      { name: "Noir Marble", hex: "#1E1D1C" },
    ],
  },
  {
    id: "california-coastal-luxe",
    name: "California Coastal Luxe",
    directive: "Directive D4",
    description:
      "Floor-to-ceiling windows, bleached oak, and sea glass accents over woven jute — relaxed sophistication warmed by the Pacific.",
    imageAlt:
      "Floor-to-ceiling windows with bleached oak, sea glass lamp, and jute rug",
    palette: [
      { name: "Sea Salt", hex: "#FAF9F5" },
      { name: "Bleached Oak", hex: "#CFBA9D" },
      { name: "Pacific Glass", hex: "#97AFA7" },
      { name: "Textured Jute", hex: "#9A8268" },
    ],
  },
] as const satisfies readonly MoodboardTheme[];

/** Theme 1 (Warm Organic Modern) is the default active directive. */
export const DEFAULT_MOODBOARD_THEME_ID: MoodboardThemeId =
  "warm-organic-modern";

/** AI Micro-Parameter slider definitions shown below the moodboard grid. */
export const MOODBOARD_MICRO_PARAMETERS = {
  preservationStrictness: {
    label: "Architectural Preservation Strictness",
    defaultValue: 94,
  },
  foliageFill: {
    label: "Generative Foliage & Organic Fill",
    defaultValue: 65,
  },
} as const;

/** Badge label for the Neural Staging Engine version shown in the subpanel. */
export const NEURAL_STAGING_ENGINE_LABEL = "Neural Staging Engine v4.2";

/** Returns the theme definition for a given id, or null if not found. */
export function getMoodboardTheme(id: string): MoodboardTheme | null {
  return MOODBOARD_THEMES.find((t) => t.id === id) ?? null;
}

/** Label shown on a card's color-chip row: active vs. selectable state. */
export function themeStatusLabel(isActive: boolean): "Active Directive" | "Select" {
  return isActive ? "Active Directive" : "Select";
}

/** Counter pill label above the grid, e.g. "1 Theme Active". */
export function formatActiveThemeCount(count: number): string {
  return `${count} ${count === 1 ? "Theme" : "Themes"} Active`;
}

/**
 * Builds the full-bleed card image treatment as a CSS background string,
 * derived from the theme's materiality palette (hermetic stand-in for
 * photography; keeps exact palette fidelity).
 */
export function themeImageGradient(
  palette: readonly MoodboardColorChip[]
): string {
  const [first, second, , darkest] = palette;
  return `linear-gradient(135deg, ${first.hex} 0%, ${second.hex} 52%, ${darkest.hex} 100%)`;
}

/** Card container classes for the active vs. inactive moodboard card. */
export function moodboardCardClasses(isActive: boolean): string {
  return cn(
    "group relative w-full overflow-hidden rounded-xl border-2 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
    isActive
      ? "border-secondary bg-surface-container-low shadow-sm"
      : "border-outline-variant/40 bg-card hover:border-outline-variant hover:bg-surface-container-low/60"
  );
}
