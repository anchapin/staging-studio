/**
 * Issue #1105: a paid fal.ai call must never be reachable without a daily cap.
 *
 * `POST /api/segment` shipped an uncapped `fal.subscribe` on the legacy
 * SAM model: it imported nothing from `@/lib/api-quota`, so a
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
 */

import { readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * A paid inference call made by a route. Comments are stripped before
 * matching so prose that *names* `fal.subscribe` (see
 * `lib/furnishing-detection.ts`) is not counted as a call site. The
 * helpers are matched WITHOUT requiring a trailing paren on purpose:
 * the #1105 route did `const falSubscribe = fal.subscribe as …;` and
 * then called the alias, which a call-shaped pattern would not match.
 *
 * After the inference abstraction (#1187 follow-up) routes go
 * through `inference.subscribe` / `inference.submit` on the active
 * `InferenceClient` — the spend-guard matches those calls by name.
 * The legacy `falSubscribeWithCircuitBreaker` /
 * `falQueueSubmitWithCircuitBreaker` patterns stay in the regex so
 * a rollback or a direct-fal call (e.g. a half-merged PR) still
 * trips the guard.
 */
export const FAL_SPEND_CALL =
  /falSubscribeWithCircuitBreaker\b|falQueueSubmitWithCircuitBreaker\b|(?:^|[^.\w])fal\s*\.\s*subscribe\b|inference\.(?:subscribe|submit)\b/;

/**
 * Every real entry point into the daily-cap machinery in `lib/api-quota`.
 * The trailing paren is required: an import that is never *called* is not
 * enforcement, and matching the bare name let an unused import satisfy this
 * guard.
 */
export const QUOTA_ENFORCEMENT =
  /checkDailyQuota\s*\(|evaluateDailyQuota\s*\(|evaluateDailyBatchQuota\s*\(/;

/**
 * The legacy model id, matched exactly. The current SAM 3.1 endpoint
 * (image model) *starts with* this string, so a bare substring test
 * would false-positive on every correct usage.
 *
 * Built from char codes so the literal pattern does not appear in source; the
 * legacy-model scanner walks all src files and would otherwise self-flag.
 */
function _buildLegacySamModel(): RegExp {
  // f=102 a=97 l=108 -=45 a=97 i=105 /=47 s=115 a=97 m=109
  const c = String.fromCharCode;
  const legacyModel =
    c(102) + c(97) + c(108) + c(45) + c(97) + c(105) + c(47) + c(115) + c(97) + c(109);
  // Negative lookahead: the live SAM 3.1 endpoint id is
  // `fal-ai/sam-3-1/image`, which begins with the legacy string. The
  // active model has a `-3-1/image` suffix (note the dash, not a
  // bracket — this comment used to be wrong; the char-codes below
  // are `-`, `3`, `-`, `1`, `/`, `i`, `m`, `a`, `g`, `e`).
  // (91, 93 are `[` `]`, never used.) Reject when the legacy string
  // is followed by `-3-1/image`.
  const activeSuffix =
    c(45) + c(51) + c(45) + c(49) + c(47) + c(105) + c(109) + c(97) + c(103) + c(101);
  return new RegExp(legacyModel + "(?!" + activeSuffix + ")");
}
export const LEGACY_SAM_MODEL = _buildLegacySamModel();

export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Recursively collects every `route.ts` under the API tree, from disk. */
export function discoverApiRoutes(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...discoverApiRoutes(full));
    } else if (entry === "route.ts") {
      found.push(full);
    }
  }
  return found;
}

/** Path relative to the repo root, for stable assertion messages. */
export function repoRelative(file: string, repoRoot: string): string {
  return path.relative(repoRoot, file);
}
