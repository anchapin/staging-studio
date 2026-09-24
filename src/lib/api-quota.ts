/**
 * Daily per-user cost/quota guardrails for the paid-API surfaces
 * (issue #201): fal.ai inpainting, OpenAI copy generation, OpenAI
 * vision label instances (issue #263), Browserless PDF export, and
 * fal.ai SAM 3.1 segmentation (issue #226).
 *
 * Mechanism per surface:
 * - `inpaint` (fal.ai): every successful queue submit already persists an
 *   `InpaintRequest` row (`createdAt` is set by Prisma), so today's usage
 *   is derived by COUNTING those rows for the user — no schema change, and
 *   the count survives serverless cold starts because it lives in Postgres.
 *   Known small race: a request that is in flight concurrently (submitted
 *   but its row not yet written) is not counted, so the cap can be
 *   overshot by in-flight submissions. Acceptable for a guardrail, not an
 *   accounting ledger.
 * - `copy`, `export`, `segment`, `label` (OpenAI + Browserless + fal.ai
 *   SAM 3.1): tracked via the `DailyApiUsage` Postgres table using
 *   atomic upserts — survives serverless cold starts and multi-instance
 *   traffic splitting (issue #784).
 *
 * Window semantics: a "day" is the server-local calendar day (local
 * midnight → next local midnight, wall clock of the machine running the
 * route). On UTC-based hosts (e.g. Vercel) that is the UTC day.
 *
 * Ballpark spend baseline at the default limits (approximate list prices,
 * Sep 2026 — re-check before relying on these):
 * - fal.ai FLUX.1 Fill: ~$0.02–0.03/image → 20/day ≈ $0.60/day max
 * - OpenAI gpt-4o-mini copy generation: ~$0.0002/generation → 50/day
 *   ≈ $0.01/day max
 * - Browserless PDF: ~$0.001–0.006/export on scaled plans → 20/day
 *   ≈ $0.12/day max
 * Worst case per user ≈ $0.75/day (~$22/month at the cap every single
 * day) — compare against the providers' dashboard spend alerts.
 */

import { prisma } from "@/lib/prisma";

export type QuotaSurface = "copy" | "export" | "label" | "segment";

export const DEFAULT_DAILY_INPAINT_LIMIT = 20;
export const DEFAULT_DAILY_COPY_LIMIT = 50;
export const DEFAULT_DAILY_LABEL_LIMIT = 50;
export const DEFAULT_DAILY_EXPORT_LIMIT = 20;
export const DEFAULT_DAILY_SEGMENT_LIMIT = 100;
/**
 * Alias for `DEFAULT_DAILY_SEGMENT_LIMIT` under the name used in issue
 * #226's scope line ("cap SEGMENT_DAILY_LIMIT = 100"). Prefer the
 * `DEFAULT_DAILY_*_LIMIT` naming in new code.
 */
export const SEGMENT_DAILY_LIMIT = DEFAULT_DAILY_SEGMENT_LIMIT;

/** Env var that configures each surface's daily limit (optional; falls back to the defaults above). */
export const DAILY_LIMIT_ENV_VAR = {
  inpaint: "DAILY_INPAINT_LIMIT",
  copy: "DAILY_COPY_LIMIT",
  label: "DAILY_LABEL_LIMIT",
  export: "DAILY_EXPORT_LIMIT",
  segment: "DAILY_SEGMENT_LIMIT",
} as const;

export interface DailyWindow {
  /** `YYYY-MM-DD` in server-local time — stable key for the daily counter. */
  dayKey: string;
  /** Inclusive window start: local midnight of the day containing `now`. */
  startAt: Date;
  /** Exclusive window end: local midnight of the following day. */
  endAt: Date;
}

/**
 * Computes the server-local calendar-day window containing `now`.
 *
 * Pure: takes an explicit `now` (defaulting to the current time) so tests
 * can pin boundary behavior without fake timers.
 */
export function dailyWindow(now: Date = new Date()): DailyWindow {
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();

  const startAt = new Date(year, month, day, 0, 0, 0, 0);
  const endAt = new Date(year, month, day + 1, 0, 0, 0, 0);

  const dayKey = [
    String(year).padStart(4, "0"),
    String(month + 1).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");

  return { dayKey, startAt, endAt };
}

/**
 * Resolves a daily limit from its env var with a sane default.
 *
 * Contract: `undefined`/blank/non-numeric/negative/non-integer values fall
 * back to `fallback`; `0` is a valid limit and blocks all usage for the
 * day. Keeps a typo'd env value from silently disabling or exploding the
 * guardrail.
 */
export function resolveDailyLimit(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) return fallback;
  return parsed;
}

