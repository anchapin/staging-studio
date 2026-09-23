/**
 * Issue #613: Atelier Canvas warm color token system.
 *
 * Single source of truth for the Stitch "Atelier Canvas" warm palette
 * (linen/stone surfaces, charred-walnut primary, terracotta-bronze
 * generative accent, muted-sage restoration indicator).
 *
 * Consumers:
 * - `tailwind.config.ts` builds the `atelier` color scale from this table.
 * - `src/app/globals.css` mirrors the table as `--color-*` custom properties
 *   (`:root` values + `@theme inline` mappings) so CSS-first Tailwind v4
 *   emits `bg-*` / `text-*` / `border-*` utilities for every token.
 * - `tests/color-tokens.test.ts` pins the table, the Tailwind wiring, the
 *   globals.css mirror, and WCAG AA contrast for every on-/container pair.
 *
 * Spec deviations, both directed by the issue itself:
 * - `outline` is #8C827A (the issue corrects its draft value #7c766f to the
 *   Atelier taupe "per spec").
 * - `on-primary-container` is #fff8f4 (the issue flags its draft value #868382
 *   as poor contrast on the dark `primary-container` and directs the warm
 *   off-white instead).
 */

/** WCAG 2.1 contrast thresholds (normal text / large text ≥18pt or 14pt bold). */
export const WCAG_AA_TEXT = 4.5;
export const WCAG_AA_LARGE_TEXT = 3;

/**
 * The Atelier Canvas color tokens (issue #613 spec table), keyed by the
 * kebab-case Stitch token name. Values are issue-verbatim hex.
 */
export const ATELIER_COLOR_TOKENS = {
  // Surface palette (warm linen/stone family)
  surface: "#fff8f4",
  "surface-dim": "#e4d8ce",
  "surface-bright": "#fff8f4",
  "surface-container-lowest": "#ffffff",
  "surface-container-low": "#fef1e8",
  "surface-container": "#f9ece2",
  "surface-container-high": "#f3e6dc",
  "surface-container-highest": "#ede0d7",
  "surface-variant": "#ede0d7",
  background: "#fff8f4",
  "on-surface": "#201a15",
  "on-surface-variant": "#4a4640",
  "inverse-surface": "#362f29",
  "inverse-on-surface": "#fceee5",

  // Primary — Charred Walnut (deep grounding black; NOT #000000)
  primary: "#181716",
  "on-primary": "#ffffff",
  "primary-container": "#1c1b1a",
  "on-primary-container": "#fff8f4",
  "inverse-primary": "#cac6c4",

  // Secondary — Terracotta Bronze (the key generative/AI accent)
  secondary: "#8f4d20",
  "on-secondary": "#ffffff",
  "secondary-container": "#fda772",
  "on-secondary-container": "#773b0e",
  "secondary-fixed": "#ffdbc8",
  "secondary-fixed-dim": "#ffb68b",
  "on-secondary-fixed": "#321300",
  "on-secondary-fixed-variant": "#713609",

  // Tertiary — Muted Sage (restoration/success indicator; NOT #000000)
  tertiary: "#5C6E58",
  "on-tertiary": "#ffffff",
  "tertiary-container": "#d4e8cd",
  "on-tertiary-container": "#3a4b37",

  // Neutrals & outlines
  outline: "#8C827A",
  "outline-variant": "#ccc5bd",
  "surface-tint": "#605e5c",

  // Semantic — error
  error: "#ba1a1a",
  "on-error": "#ffffff",
  "error-container": "#ffdad6",
  "on-error-container": "#93000a",
} as const;

export type AtelierColorToken = keyof typeof ATELIER_COLOR_TOKENS;

/** CSS custom-property name for a token (`on-surface` → `--color-on-surface`). */
export function cssVarName(token: AtelierColorToken): string {
  return `--color-${token}`;
}

/** sRGB hex (#rgb or #rrggbb) → relative luminance per WCAG 2.1. */
export function relativeLuminance(hex: string): number {
  const raw = hex.replace("#", "");
  const digits =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  if (digits.length !== 6 || /[^0-9a-fA-F]/.test(digits)) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  const channel = (start: number) => {
    const value = Number.parseInt(digits.slice(start, start + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
  );
}

/** WCAG 2.1 contrast ratio between two colors (1..21, symmetric). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [lighter, darker] = la >= lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}

/** True when the foreground/background pair meets WCAG AA. */
export function meetsWcagAa(
  foreground: string,
  background: string,
  { largeText = false }: { largeText?: boolean } = {},
): boolean {
  const threshold = largeText ? WCAG_AA_LARGE_TEXT : WCAG_AA_TEXT;
  return contrastRatio(foreground, background) >= threshold;
}

/** The spec's text-on-container pairings; every row must meet WCAG AA. */
export const ATELIER_CONTRAST_PAIRS = [
  { foreground: "on-surface", background: "surface" },
  { foreground: "on-surface-variant", background: "surface" },
  { foreground: "inverse-on-surface", background: "inverse-surface" },
  { foreground: "on-primary", background: "primary" },
  { foreground: "on-primary-container", background: "primary-container" },
  { foreground: "on-secondary", background: "secondary" },
  { foreground: "on-secondary-container", background: "secondary-container" },
  { foreground: "on-secondary-fixed", background: "secondary-fixed" },
  { foreground: "on-secondary-fixed-variant", background: "secondary-fixed-dim" },
  { foreground: "on-tertiary", background: "tertiary" },
  { foreground: "on-tertiary-container", background: "tertiary-container" },
  { foreground: "on-error", background: "error" },
  { foreground: "on-error-container", background: "error-container" },
] as const satisfies ReadonlyArray<{
  foreground: AtelierColorToken;
  background: AtelierColorToken;
}>;

export type AtelierContrastPair = (typeof ATELIER_CONTRAST_PAIRS)[number];

/** Pill shapes use 12px (0.75rem), never 9999px (issue #613 task 5). */
export const PILL_RADIUS = "0.75rem";
/** True circles (avatars, dots) keep the browser-full radius. */
export const CIRCLE_RADIUS = "9999px";
