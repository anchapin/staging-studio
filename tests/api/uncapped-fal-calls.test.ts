/**
 * Issue #1105: a paid fal.ai call must never be reachable without a daily cap.
 *
 * `POST /api/segment` shipped an uncapped `fal.subscribe` on the legacy
 * `fal-ai/sam` model: it imported nothing from `@/lib/api-quota`, so a
 * loop of authenticated POSTs produced unbounded spend that was invisible
 * to `DailyApiUsage` and to the 100/day `segment` cap. No client ever
 * called it, so it was deleted rather than gated.
 *
 * The regression that let it through was a *test* gap: nothing asserted the
 * cap applied to that route, so deleting it alone would leave the same hole
 * reopenable.
 *
 * Scope — what this guard does and does not prove:
 * - The generic rule flags any route that *itself* invokes a paid fal
 *   helper. That is precisely the #1105 shape, and it has no false
 *   positives: a route that calls fal on the request path always needs a cap.
 * - The transitive case (a route spending fal through a lib helper, e.g.
 *   `api/inpaint` -> `lib/inpaint-submit`) is covered by pinned assertions
 *   rather than by import-graph reachability, on purpose: `pollFalStatus`
 *   makes a NON-billable status call, so walking the import graph flags
 *   polling routes that share the chain and are already governed by their
 *   own rate limit. Reachability is therefore too coarse to be an oracle.
 * - Route discovery is from disk, so a newly added uncapped route fails
 *   here rather than waiting to be found by a cost incident.
 *
 * Pure guard logic lives in `src/lib/fal-spend-guard.ts`.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  FAL_SPEND_CALL,
  QUOTA_ENFORCEMENT,
  LEGACY_SAM_MODEL,
  stripComments,
  discoverApiRoutes,
  repoRelative,
} from "@/lib/fal-spend-guard";

// Resolved from this file rather than process.cwd() so the guard holds however
// vitest is invoked (mirrors tests/api/v1-version-header.test.ts).
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const API_ROOT = path.join(REPO_ROOT, "src", "app", "api");

/** Routes that spend fal money today. Pinned individually below. */
const PAID_INFERENCE_ROUTES = [
  "src/app/api/segment/furnishings/route.ts",
  "src/app/api/inpaint/route.ts",
];

const apiRoutes = discoverApiRoutes(API_ROOT);

/** Routes that call a paid fal helper directly, comments excluded. */
const directFalCallers = apiRoutes.filter((file) =>
  FAL_SPEND_CALL.test(stripComments(readFileSync(file, "utf8")))
);

describe("no uncapped fal.ai calls (#1105)", () => {
  it("discovers routes from disk — the scan cannot pass vacuously", () => {
    // Guards the guards: if the walk matched nothing, the describe.each
    // below would expand to zero cases and pass without checking a file.
    expect(apiRoutes.length).toBeGreaterThan(10);
    expect(directFalCallers.map((f) => repoRelative(f, REPO_ROOT))).toContain(
      "src/app/api/segment/furnishings/route.ts"
    );
  });

  it("the deleted legacy /api/segment route is gone", () => {
    expect(existsSync(path.join(API_ROOT, "segment", "route.ts"))).toBe(false);
  });

  it("the legacy fal-ai/sam model no longer appears in src/ (retirement, #236)", () => {
    // Every src file, so a re-introduced legacy model fails here even if it
    // is reached through a different route or a lib helper. Comments are
    // stripped so the inference-abstraction adapter (which mentions
    // the legacy id in a docstring explaining the retirement) does not
    // false-positive.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (/\.(ts|tsx)$/.test(entry)) {
          if (LEGACY_SAM_MODEL.test(stripComments(readFileSync(full, "utf8")))) {
            offenders.push(repoRelative(full, REPO_ROOT));
          }
        }
      }
    };
    walk(path.join(REPO_ROOT, "src"));
    expect(offenders).toEqual([]);
  });

  describe.each(directFalCallers.map((file) => [repoRelative(file, REPO_ROOT), file] as const))(
    "%s",
    (_label, file) => {
      it("calls fal on the request path — so it must enforce a daily quota", () => {
        const source = stripComments(readFileSync(file, "utf8"));
        expect(
          QUOTA_ENFORCEMENT.test(source),
          `${repoRelative(file, REPO_ROOT)} calls a paid fal.ai helper but imports no quota ` +
            `enforcement (checkDailyQuota / evaluateDailyQuota / ` +
            `evaluateDailyBatchQuota). Add the cap as ` +
            `src/app/api/segment/furnishings/route.ts does — or delete the route if ` +
            `no client calls it. This is the exact shape of #1105.`
        ).toBe(true);
      });
    }
  );

  describe.each(PAID_INFERENCE_ROUTES)("%s", (relative) => {
    it("still exists and enforces a daily quota (pinned spend surface)", () => {
      const file = path.join(REPO_ROOT, relative);
      expect(existsSync(file), `${relative} no longer exists — update the pin list`).toBe(
        true
      );
      const source = readFileSync(file, "utf8");
      expect(
        QUOTA_ENFORCEMENT.test(source),
        `${relative} spends fal.ai money but no longer enforces a daily quota.`
      ).toBe(true);
    });
  });
});
