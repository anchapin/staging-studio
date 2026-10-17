/**
 * Issue #1131: a daily cap must never be derived from a DELETABLE table.
 *
 * `DAILY_INPAINT_LIMIT` was enforced by counting today's `InpaintRequest`
 * rows. Those rows cascade-delete with their room (`prisma/schema.prisma`),
 * and `deleteRoom` is an ordinary owner-facing action, so deleting the
 * rooms staged today dropped the count to zero and handed the user their
 * whole cap back — repeatably, for free. Every surface is now metered on a
 * `DailyApiUsage` counter row, which is not a child of any user content.
 *
 * Deleting `inpaintDailyUsageWhere` alone would leave the hole trivially
 * reopenable, so this file pins the three properties that close it:
 *
 *  1. Behaviour: the cap is read from the counter and is NOT moved by
 *     `InpaintRequest` rows appearing or vanishing (the refund itself).
 *  2. Code: nothing in `src/` counts `InpaintRequest` rows again, and
 *     every file that reads the inpaint cap reads the counter — not an
 *     import, a CALL, per the #1105 lesson.
 *  3. Schema: `DailyApiUsage` has no relation to any deletable row, so no
 *     delete in the app can cascade a charge away in the first place. A
 *     future `user User @relation(..., onDelete: Cascade)` would reopen
 *     the hole for a deleted account and fails here.
 *
 * Verified against a reinstated bug (see the issue's test notes): the code
 * and schema checks each fail when the row-count derivation is put back.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC_ROOT = path.join(REPO_ROOT, "src");
const SCHEMA_PATH = path.join(REPO_ROOT, "prisma", "schema.prisma");

/** Every `.ts`/`.tsx` file under `src/`, recursively. */
function collectSourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...collectSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

/** Path relative to the repo root, for stable assertion messages. */
function repoRelative(file: string): string {
  return path.relative(REPO_ROOT, file);
}

const sourceFiles = collectSourceFiles(SRC_ROOT);

