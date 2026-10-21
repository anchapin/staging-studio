/**
 * API-route auth-coverage regression test (issue #1419).
 *
 * Why: every mutation route must reach an auth check before doing
 * anything privileged. This test keeps an inventory of mutating
 * handlers and asserts each one's first 80 lines reaches one of three
 * recognised seams:
 *
 *   1. `getAuthedPrismaUser` (the canonical lib/seam call)
 *   2. `verifyWebhookSignature` (the webhook signature verifier for
 *      trusted-provider callbacks)
 *   3. `supabase.auth.getUser` (the bare-session check used by the
 *      /api/setup/* bootstrap surface that runs before a Prisma `User`
 *      row exists)
 *
 * For routes that delegate to a service module (currently just
 * `runExportPdf`), the test pins the indirection by reading the service
 * file and asserting it too reaches `getAuthedPrismaUser`. If a future
 * contributor swaps a route's auth seam without updating the inventory,
 * the test fails loudly — silent mutations are exactly the bug this
 * test is here to keep out.
 *
 * Adding a mutating route? Add a row here AND make sure the route
 * itself reaches one of the seams below in its first 80 lines. Do NOT
 * weaken the assertion or extend the allowlist to "skip" — the
 * inventory is the contract.
 *
 * Read-only GETs (status polling, /setup/check, /debug-preview-check,
 * /projects/[id]) are not in the inventory: they may or may not enforce
 * auth (middleware + page-level guards apply separately). The intent is
 * to pin mutations specifically.
 */
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

type AuthSeamKind =
  | "direct-getAuthedPrismaUser"
  | "service-with-internal-auth"
  | "webhook-signature"
  | "setup-bootstrap-supabase"
  | "proxy-with-auth-forwarding";

interface RouteEntry {
  readonly label: string;
  readonly path: string;
  readonly method: "POST" | "PATCH" | "PUT" | "DELETE";
  readonly seam: AuthSeamKind;
  /**
   * The literal identifier the route's first 80 lines (or service's body)
   * must contain.
   */
  readonly seamIdentifier: string;
  /**
   * When `seam === "service-with-internal-auth"`, the service module path
   * the route delegates to. Used by the test to verify the service
   * actually owns the auth check.
   */
  readonly serviceFile?: string;
  /**
   * When `seam === "proxy-with-auth-forwarding"`, the destination route
   * that owns the auth check (e.g. an unversioned route the v1 proxy
   * forwards to). Used by the test to confirm the destination enforces
   * auth itself.
   */
  readonly proxiedRoute?: string;
}

/**
 * Allow-list of mutation routes. Mutate this list when adding a new route
 * — never silence the test by removing an entry.
 */
