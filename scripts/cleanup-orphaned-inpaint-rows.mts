#!/usr/bin/env tsx
/**
 * One-shot cleanup for the orphaned InpaintRequest rows that the
 * recovery script flipped to PERSISTENCE_FAILED.
 *
 * Context: in a debug session, four InpaintRequest rows were marked
 * ERROR after the poller saw 404s on the fal queue endpoints. The
 * recovery script (scripts/recover-orphaned-inpaint-rows.mts) flipped
 * the three ERROR rows to PERSISTENCE_FAILED so the editor's poller
 * would re-pick them up. After the user reloaded the editor, the
 * 4th row (IN_QUEUE) was processed first — it completed normally,
 * the active room variants were set, and a new inpaint run
 * (`01a0ff29-...`) created the second variant. The 3
 * PERSISTENCE_FAILED rows were never touched and are now stale
 * leftovers: leaving them in the DB means the editor's
 * `pendingRequestId` resolution (Prisma's `inpaintRequests[0]`,
 * id-ordered) will keep resuming one of them on the next page load,
 * and the poller will overwrite the room's `afterImageUrl` with a
 * stale result the user has already discarded.
 *
 * This script deletes those 3 rows. The room's active variants and
 * version history are already populated with the user's chosen
 * work; the 3 stale rows are not referenced by anything in
 * InpaintVersion (every InpaintVersion.resultUrl points to its own
 * `after-{requestId}.png` storage path keyed by the requestId that
 * produced it), so deletion is safe.
 *
 * What it does NOT delete:
 *   - The 4th row (`01a0fe78-...`) — it was already completed by
 *     the user's reload and is the active `afterImageUrl`.
 *   - Any InpaintVersion rows — they are independent of
 *     InpaintRequest and hold the work the user kept.
 *
 * Usage:
 *   # dry run — prints what would be deleted, writes nothing
 *   npx tsx scripts/cleanup-orphaned-inpaint-rows.mts
 *
 *   # actually delete
 *   npx tsx scripts/cleanup-orphaned-inpaint-rows.mts --apply
 *
 * Idempotent: re-running --apply after the rows are gone is a
 * no-op (deleteMany of an empty where matches nothing).
 */
import { prisma } from "../src/lib/prisma";

const ORPHANED_REQUEST_IDS = [
  "01a0fe39-f0ba-77a0-85f7-19e3f11171e5",
  "01a0fe51-5139-79e0-a8a7-6aa18734b2c6",
  "01a0fe73-09a7-7ef3-a3bf-6ffd67c0165c",
] as const;

const apply = process.argv.includes("--apply");

async function main() {
  console.log(
    `[cleanup] mode=${apply ? "APPLY" : "DRY-RUN"} requestIds=${ORPHANED_REQUEST_IDS.length}`
  );

  const rows = await prisma.inpaintRequest.findMany({
    where: { id: { in: [...ORPHANED_REQUEST_IDS] } },
    select: { id: true, status: true, resultUrl: true, roomId: true },
  });

  if (rows.length === 0) {
    console.log("[cleanup] nothing to do (all rows already gone)");
    return;
  }

  for (const r of rows) {
    console.log(
      `[cleanup] ${apply ? "DELETE" : "would delete"} ${r.id} (status=${r.status}, resultUrl=${r.resultUrl ? r.resultUrl.slice(0, 60) + "..." : "null"}, roomId=${r.roomId})`
    );
  }

  if (apply) {
    const { count } = await prisma.inpaintRequest.deleteMany({
      where: { id: { in: [...ORPHANED_REQUEST_IDS] } },
    });
    console.log(`\n[cleanup] deleted ${count} row(s)`);

    const post = await prisma.inpaintRequest.count({
      where: { id: { in: [...ORPHANED_REQUEST_IDS] } },
    });
    console.log(`[cleanup] post-delete count for these ids: ${post}`);
  } else {
    console.log(
      `\n[cleanup] DRY-RUN: would delete ${rows.length} row(s). Re-run with --apply to write.`
    );
  }
}

main()
  .catch((e) => {
    console.error("[cleanup] failed:", e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