/** Strips comments so prose naming a pattern is not matched as code. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// ---------------------------------------------------------------------------
// 1. Behaviour — the cap ignores deletable rows
// ---------------------------------------------------------------------------

vi.mock("@/lib/prisma", () => ({
  prisma: {
    dailyApiUsage: { findUnique: vi.fn(), upsert: vi.fn() },
    inpaintRequest: { count: vi.fn() },
  },
}));

// Imported after the mock so the real api-quota ledger code is what runs.
const { checkDailyQuota } = await import("@/lib/inpaint-submit");
const { prisma } = await import("@/lib/prisma");

const findUsage = vi.mocked(prisma.dailyApiUsage.findUnique);
const countRows = vi.mocked(prisma.inpaintRequest.count);
const userId = "user_quota_ledger";

beforeEach(() => {
  vi.clearAllMocks();
  findUsage.mockResolvedValue(null);
  countRows.mockResolvedValue(0);
});

describe("inpaint cap is a ledger, not a row count (#1131)", () => {
  it("blocks at the limit with ZERO InpaintRequest rows — a deleted room cannot refund", async () => {
    // The refund state exactly: the counter says the user is at the cap
    // (today's submits were charged) and the rooms those submits wrote rows
    // into are gone, so the derived count would be 0.
    findUsage.mockResolvedValue({ count: 20 } as never);
    countRows.mockResolvedValue(0);

    const result = await checkDailyQuota(userId);

    expect(result.allowed).toBe(false);
    expect(result.currentUsage).toBe(20);
    expect(result.dailyLimit).toBe(20);
  });

  it("allows below the limit even when InpaintRequest rows are at the limit", async () => {
    // The converse: rows are NOT the signal. If a re-derivation were
    // reinstated this would block, and the user could never submit again.
    findUsage.mockResolvedValue({ count: 1 } as never);
    countRows.mockResolvedValue(99);

    const result = await checkDailyQuota(userId);

    expect(result.allowed).toBe(true);
    expect(result.currentUsage).toBe(1);
    expect(countRows).not.toHaveBeenCalled();
  });

  it("reads the counter for the `inpaint` surface of that user", async () => {
    await checkDailyQuota(userId);

    expect(findUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_surface_dayKey: expect.objectContaining({
            userId,
            surface: "inpaint",
          }),
        },
      })
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Code — no derivation is reintroduced in src/
// ---------------------------------------------------------------------------

describe("no src file derives a daily cap from deletable rows", () => {
  it("the scan is not vacuous", () => {
    expect(sourceFiles.length).toBeGreaterThan(50);
    expect(
      sourceFiles.some((f) => repoRelative(f).endsWith("lib/inpaint-submit.ts"))
    ).toBe(true);
  });

  it("nothing in src/ counts InpaintRequest rows", () => {
    const offenders = sourceFiles
      .filter((file) => /inpaintRequest\s*\.\s*count\b/.test(stripComments(readFileSync(file, "utf8"))))
      .map(repoRelative);

    expect(
      offenders,
      `These files derive usage from InpaintRequest rows, which cascade-delete ` +
        `with the room, so deleting a room refunds the cap (#1131). Read the ` +
        `DailyApiUsage counter via getDailyUsage("inpaint", userId) instead.`
    ).toEqual([]);
  });

  it("every file that reads the inpaint cap reads the counter", () => {
    // A *consumption* pattern, not a mention: `process.env[DAILY_LIMIT_ENV_VAR.inpaint]`
    // (or a direct env read) is what a cap reader does. Matching the bare
    // constant name would also match `lib/api-quota.ts`, which only
    // DEFINES the limit and the generic counter helpers.
    const capReader = /DAILY_LIMIT_ENV_VAR\s*\.\s*inpaint|process\.env\s*\.\s*DAILY_INPAINT_LIMIT/;
    const capReaders = sourceFiles.filter((file) =>
      capReader.test(stripComments(readFileSync(file, "utf8")))
    );

    // A cap reader that never calls getDailyUsage has to be deriving usage
    // from somewhere else. Asserted per file so the message names it.
    for (const file of capReaders) {
      const source = stripComments(readFileSync(file, "utf8"));
      expect(
        /getDailyUsage\s*\(\s*["']inpaint["']/.test(source),
        `${repoRelative(file)} reads the inpaint cap but does not call ` +
          `getDailyUsage("inpaint", …) — a CALL, not an import: an imported ` +
          `but uncalled helper is not enforcement (#1105).`
      ).toBe(true);
    }
    // And the set is not empty, which would make the loop above vacuous.
    expect(capReaders.map(repoRelative).sort()).toEqual([
      "src/app/api/v1/inpaint/[requestId]/route.ts",
      "src/app/api/v1/inpaint/route.ts",
      "src/lib/inpaint-submit.ts",
    ]);
  });

  it("the submit path charges the ledger — a cap nobody writes is not a cap", () => {
    // The read side alone would pass everything above while leaving every
    // submit free, so the charge is pinned explicitly: it must happen in
    // the submit orchestrator, not at the route (the route would miss the
    // #688 degraded path and any future caller).
    const submitLib = path.join(SRC_ROOT, "lib", "inpaint-submit.ts");
    const source = stripComments(readFileSync(submitLib, "utf8"));

    expect(source).toMatch(/recordDailyUsage\s*\(\s*["']inpaint["']/);
    const apiRoute = stripComments(
      readFileSync(path.join(SRC_ROOT, "app", "api", "inpaint", "route.ts"), "utf8")
    );
    expect(apiRoute, "the unversioned inpaint route must not own the charge").not.toMatch(
      /recordDailyUsage\s*\(\s*["']inpaint["']/
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Schema — the counter row is not a child of anything deletable
// ---------------------------------------------------------------------------

/** Extracts one Prisma `model` block, braces balanced. */
function modelBlock(modelName: string): string {
  const schema = readFileSync(SCHEMA_PATH, "utf8");
  const start = schema.indexOf(`model ${modelName} {`);
  if (start === -1) throw new Error(`model ${modelName} not found in schema.prisma`);
  let depth = 0;
  for (let i = schema.indexOf("{", start); i < schema.length; i += 1) {
    if (schema[i] === "{") depth += 1;
    if (schema[i] === "}") {
      depth -= 1;
      if (depth === 0) return schema.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces for model ${modelName}`);
}

describe("DailyApiUsage cannot be cascade-deleted (#1131)", () => {
  const block = modelBlock("DailyApiUsage");

  it("declares no foreign key at all", () => {
    // A relation is the only way a DELETE elsewhere can reach this row. The
    // current model uses a bare `userId String`, which is the point.
    expect(block, "DailyApiUsage gained a relation; make sure it cannot cascade").not.toMatch(
      /onDelete/
    );
    expect(block).not.toMatch(
      /^\s*(user|room|project|inpaintRequest|inpaintVersion)\s+[A-Z]\w*\s+@relation/m
    );
  });

  it("the InpaintRequest model still cascades on room delete (why the derivation had to go)", () => {
    // Pins the reason this guard exists: if the cascade ever disappears the
    // comment/issue reference goes stale and this test says why.
    expect(modelBlock("InpaintRequest")).toMatch(
      /room\s+Room\s+@relation\([^)]*onDelete:\s*Cascade/
    );
  });
});
