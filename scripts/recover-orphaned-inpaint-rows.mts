#!/usr/bin/env tsx
/**
 * One-shot recovery for orphaned InpaintRequest rows.
 *
 * Context: in an earlier debug session, four InpaintRequest rows were
 * transitioned to status=ERROR because `pollFalStatus` repeatedly saw
 * a queue.status 404 (or otherwise failed to retrieve the result) and
 * the new #1187 404-detection path marked them terminal. Live API
 * checks against fal now return 200 COMPLETED with a usable image URL
 * for all four requestIds, so the result data is still recoverable
 * from fal — the rows were marked ERROR in error, not because the
 * results are gone.
 *
 * What this script does:
 *   - For each ERROR row whose resultUrl is null, set status to
 *     PERSISTENCE_FAILED and clear resultUrl. The on-the-fly
 *     `pollFalStatus` PERSISTENCE_FAILED branch will then
 *     (a) re-fetch the fal result for the requestId,
 *     (b) re-download the image,
 *     (c) re-persist it to Supabase Storage at
 *         `after-{requestId}.png`,
 *     (d) update the row to status=COMPLETED with the new resultUrl,
 *     (e) fire the editor's onCompleted callback, which PATCHes the
 *         room to set afterImageUrl / afterImageUrl2 (and possibly
 *         selectedVariantIndex / beforeImageUrl2 for a fresh slot-1
 *         run, via `buildInpaintResultPatch`).
 *
 * What this script does NOT do:
 *   - It does not touch IN_QUEUE rows. The editor's `useInpaintRuns`
 *     effect picks the room's first InpaintRequest as pendingRequestId
 *     and re-polls it on every page load; the poller will pick the
 *     IN_QUEUE row up naturally and complete the same path. Marking
 *     it PERSISTENCE_FAILED prematurely would skip the COMPLETED →
 *     result branch in pollFalStatus and force a slightly different
 *     code path (the PERSISTENCE_FAILED one), with no benefit.
 *   - It does not touch the room's afterImageUrl directly. The
 *     client-driven `persistInpaintResult` (project-detail-view.tsx)
 *     applies `buildInpaintResultPatch` and PATCHes the room only
 *     after a successful poll, which is the production contract.
 *   - It does not retry on transient fal 404s. If fal 404s the
 *     status endpoint again at poll time, the row will go back to
 *     ERROR via the existing `isInferenceRequestGone` path; rerun
 *     this script after a few minutes if that happens. CDN retention
 *     is at least 7 days per fal docs, so we have time.
 *
 * Usage:
 *   # dry run — prints what would change, writes nothing
 *   npx tsx scripts/recover-orphaned-inpaint-rows.mts
 *
 *   # actually apply
 *   npx tsx scripts/recover-orphaned-inpaint-rows.mts --apply
 *
 * After --apply: the user must reload the room's editor. The poller
 * will see status=PERSISTENCE_FAILED, hit fal (which now returns
 * COMPLETED), persist the image to Supabase, and update the row +
 * room. The onCompleted callback writes the InpaintVersion thumbnail
 * + row automatically.
 *
 * Idempotent: running --apply twice is safe. The second run is a
 * no-op (the row is already PERSISTENCE_FAILED or COMPLETED) and
 * just prints the current state.
 */
import { prisma } from "../src/lib/prisma";

const ORPHANED_REQUEST_IDS = [
  "01a0fe39-f0ba-77a0-85f7-19e3f11171e5",
  "01a0fe51-5139-79e0-a8a7-6aa18734b2c6",
  "01a0fe73-09a7-7ef3-a3bf-6ffd67c0165c",
  "01a0fe78-3bf8-73b0-b493-5b313387d991",
] as const;

const apply = process.argv.includes("--apply");

async function main() {
  console.log(
    `[recover] mode=${apply ? "APPLY" : "DRY-RUN"} requestIds=${ORPHANED_REQUEST_IDS.length}`
  );

  const rows = await prisma.inpaintRequest.findMany({
    where: { id: { in: [...ORPHANED_REQUEST_IDS] } },
    select: {
      id: true,
      status: true,
      resultUrl: true,
      variantSlot: true,
      sourceSlot: true,
      roomId: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const found = new Set(rows.map((r) => r.id));
  for (const id of ORPHANED_REQUEST_IDS) {
    if (!found.has(id)) {
      console.log(`[recover] MISSING: ${id} not in DB (already pruned?)`);
    }
  }

  let flipped = 0;
  let skipped = 0;
  for (const row of rows) {
    if (row.status === "COMPLETED" && row.resultUrl) {
      console.log(
        `[recover] skip ${row.id}: already COMPLETED (resultUrl=${row.resultUrl.slice(
          0,
          60
        )}...)`
      );
      skipped++;
      continue;
    }
    if (row.status === "PERSISTENCE_FAILED" && !row.resultUrl) {
      console.log(
        `[recover] skip ${row.id}: already PERSISTENCE_FAILED (no resultUrl) — poller will pick up on next page load`
      );
      skipped++;
      continue;
    }
    if (row.status === "IN_QUEUE" || row.status === "IN_PROGRESS") {
      console.log(
        `[recover] skip ${row.id}: status=${row.status} — editor will resume polling on next page load`
      );
      skipped++;
      continue;
    }
    if (row.status !== "ERROR" || row.resultUrl) {
      console.log(
        `[recover] skip ${row.id}: unexpected shape status=${row.status} resultUrl=${
          row.resultUrl ?? "null"
        } — manual review`
      );
      skipped++;
      continue;
    }

    console.log(
      `[recover] ${apply ? "FLIP " : "would flip"} ${row.id}: ERROR + resultUrl=null → PERSISTENCE_FAILED + resultUrl=null (variantSlot=${row.variantSlot}, sourceSlot=${row.sourceSlot ?? "null"}, roomId=${row.roomId})`
    );
    if (apply) {
      await prisma.inpaintRequest.update({
        where: { id: row.id },
        data: { status: "PERSISTENCE_FAILED", resultUrl: null },
      });
      flipped++;
    }
  }

  if (apply) {
    const post = await prisma.inpaintRequest.findMany({
      where: { id: { in: [...ORPHANED_REQUEST_IDS] } },
      select: { id: true, status: true, resultUrl: true, updatedAt: true },
    });
    console.log(`\n[recover] post-apply state:`);
    for (const r of post) {
      console.log(
        `  ${r.id}  status=${r.status}  resultUrl=${r.resultUrl ? r.resultUrl.slice(0, 60) + "..." : "null"}  updatedAt=${r.updatedAt.toISOString()}`
      );
    }
    console.log(
      `\n[recover] flipped=${flipped} skipped=${skipped}. Reload the room's editor in the browser — the poller will complete the persistence and apply the room patch.`
    );
  } else {
    console.log(
      `\n[recover] DRY-RUN: would flip ${rows.length - skipped} row(s). Re-run with --apply to write.`
    );
  }
}

main()
  .catch((e) => {
    console.error("[recover] failed:", e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
