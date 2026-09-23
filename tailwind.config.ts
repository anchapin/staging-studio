import type { Config } from "tailwindcss";

import {
  TYPOGRAPHY_FONTS,
  TYPOGRAPHY_TOKEN_FAMILIES,
  type TypographyToken,
} from "./src/lib/typography-tokens";

/**
 * Issue #614: the 14 typography token → font-family mappings, generated from
 * the shared token tables in src/lib/typography-tokens.ts (so `font-display-lg`
 * … `font-code-inspector` all exist as utilities).
 */
const tokenFontFamilies = Object.fromEntries(
  Object.entries(TYPOGRAPHY_TOKEN_FAMILIES).map(([token, family]) => [
    token,
    TYPOGRAPHY_FONTS[family].stack,
  ]),
) as Record<TypographyToken, string>;

const config: Config = {
  darkMode: "selector",
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        ...tokenFontFamilies,
        // Atelier Canvas semantic aliases
        display: [TYPOGRAPHY_FONTS.playfair.stack],
        heading: [TYPOGRAPHY_FONTS.playfair.stack],
        body: [TYPOGRAPHY_FONTS.jakarta.stack],
        sans: [TYPOGRAPHY_FONTS.jakarta.stack],
        // Component-level aliases
        cinzel: [TYPOGRAPHY_FONTS.cinzel.stack],
        playfair: [TYPOGRAPHY_FONTS.playfair.stack],
        jakarta: [TYPOGRAPHY_FONTS.jakarta.stack],
        jetbrains: [TYPOGRAPHY_FONTS.jetbrains.stack],
        mono: [TYPOGRAPHY_FONTS.jetbrains.stack],
      },
      fontSize: {
        // Display (editorial hero headings)
        "display-lg": [
          "3rem",
          { lineHeight: "3.5rem", fontWeight: "600", letterSpacing: "-0.02em" },
        ],
        // Issue #614: mobile variants mirror desktop (spec defines no separate size)
        "display-lg-mobile": [
          "3rem",
          { lineHeight: "3.5rem", fontWeight: "600", letterSpacing: "-0.02em" },
        ],
        "display-md": [
          "2.5rem",
          { lineHeight: "3rem", fontWeight: "600", letterSpacing: "-0.01em" },
        ],
        "display-sm": ["2rem", { lineHeight: "2.5rem", fontWeight: "600" }],
        // Headlines (section titles, room names)
        "headline-lg": [
          "2rem",
          { lineHeight: "2.5rem", fontWeight: "500", letterSpacing: "-0.01em" },
        ],
        // Issue #614: mobile variant mirrors desktop (spec defines no separate size)
        "headline-lg-mobile": [
          "2rem",
          { lineHeight: "2.5rem", fontWeight: "500", letterSpacing: "-0.01em" },
        ],
        "headline-md": [
          "1.5rem",
          { lineHeight: "2rem", fontWeight: "500" },
        ],
        "headline-sm": [
          "1.25rem",
          { lineHeight: "1.75rem", fontWeight: "600" },
        ],
        // Titles (card titles, modal headings)
        "title-lg": [
          "1.25rem",
          { lineHeight: "1.75rem", fontWeight: "600" },
        ],
        "title-md": ["1rem", { lineHeight: "1.5rem", fontWeight: "600" }],
        "title-sm": [
          "0.875rem",
          { lineHeight: "1.25rem", fontWeight: "600" },
        ],
        // Body (descriptions, paragraphs)
        "body-lg": ["1rem", { lineHeight: "1.625rem", fontWeight: "400" }],
        "body-md": [
          "0.875rem",
          { lineHeight: "1.375rem", fontWeight: "400" },
        ],
        "body-sm": [
          "0.8125rem",
          { lineHeight: "1.125rem", fontWeight: "400" },
        ],
        // Labels (badges, tags, UI hints)
        "label-lg": ["0.875rem", { lineHeight: "1.25rem", fontWeight: "500" }],
        "label-md": ["0.75rem", { lineHeight: "1rem", fontWeight: "500" }],
        "label-sm": [
          "0.6875rem",
          {
            lineHeight: "0.875rem",
            fontWeight: "600",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          },
        ],
        "label-xs": [
          "0.625rem",
          {
            lineHeight: "0.75rem",
            fontWeight: "600",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          },
        ],
        // Code / Technical (seed codes, coordinates)
        // Note: font pairing comes from the `font-mono` / `font-code-inspector`
        // utilities — Tailwind's fontSize scale only emits size/weight/spacing.
        "code-lg": [
          "0.875rem",
          { lineHeight: "1.25rem", fontWeight: "400" },
        ],
        "code-md": [
          "0.75rem",
          { lineHeight: "1rem", fontWeight: "400" },
        ],
        "code-sm": ["0.6875rem", { lineHeight: "0.875rem" }],
        // Issue #614: technical readout token (12px / 400 / 16px, JetBrains Mono)
        "code-inspector": [
          "0.75rem",
          { lineHeight: "1rem", fontWeight: "400" },
        ],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          foreground: "hsl(var(--info-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        /* Hairline divider token (Issue #640) */
        "outline-variant": "hsl(var(--outline-variant))",
        /* Atelier Canvas palette (Issue #546) */
        atelier: {
          canvas: "#F8F6F2",
          primary: "#181716",
          secondary: "#C47847",
          taupe: "#8C827A",
          cream: "#fff8f8",
        },
      },
      borderRadius: {
        // Base scale (matching Stitch spec)
        none: "0px",
        xs: "0.125rem", // 2px — very subtle, hairline dividers
        sm: "0.25rem", // 4px — tight, small elements
        md: "0.375rem", // 6px — inputs, small buttons
        lg: "0.5rem", // 8px — cards, panels
        xl: "0.75rem", // 12px — modals, large cards
        "2xl": "1rem", // 16px — inspector panel, drawers
        "3xl": "1.5rem", // 24px — large containers
        // Pill / full radius
        pill: "0.75rem", // NOT 9999px — the Stitch spec uses 12px (0.75rem) for pill shapes
        full: "9999px", // True full circle for avatars
      },
      boxShadow: {
        // Warm shadow tokens — warm-toned rgba(48, 40, 34, ...) gives shadows a linen/terracotta tint
        "warm-sm": "0 1px 3px rgba(48, 40, 34, 0.08), 0 1px 2px rgba(48, 40, 34, 0.06)",
        "warm-md": "0 4px 12px rgba(48, 40, 34, 0.10), 0 2px 4px rgba(48, 40, 34, 0.06)",
        "warm-lg": "0 8px 24px rgba(48, 40, 34, 0.12), 0 4px 8px rgba(48, 40, 34, 0.08)",
        "warm-xl": "0 16px 48px rgba(48, 40, 34, 0.14), 0 8px 16px rgba(48, 40, 34, 0.08)",
        "warm-2xl": "0 24px 64px rgba(48, 40, 34, 0.16), 0 12px 24px rgba(48, 40, 34, 0.10)",
        // Glassmorphic containers (tool rail, bottom dock)
        glass: "0 4px 16px rgba(48, 40, 34, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.4)",
        // Canvas comparison slider handle
        handle: "0 2px 8px rgba(48, 40, 34, 0.20), 0 1px 2px rgba(48, 40, 34, 0.12)",
      },
    },
  },
  plugins: [],
};

export default config;