const ROUTE_INVENTORY: ReadonlyArray<RouteEntry> = [
  // Unversioned surface -------------------------------------------------
  {
    label: "/api/export-pdf POST delegates to runExportPdf service",
    path: "src/app/api/export-pdf/route.ts",
    method: "POST",
    seam: "service-with-internal-auth",
    seamIdentifier: "runExportPdf",
    serviceFile: "src/lib/export-pdf-service.ts",
  },
  {
    label: "/api/generate-copy POST delegates to runGenerateCopy service",
    path: "src/app/api/generate-copy/route.ts",
    method: "POST",
    seam: "service-with-internal-auth",
    seamIdentifier: "runGenerateCopy",
    serviceFile: "src/lib/generate-copy-service.ts",
  },
  {
    label: "/api/inpaint POST reaches getAuthedPrismaUser",
    path: "src/app/api/inpaint/route.ts",
    method: "POST",
    seam: "direct-getAuthedPrismaUser",
    seamIdentifier: "getAuthedPrismaUser",
  },
  {
    label: "/api/inpaint/webhook POST uses webhook signature",
    path: "src/app/api/inpaint/webhook/route.ts",
    method: "POST",
    seam: "webhook-signature",
    seamIdentifier: "verifyWebhookSignature",
  },
  {
    label: "/api/label-instances POST reaches getAuthedPrismaUser",
    path: "src/app/api/label-instances/route.ts",
    method: "POST",
    seam: "direct-getAuthedPrismaUser",
    seamIdentifier: "getAuthedPrismaUser",
  },
  {
    label: "/api/lookbook-variant POST reaches getAuthedPrismaUser",
    path: "src/app/api/lookbook-variant/route.ts",
    method: "POST",
    seam: "direct-getAuthedPrismaUser",
    seamIdentifier: "getAuthedPrismaUser",
  },
  {
    label: "/api/projects POST reaches getAuthedPrismaUser",
    path: "src/app/api/projects/route.ts",
    method: "POST",
    seam: "direct-getAuthedPrismaUser",
    seamIdentifier: "getAuthedPrismaUser",
  },
  {
    label: "/api/projects/[id]/rooms/[roomId] PATCH reaches getAuthedPrismaUser",
    path: "src/app/api/projects/[id]/rooms/[roomId]/route.ts",
    method: "PATCH",
    seam: "direct-getAuthedPrismaUser",
    seamIdentifier: "getAuthedPrismaUser",
  },
  {
    label: "/api/segment/furnishings POST reaches getAuthedPrismaUser",
    path: "src/app/api/segment/furnishings/route.ts",
    method: "POST",
    seam: "direct-getAuthedPrismaUser",
    seamIdentifier: "getAuthedPrismaUser",
  },
  {
    label: "/api/setup POST uses supabase.auth.getUser (bootstrap)",
    path: "src/app/api/setup/route.ts",
    method: "POST",
    seam: "setup-bootstrap-supabase",
    seamIdentifier: "supabase.auth.getUser",
  },
  {
    label: "/api/sign-project POST reaches getAuthedPrismaUser",
    path: "src/app/api/sign-project/route.ts",
    method: "POST",
    seam: "direct-getAuthedPrismaUser",
    seamIdentifier: "getAuthedPrismaUser",
  },

  // /api/v1 surface (versioned, contract-pinned) -----------------------
  {
    label: "/api/v1/export-pdf POST reaches getAuthedPrismaUser",
    path: "src/app/api/v1/export-pdf/route.ts",
    method: "POST",
    seam: "direct-getAuthedPrismaUser",
    seamIdentifier: "getAuthedPrismaUser",
  },
  {
    label: "/api/v1/generate-copy POST reaches getAuthedPrismaUser",
    path: "src/app/api/v1/generate-copy/route.ts",
    method: "POST",
    seam: "direct-getAuthedPrismaUser",
    seamIdentifier: "getAuthedPrismaUser",
  },
  {
    label: "/api/v1/inpaint POST reaches getAuthedPrismaUser",
    path: "src/app/api/v1/inpaint/route.ts",
    method: "POST",
    seam: "direct-getAuthedPrismaUser",
    seamIdentifier: "getAuthedPrismaUser",
  },
  {
    label: "/api/v1/listing-copy POST reaches getAuthedPrismaUser",
    path: "src/app/api/v1/listing-copy/route.ts",
    method: "POST",
    seam: "direct-getAuthedPrismaUser",
    seamIdentifier: "getAuthedPrismaUser",
  },
  {
    label: "/api/v1/segment POST reaches getAuthedPrismaUser",
    path: "src/app/api/v1/segment/route.ts",
    method: "POST",
    seam: "direct-getAuthedPrismaUser",
    seamIdentifier: "getAuthedPrismaUser",
  },
  {
    label: "/api/v1/segment/furnishings POST reaches getAuthedPrismaUser",
    path: "src/app/api/v1/segment/furnishings/route.ts",
    method: "POST",
    seam: "direct-getAuthedPrismaUser",
    seamIdentifier: "getAuthedPrismaUser",
  },
  {
    label: "/api/v1/sign-project POST proxies auth to /api/sign-project",
    path: "src/app/api/v1/sign-project/route.ts",
    method: "POST",
    seam: "proxy-with-auth-forwarding",
    seamIdentifier: "fetch",
    proxiedRoute: "src/app/api/sign-project/route.ts",
  },
];

const REPO_ROOT = join(__dirname, "..");

async function readWhole(path: string): Promise<string> {
  return readFile(join(REPO_ROOT, path), "utf8");
}

