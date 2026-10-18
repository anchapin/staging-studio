import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { E2E_EDITOR_PROJECT_ID, E2E_EDITOR_ROOM_ID } from "../env";
import { login, openFocusedEditor } from "../helpers";

/**
 * Issue #1344 — `<VersionStrip>` lookbook-slot CTA on the new surface.
 *
 * The new `<EditRoomStudio>` mounts the strip beneath the canvas
 * with three slots (Original / Variant A / Variant B). The
 * populated-slot that matches `lookbookSlot` carries a
 * `<LookbookBadge>`; the right side hosts the
 * `Use [Variant] in lookbook` CTA (`data-testid="lookbook-cta"`).
 * The CTA collapses to a static "{label} is in the lookbook"
 * line when the user is already viewing the lookbook slot.
 *
 * For the seeded Mask Room, `selectedVariantIndex === 0` →
 * `initialLookbookSlot = "A"`, so the studio opens with
 * `data-lookbook-slot="A"`. The CTA click only mutates the local
 * `lookbookSlot` when the viewing variant is pinnable; on the
 * ORIGINAL photo the click toasts (the server action rejects it
 * via `assertLookbookPinnable`). The "click cycles A → B →
 * original" assertion that lived in this slice relied on a
 * populated variant set, which the masked-only seed room doesn't
 * carry — that flow is pinned by the action-level unit test
 * (`tests/lookbook-variant.test.ts`) and lights up e2e once a
 * spec seeds a populated variant.
 *
 * Issue #1376 — per-variant delete (X) on `<VersionStrip>`. Adds
 * the X icon to each populated variant slot, an inline confirm
 * modal (Cancel / Delete), selection fallback (deleted selection
 * → other variant; deleted non-selection → keep), and the
 * both-deleted empty state (viewing falls back to "original",
 * no variant X buttons remain).
 */

const NEW_STUDIO_TESTID = "edit-room-studio";

// Issue #1344 — `NEXT_PUBLIC_EDIT_ROOM_REDESIGN` is build-time inlined
// at `"1"` (see tests/e2e/env.ts) so the new `<EditRoomStudio>`
// surface is live for the whole suite. The four `edit-room-redesign-*`
// specs exercise the wired-up submit path; the legacy specs were
// updated to the new surface's selectors in the same PR.
test.describe("Edit Room redesign — version strip CTA (issue #1344, flag=ON)", () => {
  test("With the flag on, the version strip's CTA renders", async ({ page }) => {
    await login(page);
    await openFocusedEditor(page, E2E_EDITOR_PROJECT_ID, "Mask Room");
    await expect(page.getByTestId(NEW_STUDIO_TESTID)).toBeVisible();

    // The version strip is the footer under the canvas. Its aria-label
    // is "Versions" (per VersionStrip.tsx).
    const strip = page.getByRole("region", { name: "Versions" });
    await expect(strip).toBeVisible();
    // The strip's "Use … in lookbook" CTA (`data-testid="lookbook-cta"`).
    await expect(strip.getByTestId("lookbook-cta")).toBeVisible();
  });

  test("Lookbook slot reflects the seeded selectedVariantIndex on first render", async ({
    page,
  }) => {
    await login(page);
    await openFocusedEditor(page, E2E_EDITOR_PROJECT_ID, "Mask Room");
    await expect(page.getByTestId(NEW_STUDIO_TESTID)).toBeVisible();

    // The shell seeds `data-lookbook-slot` from the room's
    // `selectedVariantIndex` (the seed Mask Room has it set to 0
    // → "A"). The CTA cycle (A → B → original) lives in
    // `handleUseInLookbook` and requires a populated variant set
    // to exercise; covered by the action-level unit test
    // (`tests/lookbook-variant.test.ts`).
    const studio = page.getByTestId(NEW_STUDIO_TESTID);
    await expect(studio).toHaveAttribute("data-lookbook-slot", "A");
  });
});

