import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Issue #693: tautology-test sanity guard.
 *
 * Every tests/*.test.ts must import at least one real module — either a
 * production module (`@/…` alias or a relative path into `src/`) or a
 * local helper file that exists on disk. A test whose only imports are
 * `vitest` and Node built-ins re-asserts its own inline literals: it
 * passes even when the production code it claims to cover is deleted,
 * which is exactly the doc-only tautology pattern #693 removed.
 *
 * This also enforces the "no hard-coded hex duplicating
 * lib/color-tokens.ts" criterion in practice: a test that self-asserts
 * hex literals instead of importing the real token module fails the
 * import check (tests that legitimately pin hex values, e.g.
 * color-tokens.test.ts and moodboard-themes.test.ts, import the real
 * modules that own those values).
 *
 * The guard file itself is excluded (it imports only fs/path/vitest by
 * design — its subject IS the tests directory).
 */

/** Test files that legitimately import no module, with the reason each is pending removal. */
const ALLOWED_NO_MODULE_IMPORTS: readonly Record<string, string>[] = [
  // Tautology test owned by sibling issue #694 (mask undo-stack
  // extraction). Remove this entry when #694 lands its real pin.
  { "inpaint-undo.test.ts": "pending #694 — extract mask undo-stack module" },
];

const TESTS_DIR = path.dirname(new URL(import.meta.url).pathname);
const SELF_NAME = path.basename(new URL(import.meta.url).pathname);

function extractImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const staticImports = source.matchAll(/\bfrom\s*["']([^"']+)["']/g);
  for (const match of staticImports) specifiers.push(match[1]);
  const dynamicImports = source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g);
  for (const match of dynamicImports) specifiers.push(match[1]);
  return specifiers;
}

function isNodeBuiltin(specifier: string): boolean {
  return specifier.startsWith("node:") || specifier === "fs" || specifier === "path";
}

function resolvesToLocalModule(specifier: string, fromDir: string): boolean {
  if (!specifier.startsWith(".")) return false;
  const base = path.resolve(fromDir, specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    path.join(base, "index.ts"),
  ];
  return candidates.some((candidate) => existsSync(candidate));
}

function importsARealModule(source: string, fromDir: string): boolean {
  return extractImportSpecifiers(source).some((specifier) => {
    if (specifier === "vitest" || isNodeBuiltin(specifier)) return false;
    if (specifier.startsWith("@/")) return true;
    if (specifier.startsWith(".")) return resolvesToLocalModule(specifier, fromDir);
    // Bare npm packages and type-only hosts are not repo production modules.
    return false;
  });
}

describe("tautology sanity guard — issue #693", () => {
  it("every unit test file imports at least one real module", () => {
    const testFiles = readdirSync(TESTS_DIR).filter(
      (name) => name.endsWith(".test.ts") && name !== SELF_NAME
    );
    expect(testFiles.length).toBeGreaterThan(0);

    const whitelisted = new Set(
      ALLOWED_NO_MODULE_IMPORTS.flatMap((entry) => Object.keys(entry))
    );
    const offenders: string[] = [];

    for (const name of testFiles) {
      const source = readFileSync(path.join(TESTS_DIR, name), "utf8");
      if (!importsARealModule(source, TESTS_DIR) && !whitelisted.has(name)) {
        offenders.push(name);
      }
    }

    expect(
      offenders,
      `tests/*.test.ts that import zero real modules (tautology risk, see #693): ${offenders.join(", ")}. ` +
        "Import the production module (extract pure logic to src/lib first if needed) or delete the test."
    ).toEqual([]);
  });

  it("whitelist entries must still exist and still import no module", () => {
    for (const entry of ALLOWED_NO_MODULE_IMPORTS) {
      const [name, reason] = Object.entries(entry)[0];
      const filePath = path.join(TESTS_DIR, name);
      expect(existsSync(filePath), `${name} (${reason}) no longer exists — remove its whitelist entry`).toBe(true);
      if (!existsSync(filePath)) continue;
      const source = readFileSync(filePath, "utf8");
      expect(
        importsARealModule(source, TESTS_DIR),
        `${name} now imports a real module — remove its whitelist entry (${reason})`
      ).toBe(false);
    }
  });
});
