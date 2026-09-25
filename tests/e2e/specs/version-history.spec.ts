import { expect, test } from "@playwright/test";

import { E2E_EDITOR_PROJECT_ID, E2E_EDITOR_ROOM_ID } from "../env";
import {
  interceptFurnishingsDetection,
  interceptInpaint,
  interceptLabelInstances,
  login,
  mockStorageEntries,
  openEditorTab,
  openFocusedEditor,
  paintMaskZigzag,
  type MockStorageEntry,
} from "../helpers";

/**
 * Version-history thumbnails (issue #747).
 *
 * saveInpaintVersion uploads its client-generated thumbnail through the
 * PLAIN storage upload (`POST /object/<bucket>/<path>`), which the mock
 * Supabase never served — every completed inpaint logged
 * `[inpaint-versions] thumbnail upload failed: StorageApiError: not_found`
 * and saved the version row with `thumbnailUrl: null`, so the UI's
 * thumbnail-rendering path ran with zero e2e coverage. This spec pins the
 * repaired contract end-to-end through a real inpaint run:
 *   1. the thumbnail lands as real JPEG bytes in mock storage via the
 *      plain upload path (`/__e2e/storage` inspection endpoint);
 *   2. the Version History panel renders the saved version's <img>
 *      thumbnail — not the clock-icon fallback a null thumbnailUrl
 *      degrades to — with decodable bytes behind it.
 */
test.describe("version history thumbnails", () => {
  test("completed inpaint saves a version with an uploaded, rendered thumbnail", async ({
    page,
  }) => {
    const inpaint = interceptInpaint(page);
    // Issue #252: the editor-open auto-fire + billed detections must land
    // on the network-layer mocks, never the paid routes.
    interceptFurnishingsDetection(page);
    interceptLabelInstances(page);

    await login(page);
    await openFocusedEditor(page, E2E_EDITOR_PROJECT_ID, "Mask Room");

    const directives = page.getByLabel("Staging directives (required)");
    await expect(directives).toBeVisible();
    await directives.fill("Add a neutral linen sofa and a warm wood coffee table.");

    await openEditorTab(page, "Manual paint");
    await paintMaskZigzag(page);

    // Storage and DB persist across the suite's single worker, and the
    // alphabetically-earlier mask-paint specs save versions for this same
    // editor room — snapshot the pre-existing thumbnail paths so this
    // run's upload is identified as a NEW object.
    const versionsPrefix = `rooms/${E2E_EDITOR_ROOM_ID}/versions/`;
    const preExistingPaths = new Set(
      (await mockStorageEntries())
        .filter(
          (entry) => entry.bucket === "room-photos" && entry.path.startsWith(versionsPrefix)
        )
        .map((entry) => entry.path)
    );

    await page.getByRole("button", { name: "Generate", exact: true }).click();
    await expect(page.getByText("Inpainting completed successfully!")).toBeVisible({
      timeout: 20_000,
    });
    // The staged-result section renders once the room PATCH persisted the
    // result the version row will point at.
    await expect(page.getByRole("heading", { name: "Staged result" })).toBeVisible({
      timeout: 20_000,
    });

    // The editor stages into one of the room's two variant slots — it
    // alternates once variant A already holds a result, and the earlier
    // mask-paint specs stage this same room — so scope the storage
    // assertion to the slot THIS run actually targeted.
    const runSlot = inpaint.submitBody().variantSlot;
    const runPrefix = `${versionsPrefix}${runSlot}/`;

    // (1) Storage side: the version save is best-effort/async on
    // completion (thumbnail generation → plain upload → row create), so
    // poll the inspection endpoint until a NEW thumbnail object appears
    // under the run's version path.
    const isNewThumbnail = (entry: MockStorageEntry): boolean =>
      entry.bucket === "room-photos" &&
      entry.path.startsWith(runPrefix) &&
      !preExistingPaths.has(entry.path);

    await expect
      .poll(
        async () => (await mockStorageEntries()).filter(isNewThumbnail).length,
        { timeout: 20_000 }
      )
      .toBeGreaterThan(0);

    const thumbnail = (await mockStorageEntries()).find(isNewThumbnail);
    expect(thumbnail, "a new version thumbnail object must be stored").toBeDefined();
    expect(thumbnail!.contentType, "the thumbnail must store as image/jpeg").toBe("image/jpeg");
    expect(thumbnail!.size, "the thumbnail must carry the generated JPEG bytes").toBeGreaterThan(
      0
    );
    expect(thumbnail!.path).toMatch(new RegExp(`^${runPrefix}\\d+\\.jpg$`));

    // (2) UI side: open the Version History panel. The CollapsibleSection
    // renders expanded by default (fresh context, empty localStorage), so
    // scoping to its content container reaches the panel's own trigger —
    // the save already landed, so loadVersions will include this run's row.
    await page
      .locator("#collapsible-panel-variantPanel")
      .getByRole("button", { name: /^Version History( \d+)?$/ })
      .click();

    // The thumbnail tile renders an <img> when thumbnailUrl is set; a null
    // thumbnailUrl degrades to the clock-icon fallback (no img at all).
    // The panel is scoped to the same variant slot this run staged into,
    // so its grid holds this run's version (plus any earlier same-slot
    // ones) — any rendered <img> exercises the public-URL → next/image
    // thumbnail pipeline.
    const thumbnailImage = page
      .locator("#collapsible-panel-variantPanel")
      .locator('img[alt^="Version from"]');
    await expect(thumbnailImage.first()).toBeVisible({ timeout: 15_000 });

    // Visible ≠ loaded: next/image <img> elements enter the DOM before
    // their optimized bytes arrive, so poll until the browser has actually
    // decoded the public-URL → next/image pipeline's response.
    await expect
      .poll(
        async () =>
          await thumbnailImage.first().evaluate((el) => (el as HTMLImageElement).naturalWidth),
        { timeout: 15_000 }
      )
      .toBeGreaterThan(0);

    // Defense in depth on the wire contract: the run carried a valid slot
    // and the storage assertion above bound the saved thumbnail to it.
    expect([0, 1]).toContain(runSlot);
  });
});