// Issue #1376 — per-variant delete (X) on <VersionStrip>. The base seed
// leaves both variants empty on the Mask Room, so this block seeds two
// `InpaintVersion` rows (variantSlot 0/1) on `E2E_EDITOR_ROOM_ID` at
// test start, exercises the X + modal + selection-fallback +
// both-deleted empty state, and tears them down so other specs are
// unaffected. The seed runs against the suite's throwaway Postgres
// (the same one `tests/e2e/global-setup.ts` populates), driven by the
// `DATABASE_URL` that `nextEnv()` in `tests/e2e/env.ts` injects into
// the dev process — the exact same Prisma 7 driver-adapter pattern
// `tests/e2e/specs/inpaint-quota-ledger.spec.ts` uses.
test.describe("Edit Room redesign — version strip delete (issue #1376, flag=ON)", () => {
  const VARIANT_A_URL = "https://example.test/variant-a.png";
  const VARIANT_B_URL = "https://example.test/variant-b.png";

  async function withSeededVariants<T>(
    fn: (prisma: PrismaClient) => Promise<T>,
  ): Promise<T> {
    const prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
    try {
      // Wipe any leftover rows for this room from a prior test run
      // (the suite Postgres is per-run, but a retry within the same
      // run could leave them — global-setup populates a different
      // room, so this is belt-and-braces).
      await prisma.inpaintVersion.deleteMany({
        where: { roomId: E2E_EDITOR_ROOM_ID },
      });
      await prisma.inpaintVersion.create({
        data: {
          roomId: E2E_EDITOR_ROOM_ID,
          variantSlot: 0,
          resultUrl: VARIANT_A_URL,
          thumbnailUrl: VARIANT_A_URL,
          seed: "1",
          promptDirectives: "variant A",
        },
      });
      await prisma.inpaintVersion.create({
        data: {
          roomId: E2E_EDITOR_ROOM_ID,
          variantSlot: 1,
          resultUrl: VARIANT_B_URL,
          thumbnailUrl: VARIANT_B_URL,
          seed: "2",
          promptDirectives: "variant B",
        },
      });
      return await fn(prisma);
    } finally {
      await prisma.inpaintVersion.deleteMany({
        where: { roomId: E2E_EDITOR_ROOM_ID },
      });
      await prisma.$disconnect();
    }
  }

  test("X icon appears on each populated variant thumbnail", async ({ page }) => {
    await withSeededVariants(async () => {
      await login(page);
      await openFocusedEditor(page, E2E_EDITOR_PROJECT_ID, "Mask Room");
      const strip = page.getByRole("region", { name: "Versions" });
      await expect(strip).toBeVisible();
      await expect(
        strip.getByTestId("edit-room-version-strip-delete-A"),
      ).toBeVisible();
      await expect(
        strip.getByTestId("edit-room-version-strip-delete-B"),
      ).toBeVisible();
      // Original slot is immutable: no X on it.
      await expect(
        strip.getByTestId("edit-room-version-strip-delete-original"),
      ).toHaveCount(0);
    });
  });

  test("Clicking X opens the confirm modal; Cancel dismisses without changes", async ({
    page,
  }) => {
    await withSeededVariants(async () => {
      await login(page);
      await openFocusedEditor(page, E2E_EDITOR_PROJECT_ID, "Mask Room");
      const strip = page.getByRole("region", { name: "Versions" });

      await strip.getByTestId("edit-room-version-strip-delete-A").click();
      const modal = page.getByTestId("edit-room-version-strip-delete-modal");
      await expect(modal).toBeVisible();
      await expect(
        modal.getByRole("heading", { name: "Delete variant A?" }),
      ).toBeVisible();
      // Both X icons stay in place — Cancel must not delete anything.
      await expect(
        strip.getByTestId("edit-room-version-strip-delete-A"),
      ).toBeVisible();
      await expect(
        strip.getByTestId("edit-room-version-strip-delete-B"),
      ).toBeVisible();

      await page.getByTestId("edit-room-version-strip-delete-cancel").click();
      await expect(modal).toBeHidden();
      await expect(
        strip.getByTestId("edit-room-version-strip-delete-A"),
      ).toBeVisible();
    });
  });

  test("Confirming removes the variant from the strip and its versions", async ({
    page,
  }) => {
    await withSeededVariants(async (prisma) => {
      await login(page);
      await openFocusedEditor(page, E2E_EDITOR_PROJECT_ID, "Mask Room");
      const strip = page.getByRole("region", { name: "Versions" });

      await strip.getByTestId("edit-room-version-strip-delete-A").click();
      await page.getByTestId("edit-room-version-strip-delete-confirm").click();

      // After the server action + router.refresh(), A's X is gone
      // (variant A has no version rows anymore → empty slot renders
      // the placeholder, no delete button).
      await expect(
        strip.getByTestId("edit-room-version-strip-delete-A"),
      ).toHaveCount(0);
      await expect(
        strip.getByTestId("edit-room-version-strip-delete-B"),
      ).toBeVisible();

      // DB sanity: only B remains for this room.
      const remaining = await prisma.inpaintVersion.findMany({
        where: { roomId: E2E_EDITOR_ROOM_ID },
        select: { variantSlot: true },
      });
      expect(remaining.map((r) => r.variantSlot).sort()).toEqual([1]);
    });
  });

  test("Deleting the selected variant falls back to the remaining one", async ({
    page,
  }) => {
    await withSeededVariants(async () => {
      await login(page);
      await openFocusedEditor(page, E2E_EDITOR_PROJECT_ID, "Mask Room");
      const studio = page.getByTestId(NEW_STUDIO_TESTID);
      const strip = page.getByRole("region", { name: "Versions" });

      // The seed Mask Room has selectedVariantIndex=0 → viewing starts on A.
      await expect(studio).toHaveAttribute("data-viewing", "A");

      await strip.getByTestId("edit-room-version-strip-delete-A").click();
      await page.getByTestId("edit-room-version-strip-delete-confirm").click();

      // A is gone, B becomes the viewing slot.
      await expect(studio).toHaveAttribute("data-viewing", "B");
    });
  });

  test("Deleting the non-selected variant keeps the selection on the still-present one", async ({
    page,
  }) => {
    await withSeededVariants(async () => {
      await login(page);
      await openFocusedEditor(page, E2E_EDITOR_PROJECT_ID, "Mask Room");
      const studio = page.getByTestId(NEW_STUDIO_TESTID);
      const strip = page.getByRole("region", { name: "Versions" });

      // Currently viewing A. Delete B — the selection should stay on A.
      await expect(studio).toHaveAttribute("data-viewing", "A");
      await strip.getByTestId("edit-room-version-strip-delete-B").click();
      await page.getByTestId("edit-room-version-strip-delete-confirm").click();

      await expect(studio).toHaveAttribute("data-viewing", "A");
      await expect(
        strip.getByTestId("edit-room-version-strip-delete-B"),
      ).toHaveCount(0);
      await expect(
        strip.getByTestId("edit-room-version-strip-delete-A"),
      ).toBeVisible();
    });
  });

  test("Deleting both variants leaves only the original before-photo and no delete buttons", async ({
    page,
  }) => {
    await withSeededVariants(async () => {
      await login(page);
      await openFocusedEditor(page, E2E_EDITOR_PROJECT_ID, "Mask Room");
      const studio = page.getByTestId(NEW_STUDIO_TESTID);
      const strip = page.getByRole("region", { name: "Versions" });

      // Delete A first, then B.
      await strip.getByTestId("edit-room-version-strip-delete-A").click();
      await page.getByTestId("edit-room-version-strip-delete-confirm").click();
      await expect(
        strip.getByTestId("edit-room-version-strip-delete-A"),
      ).toHaveCount(0);

      await strip.getByTestId("edit-room-version-strip-delete-B").click();
      await page.getByTestId("edit-room-version-strip-delete-confirm").click();
      await expect(
        strip.getByTestId("edit-room-version-strip-delete-B"),
      ).toHaveCount(0);

      // Both variants gone → viewing falls back to "original".
      await expect(studio).toHaveAttribute("data-viewing", "original");
    });
  });
});