export type QuotaDecision =
  | { allowed: true; used: number; limit: number; remaining: number }
  | {
      allowed: false;
      used: number;
      limit: number;
      /** When the daily window rolls over (server-local next midnight). */
      resetsAt: string; // ISO timestamp
    };

/**
 * Pure quota evaluation: a request is allowed while today's usage is
 * strictly below the limit, so the limit-th call is still served and the
 * (limit + 1)-th is blocked.
 */
export function evaluateDailyQuota(used: number, limit: number, now: Date = new Date()): QuotaDecision {
  if (used < limit) {
    return { allowed: true, used, limit, remaining: limit - used };
  }
  return {
    allowed: false,
    used,
    limit,
    resetsAt: dailyWindow(now).endAt.toISOString(),
  };
}

/**
 * Pure quota evaluation for a BATCH of `count` billable units on one
 * surface (issue #681: `detectBatchRoomTypes` fires one gpt-4o-mini
 * vision call per image and rides the `label` counter). A batch is
 * allowed only when it fits entirely inside the remaining headroom
 * (`used + count <= limit`) — unlike {@link evaluateDailyQuota}'s
 * per-unit semantics, a batch that would straddle the boundary is
 * rejected whole rather than partially served, so a single request can
 * never overshoot the cap. The exactly-filling batch
 * (`used + count === limit`) is served, mirroring "the limit-th call is
 * still served".
 */
export function evaluateDailyBatchQuota(
  used: number,
  count: number,
  limit: number,
  now: Date = new Date()
): QuotaDecision {
  if (used + count <= limit) {
    return { allowed: true, used, limit, remaining: limit - used };
  }
  return {
    allowed: false,
    used,
    limit,
    resetsAt: dailyWindow(now).endAt.toISOString(),
  };
}

export interface DailyQuotaExceededPayload {
  error: string;
  message: string;
  retryable: true;
  used: number;
  limit: number;
  resetsAt: string;
}

/**
 * Builds the 429 JSON body for an exceeded daily quota, following the
 * repo's `{ error, message, retryable }` integration-error shape
 * (see `lib/error-classify.ts`). Routes add their own extras on top
 * (e.g. `generate-copy` adds `success: false`).
 */
export function dailyQuotaExceededPayload(
  decision: Extract<QuotaDecision, { allowed: false }>,
  friendlyAction: string
): DailyQuotaExceededPayload {
  return {
    error: "Daily limit reached",
    message: `You've reached today's limit for this action. ${friendlyAction} Your usage resets shortly after midnight (server time).`,
    retryable: true,
    used: decision.used,
    limit: decision.limit,
    resetsAt: decision.resetsAt,
  };
}

/**
 * Prisma `where` fragment counting a user's inpaint requests in the
 * current daily window — the fal.ai usage signal (see module header).
 * Traverses `InpaintRequest → Room → Project.userId`, matching the
 * ownership filter used by the inpaint route, so a user's quota can only
 * ever reflect their own submissions.
 */
export function inpaintDailyUsageWhere(
  userId: string,
  now: Date = new Date()
): { room: { project: { userId: string } }; createdAt: { gte: Date } } {
  return {
    room: { project: { userId } },
    createdAt: { gte: dailyWindow(now).startAt },
  };
}

// ---------------------------------------------------------------------------
// Postgres-backed daily usage counter (copy/export/segment/label surfaces).
// Replaces the in-process Map which had a known multi-instance race condition
// on serverless platforms (issue #784).  The `inpaint` surface still uses
// InpaintRequest.count() via `inpaintDailyUsageWhere` — it has its own
// persisted row and does not need this table.
// ---------------------------------------------------------------------------

/**
 * Reads today's recorded usage for a user on a Postgres-counted surface.
 */
export async function getDailyUsage(
  surface: QuotaSurface,
  userId: string,
  now: Date = new Date()
): Promise<number> {
  const { dayKey } = dailyWindow(now);
  const record = await prisma.dailyApiUsage.findUnique({
    where: { userId_surface_dayKey: { userId, surface, dayKey } },
  });
  return record?.count ?? 0;
}

/**
 * Records one billable unit for a user on a Postgres-counted surface.
 * Uses upsert so concurrent requests for the same user+surface+dayKey are
 * safe. Returns the new usage count for the current day.
 */
export async function recordDailyUsage(
  surface: QuotaSurface,
  userId: string,
  now: Date = new Date()
): Promise<number> {
  const { dayKey } = dailyWindow(now);
  const record = await prisma.dailyApiUsage.upsert({
    where: { userId_surface_dayKey: { userId, surface, dayKey } },
    create: { userId, surface, dayKey, count: 1 },
    update: { count: { increment: 1 } },
  });
  return record.count;
}
