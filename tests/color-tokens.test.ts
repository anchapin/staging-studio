import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import tailwindConfig from "../tailwind.config";
import {
  ATELIER_COLOR_TOKENS,
  ATELIER_CONTRAST_PAIRS,
  CIRCLE_RADIUS,
  PILL_RADIUS,
  WCAG_AA_TEXT,
  contrastRatio,
  cssVarName,
  meetsWcagAa,
  relativeLuminance,
  type AtelierColorToken,
} from "@/lib/color-tokens";

/**
 * Issue #613: warm Atelier Canvas color token system.
 *
 * Pins the system end to end:
 * - the token table in lib/color-tokens matches the issue spec verbatim
 *   (including the two issue-directed corrections: outline #8C827A and
 *   on-primary-container #fff8f4)
 * - every on-/container pairing meets WCAG AA (≥ 4.5:1)
 * - the Tailwind `atelier` color scale is generated from the same table
 * - borderRadius keeps `pill: 0.75rem` for pills and `full` for true circles
 * - globals.css :root mirrors every token value (CSS-first Tailwind v4 path)
 * - acceptance: no arbitrary-value `[#…]` utilities remain in component code
 */

const rootDir = fileURLToPath(new URL("..", import.meta.url));

function readProjectFile(relative: string): string {
  return readFileSync(path.join(rootDir, relative), "utf8");
}

const TOKENS = Object.keys(ATELIER_COLOR_TOKENS) as AtelierColorToken[];

/** The issue #613 spec table, verbatim. */
const SPEC_TABLE: Record<string, string> = {
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
  // Primary (Charred Walnut)
  primary: "#181716",
  "on-primary": "#ffffff",
  "primary-container": "#1c1b1a",
  "on-primary-container": "#fff8f4",
  "inverse-primary": "#cac6c4",
  // Secondary (Terracotta Bronze)
  secondary: "#8f4d20",
  "on-secondary": "#ffffff",
  "secondary-container": "#fda772",
  "on-secondary-container": "#773b0e",
  "secondary-fixed": "#ffdbc8",
  "secondary-fixed-dim": "#ffb68b",
  "on-secondary-fixed": "#321300",
  "on-secondary-fixed-variant": "#713609",
  // Tertiary (Muted Sage)
  tertiary: "#5C6E58",
  "on-tertiary": "#ffffff",
  "tertiary-container": "#d4e8cd",
  "on-tertiary-container": "#3a4b37",
  // Neutrals & outlines
  outline: "#8C827A",
  "outline-variant": "#ccc5bd",
  "surface-tint": "#605e5c",
  // Semantic
  error: "#ba1a1a",
  "on-error": "#ffffff",
  "error-container": "#ffdad6",
  "on-error-container": "#93000a",
};

describe("Atelier color token table — issue #613", () => {
  it("defines exactly the spec tokens, no more, no fewer", () => {
    expect([...TOKENS].sort()).toEqual([...Object.keys(SPEC_TABLE)].sort());
  });

  it("matches every spec value verbatim", () => {
    for (const token of TOKENS) {
      expect(ATELIER_COLOR_TOKENS[token]).toBe(SPEC_TABLE[token]);
    }
  });

  it("keeps primary charred walnut, never true black", () => {
    expect(ATELIER_COLOR_TOKENS.primary).toBe("#181716");
    expect(ATELIER_COLOR_TOKENS.primary).not.toBe("#000000");
  });

  it("makes tertiary the muted sage restoration indicator", () => {
    expect(ATELIER_COLOR_TOKENS.tertiary).toBe("#5C6E58");
    expect(ATELIER_COLOR_TOKENS.tertiary).not.toBe("#000000");
    // supersedes the pre-#613 warm-taupe mapping
    expect(ATELIER_COLOR_TOKENS.tertiary).not.toBe("#8C827A");
  });

  it("applies the issue-directed spec corrections", () => {
    // outline: draft #7c766f → Atelier taupe per spec
    expect(ATELIER_COLOR_TOKENS.outline).toBe("#8C827A");
    // on-primary-container: draft #868382 flagged for poor contrast → warm off-white
    expect(ATELIER_COLOR_TOKENS["on-primary-container"]).toBe("#fff8f4");
  });
});

