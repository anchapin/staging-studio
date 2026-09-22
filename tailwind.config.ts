import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "selector",
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        cinzel: ["var(--font-cinzel)", "serif"],
        playfair: ["var(--font-playfair)", "serif"],
        jakarta: ["var(--font-plus-jakarta)", "sans-serif"],
        jetbrains: ["var(--font-jetbrains)", "monospace"],
        mono: ["var(--font-jetbrains)", "monospace"],
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
    },
  },
  plugins: [],
};

export default config;
