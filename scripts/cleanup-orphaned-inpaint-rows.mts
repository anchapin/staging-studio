#!/usr/bin/env tsx
/**
 * cleanup-orphaned-inpaint-rows.mts (issue #1423)
 *
 * One-shot cleanup script: deletes `PERSISTENCE_FAILED` InpaintRequest
 * rows that the recovery flow has effectively given up on (updatedAt
 * older than 7 days, with no recovery activity since).
 *
 * Why two scripts and not one:
 *
 *  - `recover-...mts` only ever flips ERROR -> PERSISTENCE_FAILED.
 *    It writes — never deletes — so the editor can re-pick up
 *    incomplete work on the next page load.
 *  - `cleanup-...mts` (this file) deletes the *stale leftovers*. A row
 *    that's been `PERSISTENCE_FAILED` for 7+ days is, by convention,
 *    one the user has either re-picked up (and the row advanced to
 *    COMPLETED or similar) or explicitly discarded. Either way it is
 *    no longer the "active" variant the editor's `pendingRequestId`
 *    resolver is shadowing.
 *
 * Usage (dry run by default; --apply writes):
 *
 *     npx tsx scripts/cleanup-orphaned-inpaint-rows.mts                # dry run
 *     npx tsx scripts/cleanup-orphaned-inpaint-rows.mts --apply        # apply
 *     npx tsx scripts/cleanup-orphaned-inpaint-rows.mts --ids id1,id2  # force-include specific ids
 *
 * Discovery (issue #1423): rows are now selected via the SQL-backed
 * discovery in `src/lib/orphan-inpaint-discovery.ts`. The hard-coded
 * `ORPHANED_REQUEST_IDS` literal is preserved as a force-include
 * allowlist (empty by default) but is no longer the primary path.
 */
import { PrismaClient } from "@prisma/client";
import {
  discoverOrphans,
  formatOrphanLine,
  type InpaintRequestRow,
} from "../src/lib/orphan-inpaint-discovery";

const prisma = new PrismaClient();

/**
 * Force-include allowlist for ids that should be deleted regardless
 * of the discovery cutoff. Empty by default -- discovery is the
 * primary path.
 */
const ORPHANED_REQUEST_IDS: ReadonlyArray<string> = [];

const apply = process.argv.includes("--apply");
const forceIdsArg = process.argv
  .find((arg) => arg.startsWith("--ids="))
  ?.split("=")[1];
const forceIds = forceIdsArg ? forceIdsArg.split(",").filter(Boolean) : [];

async function loadRows(): Promise<ReadonlyArray<InpaintRequestRow>> {
  // Same query strategy as recover-...mts: only the discovery-needed
  // columns, only the two relevant statuses. The cutoffs the discovery
  // function applies are now in code (orphan-inpaint-discovery.ts),
  // not SQL, which keeps them unit-pinnable.
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
  // Forced rows that are PERSISTENCE_FAILED become CLEANUP candidates;
  // ERROR forced rows would degrade to no-op in this script
  // (recover-...mts owns those).
  const forceOrphans: OrphanLike[] = forcedRows.map((row) => ({
    id: row.id,
    kind: row.status === "PERSISTENCE_FAILED" ? "CLEANUP" : "RECOVERY",
    row,
  }));

  const merged = new Map<string, OrphanLike>();
  for (const o of discovery.orphans) merged.set(o.id, o);
  for (const o of forceOrphans) {
    const prev = merged.get(o.id);
    if (!prev) merged.set(o.id, o);
    else if (prev.kind === "RECOVERY" && o.kind === "CLEANUP")
      merged.set(o.id, o);
  }

  const allOrphans = [...merged.values()];
  const cleanupCount = allOrphans.filter((o) => o.kind === "CLEANUP").length;
  const recoveryCount = allOrphans.filter((o) => o.kind === "RECOVERY").length;
  const cleanupIds = allOrphans
    .filter((o) => o.kind === "CLEANUP")
    .map((o) => o.id);

  if (allOrphans.length === 0) {
    console.log(
      `[cleanup-orphaned-inpaint-rows] no candidates found (cutoff: now-7d for PERSISTENCE_FAILED).`
    );
    console.log(
      "[cleanup-orphaned-inpaint-rows] ORPHANED_REQUEST_IDS hard-list is empty."
    );
    return;
  }

  console.log(
    `[cleanup-orphaned-inpaint-rows] ${apply ? "APPLYING" : "DRY RUN"} -- discovered ${allOrphans.length} orphans (cleanup=${cleanupCount}; recovery=${recoveryCount} -- RECOVERY is informational here; recover-...mts owns that bucket):`
  );
  for (const o of allOrphans) {
    console.log(`  ${formatOrphanLine(o, apply)}`);
  }

  if (!apply) {
    console.log(
      "[cleanup-orphaned-inpaint-rows] DRY RUN -- pass --apply to commit."
    );
    return;
  }
  if (cleanupIds.length === 0) {
    console.log(
      "[cleanup-orphaned-inpaint-rows] no CLEANUP candidates to delete (only RECOVERY orphans discovered; run recover-orphaned-inpaint-rows.mts)."
    );
    return;
  }
  const result = await prisma.inpaintRequest.deleteMany({
    where: { id: { in: cleanupIds } },
  });
  console.log(
    `[cleanup-orphaned-inpaint-rows] deleted ${result.count} row(s) from PERSISTENCE_FAILED.`
  );
}

main()
  .catch((e) => {
    console.error("[cleanup-orphaned-inpaint-rows] failed", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
