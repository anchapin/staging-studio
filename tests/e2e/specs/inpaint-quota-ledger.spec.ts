import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

import { DATABASE_URL, E2E_DAILY_INPAINT_LIMIT, E2E_USER_ID } from "../env";
import { login } from "../helpers";
import { withInpaintUsageAtLimit, withUsageAtCount } from "../quota";

/**
 * Issue #1131: deleting a room must not refund today's inpaint quota.
 *
 * `DAILY_INPAINT_LIMIT` used to be enforced by COUNTING today's
 * `InpaintRequest` rows, and those rows cascade-delete with their room
 * (`prisma/schema.prisma`, `onDelete: Cascade`). `deleteRoom` is an
 * ordinary owner-facing action, so a user could stage to the cap, delete
 * the rooms, and get the whole cap back at zero cost — repeatably, with no
 * trace of the spend left to reconcile. Usage is now a `DailyApiUsage`
 * counter row, which is not a child of any user content.
 *
 * This spec drives the REAL `POST /api/inpaint` handler, because the thing
 * under test is a server-side quota read: a browser-layer `page.route` mock
 * would bypass the handler entirely and assert nothing.
 *
 * Hermeticity is structural, not incidental: the room under test is
 * DELETED, so even if the quota gate opened the request would stop at the
 * ownership check with a 404 and never reach `fal.queue.submit`. Both
 * assertions below therefore pass or fail without the paid provider ever
 * being contacted — the seed, the delete, and the two 4xx/429 responses
 * are all that this spec needs. A regression to the row-count derivation
 * turns the 429 into a 404, which is the failure this spec exists to catch.
 */

/** cuid-shaped, because nothing here needs a cuid but the column is a String. */
const QUOTA_PROJECT_ID = "cquota000000000000000000000";
const QUOTA_ROOM_ID = "cquotaroom000000000000000room";
const QUOTA_REQUEST_ID = "fal-quota-ledger-unused";

const INPAINT_URL = "/api/inpaint";

/** A body that passes validation, so the only thing that can 429 is the cap. */
const VALID_BODY = {
  imageUrl: "https://e2e-fixture.supabase.co/storage/v1/object/public/room-photos/before.png",
  maskUrl: "data:image/png;base64,BBB",
  promptDirectives: "Brighten the room, add warm neutrals",
  aesthetic: "Modern",
  roomId: QUOTA_ROOM_ID,
  variantSlot: 0,
  sourceSlot: null,
};

async function withDiscardedRoom<T>(fn: () => Promise<T>): Promise<T> {
  const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
  try {
    // A project+room of this spec's own, deleted before the assertion: no
    // other spec's seeded room is ever removed (specs share one database).
    await prisma.project.create({
      data: {
        id: QUOTA_PROJECT_ID,
        userId: E2E_USER_ID,
        propertyAddress: "1 Ledger Lane",
        clientName: "Quota Ledger",
        targetBuyer: "test buyer",
        stagingAesthetic: "Modern",
        rooms: {
          create: {
            id: QUOTA_ROOM_ID,
            name: "Quota Room",
            // The row the old derivation counted. It is what cascades away
            // with the room, and its absence is the whole bug.
            inpaintRequests: {
              create: {
                id: QUOTA_REQUEST_ID,
                variantSlot: 0,
                sourceSlot: null,
                status: "COMPLETED",
              },
            },
          },
        },
      },
    });
    await prisma.room.delete({ where: { id: QUOTA_ROOM_ID } });

    // Assert the cascade really happened, so a future schema change that
    // stops cascading fails HERE rather than making the 429 below look
    // like the ledger working.
    const orphans = await prisma.inpaintRequest.count({
      where: { id: QUOTA_REQUEST_ID },
    });
    expect(orphans, "InpaintRequest should cascade-delete with its room").toBe(0);

    return await fn();
  } finally {
    await prisma.project.deleteMany({ where: { id: QUOTA_PROJECT_ID } });
    await prisma.$disconnect();
  }
}

test.describe("inpaint quota ledger survives room deletion (#1131)", () => {
  test("a ledger at the cap still 429s after the rooms are deleted", async ({ page }) => {
    await login(page);

    await withDiscardedRoom(async () => {
      await withInpaintUsageAtLimit(async () => {
        const response = await page.request.post(INPAINT_URL, { data: VALID_BODY });

        expect(response.status()).toBe(429);
        const body = await response.json();
        expect(body.error).toBe("Daily limit reached");
        // The count reported is the ledger's, not a row count — the room
        // that would have supplied those rows is gone.
        expect(body.used).toBe(E2E_DAILY_INPAINT_LIMIT);
        expect(body.limit).toBe(E2E_DAILY_INPAINT_LIMIT);
      });
    });
  });

  test("below the cap the same request is NOT 429 — the gate is not unconditional", async ({ page }) => {
    await login(page);

    await withDiscardedRoom(async () => {
      await withUsageAtCount("inpaint", E2E_DAILY_INPAINT_LIMIT - 1, async () => {
        const response = await page.request.post(INPAINT_URL, { data: VALID_BODY });

        // The cap opened, so the request proceeded to the ownership check —
        // and failed there because the room really was deleted. This is the
        // vacuity guard: it separates "reads the ledger" from "always 429",
        // and the 404 proves fal was never reached.
        expect(response.status()).toBe(404);
        const body = await response.json();
        expect(body.error).toBe("Room not found");
      });
    });
  });
});
