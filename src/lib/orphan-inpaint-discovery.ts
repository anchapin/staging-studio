/**
 * Pure discovery logic for orphaned InpaintRequest rows.
 *
 * Two orphan kinds are recognised, with different recovery / cleanup
 * needs:
 *
 *  - **RECOVERY orphans** — `status === "ERROR"` and `createdAt` is
 *    older than 24 hours. The poller has given up on these as
 *    genuinely failed; recovery flips them to `PERSISTENCE_FAILED` so
 *    the editor's poller re-attempts result persistence on the next
 *    page load. (See issue #1421.)
 *
 *  - **CLEANUP orphans** — `status === "PERSISTENCE_FAILED"` and
 *    `updatedAt` is older than 7 days. After recovery the user has
 *    presumably reloaded the page and either re-picked-up the row
 *    (so it advanced to COMPLETED) or explicitly discarded the run.
 *    Either way, a 7-day-old PERSISTENCE_FAILED row is a leftover
 *    the editor's `pendingRequestId` resolver keeps shadowing the
 *    actual active variant. (See #1421 + the manual cleanup script
 *    history.)
 *
 * The function takes a `discoverArgs` object plus a small typed
 * `InpaintRequestRow` view (just the columns discovery needs) so the
 * logic can be unit-pinned without booting Prisma. The two scripts
 * (`scripts/recover-orphaned-inpaint-rows.mts` and
 * `scripts/cleanup-orphaned-inpaint-rows.mts`) call this through a
 * thin Prisma adapter in `tests/orphan-inpaint-discovery.test.ts`'s
 * sibling fixture.
 *
 * Both kinds of orphan are gated on `now`, expressed in milliseconds
 * for testability. Callers in `.mts` scripts pass `Date.now()`.
 */

export interface InpaintRequestRow {
  readonly id: string;
  readonly status: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly resultUrl: string | null;
  readonly roomId: string;
}

export interface DiscoverArgs {
  readonly now: Date;
  /**
   * Lower bound for "this row is recent enough to leave alone". Rows
   * NEWER than this timestamp stay unpinned. Default is `now`
   * (not used as a floor in the function body, but surfaced for callers
   * that want to log the cutoff).
   */
  readonly recentFloorMs?: number;
  /**
   * Backstop on the SELECT. Defaults to scanning the entire table;
   * callers with very large tables can override (e.g. `lt: new Date(Date.now() - 1)`).
   */
  readonly allRows?: ReadonlyArray<InpaintRequestRow>;
}

/** 24 hours, in milliseconds. ROWS older than this are RECOVERY candidates. */
export const RECOVERY_AGE_MS = 24 * 60 * 60 * 1000;
/** 7 days, in milliseconds. PERSISTENCE_FAILED rows older than this are CLEANUP candidates. */
export const CLEANUP_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type OrphanKind = "RECOVERY" | "CLEANUP";

export interface Orphan {
  readonly id: string;
  readonly kind: OrphanKind;
  readonly row: InpaintRequestRow;
}

interface Counts {
  readonly RECOVERY: number;
  readonly CLEANUP: number;
}

/**
 * Pure discovery. Pass `args.allRows` (typically the result of
 * `prisma.inpaintRequest.findMany({ where: { status: { in: ['ERROR', 'PERSISTENCE_FAILED'] } } })`)
 * and the function returns the orphan classification for each row.
 *
 * Dry-run by design — every consumer of this function is supposed to
 * print its plan and wait for `--apply` before mutating anything.
 * That mirrors the `scripts/recover-orphaned-inpaint-rows.mts` and
 * `scripts/cleanup-orphaned-inpaint-rows.mts` conventions.
 */
export function discoverOrphans(
  rows: ReadonlyArray<InpaintRequestRow>,
  now: Date,
): { orphans: ReadonlyArray<Orphan>; counts: Counts } {
  const nowMs = now.getTime();
  const recoveryCutoff = nowMs - RECOVERY_AGE_MS;
  const cleanupCutoff = nowMs - CLEANUP_AGE_MS;

  const orphans: Orphan[] = [];
  let recovery = 0;
  let cleanup = 0;

  for (const row of rows) {
    if (row.status === "ERROR" && row.createdAt.getTime() <= recoveryCutoff) {
      orphans.push({ id: row.id, kind: "RECOVERY", row });
      recovery += 1;
      continue;
    }
    if (
      row.status === "PERSISTENCE_FAILED" &&
      row.updatedAt.getTime() <= cleanupCutoff
    ) {
      orphans.push({ id: row.id, kind: "CLEANUP", row });
      cleanup += 1;
      continue;
    }
  }

  return {
    orphans,
    counts: { RECOVERY: recovery, CLEANUP: cleanup },
  };
}

/**
 * Render a human-readable summary line for a single orphan. Used by
 * the two scripts to keep their output formats consistent and by the
 * test to lock the format on record.
 */
export function formatOrphanLine(
  orphan: Orphan,
  applyMode: boolean,
): string {
  const r = orphan.row;
  const verb = orphan.kind === "CLEANUP" ? "DELETE" : "FLIP->PERSISTENCE_FAILED";
  const mode = applyMode ? verb : `would ${verb.toLowerCase()}`;
  const statusField = `status=${r.status}`;
  const resultField = `resultUrl=${r.resultUrl ? r.resultUrl.slice(0, 60) + "..." : "null"}`;
  return `[${orphan.kind.toLowerCase()}] ${mode} ${r.id} (${statusField}, ${resultField}, roomId=${r.roomId})`;
}