describe("WCAG contrast math", () => {
  it("relative luminance handles the extremes", () => {
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 6);
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 6);
  });

  it("black on white is the 21:1 reference ratio", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
  });

  it("meetsWcagAa agrees with the ratio", () => {
    expect(meetsWcagAa("#000000", "#ffffff")).toBe(true);
    expect(meetsWcagAa("#ffffff", "#ffffff")).toBe(false);
    // 3:1 pair fails normal text but passes large-text AA
    expect(meetsWcagAa("#C47847", "#ffffff")).toBe(false);
    expect(meetsWcagAa("#C47847", "#ffffff", { largeText: true })).toBe(true);
  });

  it("every on-/container pair meets WCAG AA (≥ 4.5:1)", () => {
    expect(ATELIER_CONTRAST_PAIRS.length).toBeGreaterThanOrEqual(13);
    for (const pair of ATELIER_CONTRAST_PAIRS) {
      const fg = ATELIER_COLOR_TOKENS[pair.foreground];
      const bg = ATELIER_COLOR_TOKENS[pair.background];
      const ratio = contrastRatio(fg, bg);
      expect(
        ratio,
        `${pair.foreground} (${fg}) on ${pair.background} (${bg}) = ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
    }
  });

  it("the draft on-primary-container gray is measurably worse than the fix", () => {
    const draft = contrastRatio("#868382", ATELIER_COLOR_TOKENS["primary-container"]);
    const fixed = contrastRatio(
      ATELIER_COLOR_TOKENS["on-primary-container"],
      ATELIER_COLOR_TOKENS["primary-container"],
    );
    expect(fixed).toBeGreaterThan(draft);
    expect(fixed).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
  });
});

describe("Tailwind wiring — issue #613 task 1", () => {
  const colors = tailwindConfig.theme?.extend?.colors as Record<
    string,
    unknown
  >;
  const atelier = colors.atelier as Record<string, string>;

  it("builds the atelier scale from the token table", () => {
    for (const token of TOKENS) {
      expect(atelier[token]).toBe(ATELIER_COLOR_TOKENS[token]);
    }
  });

  it("keeps the legacy Atelier aliases alongside the spec tokens", () => {
    expect(atelier.canvas).toBe("#F8F6F2");
    expect(atelier.taupe).toBe("#8C827A");
    expect(atelier.cream).toBe("#fff8f8");
  });

  it("primary buttons get #181716, not #000000 (acceptance)", () => {
    expect(atelier.primary).toBe("#181716");
    expect(atelier.primary).not.toBe("#000000");
  });

  it("uses 12px pills, never 9999px pills; circles stay circular (task 5)", () => {
    const radius = tailwindConfig.theme?.extend?.borderRadius as Record<
      string,
      string
    >;
    expect(radius.pill).toBe(PILL_RADIUS);
    expect(radius.pill).toBe("0.75rem");
    expect(radius.full).toBe(CIRCLE_RADIUS); // avatars/dots keep true circles
  });
});

describe("globals.css mirror — CSS-first Tailwind v4 path", () => {
  const css = readProjectFile("src/app/globals.css");

  it("defines every token value on :root custom properties", () => {
    // background, outline-variant, and primary ride their shadcn vars
    // (--background / --outline-variant / --primary) instead of the
    // --color-* namespace
    expect(css).toContain("--background: #fff8f4;");
    expect(css).toContain("--outline-variant: #ccc5bd;");
    expect(css).toContain("--primary: #181716;");
    for (const token of TOKENS) {
      if (
        token === "background" ||
        token === "outline-variant" ||
        token === "primary"
      ) {
        continue;
      }
      expect(css).toContain(`--color-${token}: ${ATELIER_COLOR_TOKENS[token]};`);
    }
  });

  it("maps every token through @theme inline (utility emission)", () => {
    // secondary is a literal in @theme inline; background/outline-variant/
    // primary ride their shadcn vars
    expect(css).toContain("--color-secondary: #8f4d20;");
    expect(css).toContain("--color-background: var(--background);");
    expect(css).toContain("--color-outline-variant: var(--outline-variant);");
    expect(css).toContain("--color-primary: var(--primary);");
    for (const token of TOKENS) {
      if (
        token === "background" ||
        token === "outline-variant" ||
        token === "secondary" ||
        token === "primary"
      ) {
        continue;
      }
      expect(css).toContain(
        `--color-${token}: var(--color-${token});`,
      );
    }
  });

  it("names css vars exactly after the tokens", () => {
    expect(cssVarName("on-surface-variant")).toBe("--color-on-surface-variant");
    expect(cssVarName("primary-container")).toBe("--color-primary-container");
  });
});

describe("acceptance: system colors via tokens, not raw hex", () => {
  it("no arbitrary-value utilities carry system token hexes", async () => {
    const { readdirSync, statSync } = await import("node:fs");
    const collect = (dir: string): string[] => {
      const absolute = path.join(rootDir, dir);
      const out: string[] = [];
      for (const entry of readdirSync(absolute)) {
        const entryPath = path.join(absolute, entry);
        if (statSync(entryPath).isDirectory()) {
          out.push(...collect(path.join(dir, entry)));
        } else if (/\.(tsx|ts)$/.test(entry)) {
          out.push(entryPath);
        }
      }
      return out;
    };

    const tokenHexes = new Set(
      TOKENS.map((t) => ATELIER_COLOR_TOKENS[t].toLowerCase()),
    );
    tokenHexes.add("#1c1917"); // pre-#613 near-black replaced by --primary

    const offenders: string[] = [];
    for (const file of collect("src")) {
      if (file.endsWith("color-tokens.ts")) continue; // the source of truth
      const content = readFileSync(file, "utf8");
      const arbitrary = /\[#[0-9a-fA-F]{3,8}(?:\/\d+)?\]/g;
      for (const match of content.matchAll(arbitrary)) {
        const hex = match[0]
          .replace("[#", "#")
          .split("/")[0]
          .toLowerCase();
        if (tokenHexes.has(hex)) {
          offenders.push(`${path.relative(rootDir, file)}: ${match[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
