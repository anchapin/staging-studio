#!/usr/bin/env tsx
/**
 * recover-orphaned-inpaint-rows.mts (issue #1202, refreshed by #1423)
 *
 * One-shot recovery script: flips orphaned `ERROR` InpaintRequest rows to
 * `PERSISTENCE_FAILED` so the poller re-fetches their result on the next
 * editor load.
 *
 * Why this exists: since #1202 the poller recovers transient provider
 * 404s itself, so the only way we land in `ERROR` here is when the
 * provider has truly pruned the request. We still flip these to
 * `PERSISTENCE_FAILED` because:
 *
 *  1. The result may now be available (we never asked after the
 *     404, the provider may have caught up).
 *  2. `PERSISTENCE_FAILED` + `resultUrl=null` triggers the editor's
 *     own recovery-on-load path (`/api/inpaint/[id]/status`) which
 *     takes one more shot from the user's browser tab.
 *
 * Usage (dry run by default; --apply writes):
 *
 *     npx tsx scripts/recover-orphaned-inpaint-rows.mts                # dry run
 *     npx tsx scripts/recover-orphaned-inpaint-rows.mts --apply        # apply
 *     npx tsx scripts/recover-orphaned-inpaint-rows.mts --ids id1,id2  # force-include specific ids
 *
 * Dry run by default — same convention as `scripts/cleanup-...mts`.
 * Idempotent: target rows have already been flipped will appear in the
 * recovery list (status === "ERROR" with the same `createdAt` check),
 * the apply loop simply writes the same value again.
 *
 * Discovery (issue #1423): rows are now selected via the SQL-backed
 * discovery in `src/lib/orphan-inpaint-discovery.ts` rather than a
 * hand-edited `ORPHANED_REQUEST_IDS` literal. The literal list is kept
 * as a force-include allowlist (use only when a manual report names a
 * specific id outside the discovery window); the discovery path is the
 * primary route and removes the manual UUID-list footgun.
 */
import { PrismaClient } from "@prisma/client";
import {
  discoverOrphans,
  formatOrphanLine,
  type InpaintRequestRow,
} from "../src/lib/orphan-inpaint-discovery";

const prisma = new PrismaClient();

/**
 * Force-include allowlist for ids that fall outside the discovery
 * window (e.g. a row with status === "ERROR" but createdAt < 24h ago
 * that an admin reports via a user-support ticket). Empty by default.
 * Discovery is the primary path; this is the named-id-only escape
 * hatch. When adopting #1423's discovery, manually confirm each row
 * before adding it here -- the script will flip it to
 * PERSISTENCE_FAILED regardless of its current state.
 */
const ORPHANED_REQUEST_IDS: ReadonlyArray<string> = [];

const apply = process.argv.includes("--apply");
const forceIdsArg = process.argv
  .find((arg) => arg.startsWith("--ids="))
  ?.split("=")[1];
const forceIds = forceIdsArg ? forceIdsArg.split(",").filter(Boolean) : [];

async function loadRows(): Promise<ReadonlyArray<InpaintRequestRow>> {
  // Only the discovery-needed columns so the script can scan even a
  // multi-million-row table cheaply. The index covers `status` and
  // `createdAt` (the WHERE filter is `status IN ('ERROR',
  // 'PERSISTENCE_FAILED')`, ordered by the age cutoff the discovery
  // function applies in code; we fetch both statuses here and let the
  // discovery function filter them again -- this keeps the Prisma
  // query simple and the index-tight).
  const rows = await prisma.inpaintRequest.findMany({
    where: { status: { in: ["ERROR", "PERSISTENCE_FAILED"] } },
    select: {
      id: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      resultUrl: true,
      roomId: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt ?? r.createdAt,
    resultUrl: r.resultUrl,
    roomId: r.roomId,
  }));
}

async function loadForceRows(
  ids: ReadonlyArray<string>,
): Promise<ReadonlyArray<InpaintRequestRow>> {
  if (ids.length === 0) return [];
  const rows = await prisma.inpaintRequest.findMany({
    where: { id: { in: [...ids] } },
    select: {
      id: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      resultUrl: true,
      roomId: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt ?? r.createdAt,
    resultUrl: r.resultUrl,
    roomId: r.roomId,
  }));
}

async function main(): Promise<void> {
  const discoveredRows = await loadRows();
  const forcedRows = await loadForceRows([
    ...ORPHANED_REQUEST_IDS,
    ...forceIds,
  ]);

  const discovery = discoverOrphans(discoveredRows, new Date());

  type OrphanLike = {
    id: string;
    kind: "RECOVERY" | "CLEANUP";
    row: InpaintRequestRow;
  };
  const forceOrphans: OrphanLike[] = forcedRows.map((row) => ({
    id: row.id,
    kind: row.status === "ERROR" ? "RECOVERY" : "CLEANUP",
    row,
  }));

  // De-duplicate by id, preferring discovery classification. A force
  // row wins ONLY when it would classify RECOVERY (the bucket this
  // script owns) AND the discovery row is CLEANUP (so we'd otherwise
  // ignore it here).
  const merged = new Map<string, OrphanLike>();
  for (const o of discovery.orphans) merged.set(o.id, o);
  for (const o of forceOrphans) {
    const prev = merged.get(o.id);
    if (!prev) merged.set(o.id, o);
    else if (prev.kind === "CLEANUP" && o.kind === "RECOVERY")
      merged.set(o.id, o);
  }

  const allOrphans = [...merged.values()];
  const recoveryCount = allOrphans.filter((o) => o.kind === "RECOVERY").length;
  const cleanupCount = allOrphans.filter((o) => o.kind === "CLEANUP").length;
  const recoveryIds = allOrphans
    .filter((o) => o.kind === "RECOVERY")
    .map((o) => o.id);

  if (allOrphans.length === 0) {
    console.log(
      `[recover-orphaned-inpaint-rows] no candidates found (cutoff: now-24h for ERROR; now-7d for PERSISTENCE_FAILED).`
    );
    console.log(
      "[recover-orphaned-inpaint-rows] ORPHANED_REQUEST_IDS hard-list is empty."
    );
    return;
  }

  console.log(
    `[recover-orphaned-inpaint-rows] ${apply ? "APPLYING" : "DRY RUN"} -- discovered ${allOrphans.length} orphans (recovery=${recoveryCount}; cleanup=${cleanupCount} -- CLEANUP is informational here; the cleanup script owns that bucket):`
  );
  for (const o of allOrphans) {
    console.log(`  ${formatOrphanLine(o, apply)}`);
  }

  if (!apply) {
    console.log(
      "[recover-orphaned-inpaint-rows] DRY RUN -- pass --apply to commit. Idempotent: re-running with --apply will write the same status to already-fixed rows."
    );
    return;
  }
  if (recoveryIds.length === 0) {
    console.log(
      "[recover-orphaned-inpaint-rows] no RECOVERY candidates to flip (only CLEANUP orphans discovered; run cleanup-orphaned-inpaint-rows.mts)."
    );
    return;
  }
  const result = await prisma.inpaintRequest.updateMany({
    where: { id: { in: recoveryIds } },
    data: { status: "PERSISTENCE_FAILED" },
  });
  console.log(
    `[recover-orphaned-inpaint-rows] flipped ${result.count} row(s) to PERSISTENCE_FAILED.`
  );
  console.log(
    "[recover-orphaned-inpaint-rows] subsequent /api/inpaint/[id]/status calls will now re-attempt the result."
  );
}

main()
  .catch((e) => {
    console.error("[recover-orphaned-inpaint-rows] failed", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
