import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import tailwindConfig from "../tailwind.config";
import {
  TYPOGRAPHY_FONTS,
  TYPOGRAPHY_SCALE,
  TYPOGRAPHY_TOKEN_FAMILIES,
  fontFamilyStack,
  type TypographyToken,
} from "@/lib/typography-tokens";

/**
 * Issue #614: Playfair Display + Plus Jakarta Sans + JetBrains Mono.
 *
 * Pins the Atelier Canvas typography system end to end:
 * - the token → family mapping and the 14-row scale in lib/typography-tokens
 * - the Tailwind fontFamily token map (generated from the same tables)
 * - the combined @utility token classes in globals.css (drift guard)
 * - font loading in layout.tsx (3 families + Material Symbols, Playfair italic)
 * - acceptance criterion "token classes, not raw font-family strings"
 */

const rootDir = fileURLToPath(new URL("..", import.meta.url));

function readProjectFile(relative: string): string {
  return readFileSync(path.join(rootDir, relative), "utf8");
}

function collectFiles(dir: string, extension: string): string[] {
  const absolute = path.join(rootDir, dir);
  const out: string[] = [];
  for (const entry of readdirSync(absolute)) {
    const entryPath = path.join(absolute, entry);
    if (statSync(entryPath).isDirectory()) {
      out.push(...collectFiles(path.join(dir, entry), extension));
    } else if (entry.endsWith(extension)) {
      out.push(entryPath);
    }
  }
  return out;
}

const TOKENS = Object.keys(TYPOGRAPHY_TOKEN_FAMILIES) as TypographyToken[];

describe("typography token tables — issue #614", () => {
  it("maps every token to the spec family", () => {
    const playfairTokens: TypographyToken[] = [
      "display-lg",
      "display-lg-mobile",
      "headline-lg",
      "headline-lg-mobile",
      "headline-md",
      "headline-sm",
    ];
    const jakartaTokens: TypographyToken[] = [
      "title-md",
      "title-sm",
      "body-lg",
      "body-md",
      "body-sm",
      "label-md",
      "label-sm",
    ];

    for (const token of playfairTokens) {
      expect(TYPOGRAPHY_TOKEN_FAMILIES[token]).toBe("playfair");
    }
    for (const token of jakartaTokens) {
      expect(TYPOGRAPHY_TOKEN_FAMILIES[token]).toBe("jakarta");
    }
    expect(TYPOGRAPHY_TOKEN_FAMILIES["code-inspector"]).toBe("jetbrains");
  });

  it("scale rows match the issue table (size / weight / line-height)", () => {
    expect(TYPOGRAPHY_SCALE["display-lg"]).toMatchObject({
      fontFamily: "playfair",
      fontSize: "3rem",
      lineHeight: "3.5rem",
      fontWeight: "600",
    });
    expect(TYPOGRAPHY_SCALE["headline-lg"]).toMatchObject({
      fontFamily: "playfair",
      fontSize: "2rem",
      lineHeight: "2.5rem",
      fontWeight: "500",
    });
    expect(TYPOGRAPHY_SCALE["headline-md"]).toMatchObject({
      fontFamily: "playfair",
      fontSize: "1.5rem",
      lineHeight: "2rem",
      fontWeight: "500",
    });
    expect(TYPOGRAPHY_SCALE["headline-sm"]).toMatchObject({
      fontFamily: "playfair",
      fontSize: "1.25rem",
      lineHeight: "1.75rem",
      fontWeight: "600",
    });
    expect(TYPOGRAPHY_SCALE["title-md"]).toMatchObject({
      fontFamily: "jakarta",
      fontSize: "1rem",
      lineHeight: "1.5rem",
      fontWeight: "600",
    });
    expect(TYPOGRAPHY_SCALE["title-sm"]).toMatchObject({
      fontFamily: "jakarta",
      fontSize: "0.875rem",
      lineHeight: "1.25rem",
      fontWeight: "600",
    });
    expect(TYPOGRAPHY_SCALE["body-lg"]).toMatchObject({
      fontFamily: "jakarta",
      fontSize: "1rem",
      lineHeight: "1.625rem",
      fontWeight: "400",
    });
    expect(TYPOGRAPHY_SCALE["body-md"]).toMatchObject({
      fontFamily: "jakarta",
      fontSize: "0.875rem",
      lineHeight: "1.375rem",
      fontWeight: "400",
    });
    expect(TYPOGRAPHY_SCALE["body-sm"]).toMatchObject({
      fontFamily: "jakarta",
      fontSize: "0.8125rem",
      lineHeight: "1.125rem",
      fontWeight: "400",
    });
    expect(TYPOGRAPHY_SCALE["label-md"]).toMatchObject({
      fontFamily: "jakarta",
      fontSize: "0.75rem",
      lineHeight: "1rem",
      fontWeight: "500",
    });
    expect(TYPOGRAPHY_SCALE["label-sm"]).toMatchObject({
      fontFamily: "jakarta",
      fontSize: "0.6875rem",
      lineHeight: "0.875rem",
      fontWeight: "600",
    });
    expect(TYPOGRAPHY_SCALE["code-inspector"]).toMatchObject({
      fontFamily: "jetbrains",
      fontSize: "0.75rem",
      lineHeight: "1rem",
      fontWeight: "400",
    });
  });

  it("mobile display/headline variants mirror their desktop tokens", () => {
    expect(TYPOGRAPHY_SCALE["display-lg-mobile"]).toEqual(TYPOGRAPHY_SCALE["display-lg"]);
    expect(TYPOGRAPHY_SCALE["headline-lg-mobile"]).toEqual(TYPOGRAPHY_SCALE["headline-lg"]);
  });

  it("font stacks reference the next/font variables minted in layout.tsx", () => {
    expect(TYPOGRAPHY_FONTS.playfair.varName).toBe("--font-playfair-google");
    expect(TYPOGRAPHY_FONTS.jakarta.varName).toBe("--font-jakarta-google");
    expect(TYPOGRAPHY_FONTS.jetbrains.varName).toBe("--font-jetbrains-google");
    expect(fontFamilyStack("code-inspector")).toContain("var(--font-jetbrains-google)");
    expect(fontFamilyStack("title-md")).toContain("var(--font-jakarta-google)");
    expect(fontFamilyStack("display-lg")).toContain("var(--font-playfair-google)");
  });
});

