import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "selector",
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // Atelier Canvas semantic aliases
        display: ["var(--font-playfair)", "serif"],
        heading: ["var(--font-playfair)", "serif"],
        body: ["var(--font-plus-jakarta)", "sans-serif"],
        sans: ["var(--font-plus-jakarta)", "sans-serif"],
        // Component-level aliases
        cinzel: ["var(--font-cinzel)", "serif"],
        playfair: ["var(--font-playfair)", "serif"],
        jakarta: ["var(--font-plus-jakarta)", "sans-serif"],
        jetbrains: ["var(--font-jetbrains)", "monospace"],
        mono: ["var(--font-jetbrains)", "monospace"],
      },
      fontSize: {
        // Display (editorial hero headings)
        "display-lg": [
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
        "code-lg": [
          "0.875rem",
          {
            lineHeight: "1.25rem",
            fontWeight: "400",
            fontFamily: "var(--font-jetbrains)",
          },
        ],
        "code-md": [
          "0.75rem",
          {
            lineHeight: "1rem",
            fontWeight: "400",
            fontFamily: "var(--font-jetbrains)",
          },
        ],
        "code-sm": [
          "0.6875rem",
          { lineHeight: "0.875rem", fontFamily: "var(--font-jetbrains)" },
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
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [],
};

export default config;
