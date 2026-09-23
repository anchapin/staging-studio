/**
 * Issue #614: Atelier Canvas typography tokens.
 *
 * Single source of truth for the three-font stack (Playfair Display for
 * editorial headings, Plus Jakarta Sans for body/UI, JetBrains Mono for
 * technical readouts) and the Stitch typography scale.
 *
 * Consumers:
 * - `tailwind.config.ts` builds the `fontFamily` token map from these tables.
 * - `src/app/globals.css` mirrors the scale as combined `@utility` token
 *   classes (family + size + weight + line-height in one class).
 * - `tests/typography-tokens.test.ts` pins both against this module.
 *
 * The canonical CSS variables (`--font-*-google`) are minted by `next/font`
 * in `src/app/layout.tsx` and attached to `<html>`.
 */

/** The three Atelier Canvas font families + brand serif, keyed by short name. */
export const TYPOGRAPHY_FONTS = {
  playfair: {
    varName: "--font-playfair-google",
    stack: "var(--font-playfair-google), Georgia, serif",
  },
  jakarta: {
    varName: "--font-jakarta-google",
    stack: "var(--font-jakarta-google), system-ui, sans-serif",
  },
  jetbrains: {
    varName: "--font-jetbrains-google",
    stack: "var(--font-jetbrains-google), ui-monospace, monospace",
  },
  cinzel: {
    varName: "--font-cinzel-google",
    stack: "var(--font-cinzel-google), Georgia, serif",
  },
} as const;

export type TypographyFontKey = keyof typeof TYPOGRAPHY_FONTS;

/**
 * Token → family mapping (issue #614 Tailwind `fontFamily` block).
 * Playfair Display is reserved for display/headline tokens, Plus Jakarta Sans
 * owns every title/body/label token, JetBrains Mono is `code-inspector` only.
 */
export const TYPOGRAPHY_TOKEN_FAMILIES = {
  "display-lg": "playfair",
  "display-lg-mobile": "playfair",
  "headline-lg": "playfair",
  "headline-lg-mobile": "playfair",
  "headline-md": "playfair",
  "headline-sm": "playfair",
  "title-md": "jakarta",
  "title-sm": "jakarta",
  "body-lg": "jakarta",
  "body-md": "jakarta",
  "body-sm": "jakarta",
  "label-md": "jakarta",
  "label-sm": "jakarta",
  "code-inspector": "jetbrains",
} as const satisfies Record<string, TypographyFontKey>;

export type TypographyToken = keyof typeof TYPOGRAPHY_TOKEN_FAMILIES;

/** One row of the issue #614 typography scale. */
export type TypographyScaleRow = {
  fontFamily: TypographyFontKey;
  /** CSS font-size in rem. */
  fontSize: string;
  /** CSS line-height in rem. */
  lineHeight: string;
  /** CSS font-weight. */
  fontWeight: string;
};

/**
 * The typography scale (issue #614 table): token → family + size + weight +
 * line-height. Mobile variants mirror their desktop counterparts (the spec
 * table defines no separate mobile sizes).
 */
export const TYPOGRAPHY_SCALE = {
  "display-lg": { fontFamily: "playfair", fontSize: "3rem", lineHeight: "3.5rem", fontWeight: "600" },
  "display-lg-mobile": { fontFamily: "playfair", fontSize: "3rem", lineHeight: "3.5rem", fontWeight: "600" },
  "headline-lg": { fontFamily: "playfair", fontSize: "2rem", lineHeight: "2.5rem", fontWeight: "500" },
  "headline-lg-mobile": { fontFamily: "playfair", fontSize: "2rem", lineHeight: "2.5rem", fontWeight: "500" },
  "headline-md": { fontFamily: "playfair", fontSize: "1.5rem", lineHeight: "2rem", fontWeight: "500" },
  "headline-sm": { fontFamily: "playfair", fontSize: "1.25rem", lineHeight: "1.75rem", fontWeight: "600" },
  "title-md": { fontFamily: "jakarta", fontSize: "1rem", lineHeight: "1.5rem", fontWeight: "600" },
  "title-sm": { fontFamily: "jakarta", fontSize: "0.875rem", lineHeight: "1.25rem", fontWeight: "600" },
  "body-lg": { fontFamily: "jakarta", fontSize: "1rem", lineHeight: "1.625rem", fontWeight: "400" },
  "body-md": { fontFamily: "jakarta", fontSize: "0.875rem", lineHeight: "1.375rem", fontWeight: "400" },
  "body-sm": { fontFamily: "jakarta", fontSize: "0.8125rem", lineHeight: "1.125rem", fontWeight: "400" },
  "label-md": { fontFamily: "jakarta", fontSize: "0.75rem", lineHeight: "1rem", fontWeight: "500" },
  "label-sm": { fontFamily: "jakarta", fontSize: "0.6875rem", lineHeight: "0.875rem", fontWeight: "600" },
  "code-inspector": { fontFamily: "jetbrains", fontSize: "0.75rem", lineHeight: "1rem", fontWeight: "400" },
} as const satisfies Record<TypographyToken, TypographyScaleRow>;

/** Font stack for a typography token (e.g. `fontFamilyStack("code-inspector")`). */
export function fontFamilyStack(token: TypographyToken): string {
  return TYPOGRAPHY_FONTS[TYPOGRAPHY_TOKEN_FAMILIES[token]].stack;
}