describe("tailwind.config fontFamily tokens — issue #614", () => {
  const fontFamily = (tailwindConfig.theme?.extend?.fontFamily ?? {}) as Record<string, string | string[]>;

  it("exposes a font utility for every typography token", () => {
    for (const token of TOKENS) {
      expect(fontFamily[token], `fontFamily.${token}`).toBeDefined();
    }
  });

  it("token font utilities resolve to the correct next/font variable", () => {
    for (const token of TOKENS) {
      const stack = fontFamily[token];
      const value = Array.isArray(stack) ? stack.join(",") : stack;
      const expectedVar = TYPOGRAPHY_FONTS[TYPOGRAPHY_TOKEN_FAMILIES[token]].varName;
      expect(value, `fontFamily.${token}`).toContain(expectedVar);
    }
  });

  it("mono/jetbrains aliases resolve to the JetBrains Mono variable", () => {
    const mono = Array.isArray(fontFamily.mono) ? fontFamily.mono.join(",") : fontFamily.mono;
    const jetbrains = Array.isArray(fontFamily.jetbrains)
      ? fontFamily.jetbrains.join(",")
      : fontFamily.jetbrains;
    expect(mono).toContain("var(--font-jetbrains-google)");
    expect(jetbrains).toContain("var(--font-jetbrains-google)");
  });

  it("never references the legacy undefined --font-plus-jakarta variable", () => {
    const serialized = JSON.stringify(tailwindConfig);
    expect(serialized).not.toContain("--font-plus-jakarta)");
  });
});

describe("globals.css token wiring — issue #614", () => {
  const css = readProjectFile("src/app/globals.css");

  it("defines a combined @utility for every typography token", () => {
    for (const token of TOKENS) {
      expect(css, `@utility ${token}`).toContain(`@utility ${token} {`);
    }
  });

  it("@utility values match the lib scale (drift guard)", () => {
    for (const token of TOKENS) {
      const row = TYPOGRAPHY_SCALE[token];
      const block = css.match(new RegExp(`@utility ${token} \\{([\\s\\S]*?)\\}`));
      expect(block, `@utility ${token} block`).not.toBeNull();
      const body = block?.[1] ?? "";
      expect(body).toContain(`font-size: ${row.fontSize};`);
      expect(body).toContain(`line-height: ${row.lineHeight};`);
      expect(body).toContain(`font-weight: ${row.fontWeight};`);
      expect(body).toContain(TYPOGRAPHY_FONTS[row.fontFamily].varName);
    }
  });

  it("aliases the four font variables on :root so var() consumers resolve", () => {
    for (const font of Object.values(TYPOGRAPHY_FONTS)) {
      const alias = font.varName.replace("-google", "");
      expect(css).toContain(`${alias}: var(${font.varName});`);
    }
  });

  it("no longer contains the self-referential --font-sans assignment", () => {
    expect(css).not.toContain("--font-sans: var(--font-sans)");
  });

  it("keeps Material Symbols variation settings per the spec", () => {
    expect(css).toMatch(/font-variation-settings:\s*"FILL" 0,\s*"wght" 400,\s*"GRAD" 0,\s*"opsz" 20/);
  });
});

describe("font loading in layout.tsx — issue #614", () => {
  const layout = readProjectFile("src/app/layout.tsx");

  it("loads the three families via next/font", () => {
    expect(layout).toContain("Playfair_Display");
    expect(layout).toContain("Plus_Jakarta_Sans");
    expect(layout).toContain("JetBrains_Mono");
  });

  it("loads the Playfair italic axis for editorial copy", () => {
    expect(layout).toContain('style: ["normal", "italic"]');
  });

  it("loads Material Symbols Outlined from Google Fonts", () => {
    expect(layout).toContain("family=Material+Symbols+Outlined");
  });
});

describe("components use token classes, not raw font-family strings — issue #614", () => {
  it("has no inline fontFamily styles in any component", () => {
    const offenders = collectFiles("src/components", ".tsx")
      .filter((file) => readFileSync(file, "utf8").includes("fontFamily:"))
      .map((file) => path.relative(rootDir, file));
    expect(offenders).toEqual([]);
  });

  it("has no dangling --font-plus-jakarta references under src/", () => {
    const offenders = collectFiles("src", ".tsx")
      .concat(collectFiles("src", ".ts"), collectFiles("src", ".css"))
      .filter((file) => readFileSync(file, "utf8").includes("var(--font-plus-jakarta"))
      .map((file) => path.relative(rootDir, file));
    expect(offenders).toEqual([]);
  });
});
