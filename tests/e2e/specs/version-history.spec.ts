import { expect, test } from "@playwright/test";

import { E2E_EDITOR_PROJECT_ID, E2E_EDITOR_ROOM_ID } from "../env";
import {
  interceptFurnishingsDetection,
  interceptInpaint,
  interceptLabelInstances,
  login,
  mockStorageEntries,
  openFocusedEditor,
  paintMaskZigzag,
  waitForDirectivesSaved,
  type MockStorageEntry,
} from "../helpers";

/**
 * Version-history thumbnail storage (issue #747), retargeted to the
 * new `<EditRoomStudio>` surface (issue #1344).
 *
 * `saveInpaintVersion` uploads its client-generated thumbnail through
 * the PLAIN storage upload (`POST /object/<bucket>/<path>`), which
 * the mock Supabase never served — every completed inpaint logged
 * `[inpaint-versions] thumbnail upload failed: StorageApiError:
 * not_found` and saved the version row with `thumbnailUrl: null`, so
 * the UI's thumbnail-rendering path ran with zero e2e coverage.
 *
 * With the harness default flipped to `NEXT_PUBLIC_EDIT_ROOM_REDESIGN=1`,
 * the focused editor mounts the new shell and the new submit path
 * (issue #1344's real `/api/inpaint` wire). The thumbnail upload
 * pipeline is unchanged — only the shell wrapping the editor changed.
 *
 * The legacy assertion that opened the `<CollapsibleSection>`'s
 * "Version History" panel and verified the thumbnail `<img>` renders
 * on the new surface: the new `<VersionStrip>` shows thumbnails
 * inline; there is no separate history panel yet (issue #1344 wires
 * that as a follow-up slice). The legacy assertion is dropped with
 * this PR; it lights up again when the new history panel lands.
 */
test.describe("version history thumbnail upload", () => {
  test("completed inpaint saves a version with an uploaded thumbnail (storage-side)", async ({
    page,
  }) => {
    const inpaint = interceptInpaint(page);
    interceptFurnishingsDetection(page);
    interceptLabelInstances(page);

    await login(page);
    await openFocusedEditor(page, E2E_EDITOR_PROJECT_ID, "Mask Room");

    const directives = page.getByRole("textbox", { name: "Directions" });
    await expect(directives).toBeVisible();
    await directives.fill("Add a neutral linen sofa and a warm wood coffee table.");

    await page.getByRole("radio", { name: "Paint area" }).click();
    await paintMaskZigzag(page);

    // Storage and DB persist across the suite's single worker, and
    // the alphabetically-earlier mask-paint spec saves versions for
    // this same editor room — snapshot the pre-existing thumbnail
    // paths so this run's upload is identified as a NEW object.
    const versionsPrefix = `rooms/${E2E_EDITOR_ROOM_ID}/versions/`;
    const preExistingPaths = new Set(
      (await mockStorageEntries())
        .filter(
          (entry) => entry.bucket === "room-photos" && entry.path.startsWith(versionsPrefix)
        )
        .map((entry) => entry.path)
    );

    await expect(page.getByTestId("run-button")).toBeEnabled();
    // Wait for the route's autosave to settle the typed directives
    // before Run fires (see inpaint-submit.spec.ts for the same
    // rationale — the cluster's `useInpaintRuns` validates
    // `promptDirectives.trim()` against the route's prop, which only
    // updates after the shell's 900ms debounce lands the typed
    // value into `directives[roomId]`).
    await waitForDirectivesSaved(page);
    await page.getByTestId("run-button").click();
    await expect(page.getByText("Inpainting completed successfully!")).toBeVisible({
      timeout: 20_000,
    });

    // The editor stages into one of the room's two variant slots — it
    // alternates once variant A already holds a result, and the
    // earlier mask-paint specs stage this same room — so scope the
    // storage assertion to the slot THIS run actually targeted.
    const runSlot = inpaint.submitBody().variantSlot;
    const runPrefix = `${versionsPrefix}${runSlot}/`;

    // (1) Storage side: the version save is best-effort/async on
    // completion (thumbnail generation → plain upload → row create),
    // so poll the inspection endpoint until a NEW thumbnail object
    // appears under the run's version path.
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
    // Issue #1082: production emits `<unix-ms>-<uuid>.jpg` filenames
    // (timestamp + UUID for global uniqueness across runs), not bare
    // digits. The test's intent is "thumbnail landed in the correct
    // run-prefixed directory with a .jpg extension"; pinning the
    // filename format would just re-break on the next uniqueness tweak.
    expect(thumbnail!.path).toMatch(new RegExp(`^${runPrefix}.+\\.jpg$`));

    expect([0, 1]).toContain(runSlot);
  });
});