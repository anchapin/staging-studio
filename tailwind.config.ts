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