describe("issue #1419: every mutation route reaches an auth seam", () => {
  it("inventory entries point to existing files (typo guard)", async () => {
    const missing: string[] = [];
    for (const entry of ROUTE_INVENTORY) {
      try {
        await readFile(join(REPO_ROOT, entry.path), "utf8");
      } catch {
        missing.push(entry.path);
      }
    }
    expect(missing, `missing files: ${missing.join(", ")}`).toEqual([]);
  });

  it.each(ROUTE_INVENTORY)(
    "$label",
    async (entry) => {
      const source = await readWhole(entry.path);

      const exportMatch = source.match(
        new RegExp(
          `^export\\s+(?:async\\s+)?(?:function|const)\\s+${entry.method}\\b`,
          "m",
        ),
      );
      expect(
        exportMatch,
        `${entry.path} must export method ${entry.method} (typo in path or method?)`,
      ).not.toBeNull();

      // The auth seam must be reached within the first 80 lines (or as
      // early as possible in the wrapper for delegated routes). We scan
      // that head rather than the whole file because auth should fire
      // BEFORE any side-effects — a seam that appears at line 200 is too
      // late.
      const head = source.split("\n").slice(0, 80).join("\n");
      expect(
        head.includes(entry.seamIdentifier),
        `${entry.path} must reach the auth seam (${entry.seamIdentifier}) in its first 80 lines — ` +
          `silent mutations are exactly what this regression test is here to keep out. ` +
          `If the seam has legitimately moved, update ROUTE_INVENTORY — do NOT remove this entry.`,
      ).toBe(true);

      // For delegated routes, follow the indirection: assert the
      // service module contains the canonical auth seam so a future
      // refactor that strips the check from the route's perspective
      // still surfaces here.
      if (
        entry.seam === "service-with-internal-auth" &&
        entry.serviceFile
      ) {
        const importMatch = source.match(
          new RegExp(
            `import\\s+(?:[^"';]+?\\s+from\\s+)?["']([^"']+)["']`,
            "g",
          ),
        );
        const importPaths = (importMatch ?? [])
          .map((m) => m.match(/["']([^"']+)["']/)![1])
          .filter((p) => !p.startsWith("node:"));
        const matches = importPaths.some((p) => {
          // Accept either the literal `serviceFile` path, the bare
          // `./foo`-style import, or the `@/lib/foo` aliased import
          // (the alias maps to `src/lib/` per tsconfig).
          const literal = entry.serviceFile!.replace(/^\.\//, "");
          const withoutExt = literal.replace(/\.ts$/, "");
          const libAlias = `@/lib/${withoutExt.replace(/^src\/lib\//, "")}`;
          return (
            p === literal ||
            p === `./${withoutExt}` ||
            p === withoutExt ||
            p === libAlias
          );
        });
        expect(
          matches,
          `${entry.path} must import ${entry.serviceFile} (or the equivalent @/lib/ alias)`,
        ).toBe(true);

        const serviceSource = await readFile(
          join(REPO_ROOT, entry.serviceFile),
          "utf8",
        );

        expect(
          serviceSource.includes("getAuthedPrismaUser"),
          `${entry.serviceFile} (delegated to from ${entry.path}) must reach getAuthedPrismaUser — ` +
            `otherwise the auth boundary is invisible to a future route reviewer.`,
        ).toBe(true);
      }

      // For proxy routes, assert the destination route enforces auth.
      // The proxy itself does NOT call getAuthedPrismaUser — that's
      // intentional, the auth lives at the destination. But if the
      // destination ever weakens, this test fails too.
      if (
        entry.seam === "proxy-with-auth-forwarding" &&
        entry.proxiedRoute
      ) {
        const destSource = await readFile(
          join(REPO_ROOT, entry.proxiedRoute),
          "utf8",
        );
        expect(
          destSource.includes("getAuthedPrismaUser") ||
            destSource.includes("runExportPdf"),
          `${entry.proxiedRoute} (proxied to from ${entry.path}) must reach an auth seam — ` +
            `otherwise the v1 surface silently bypasses the auth check.`,
        ).toBe(true);
      }
    },
  );
});
