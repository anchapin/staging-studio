import { expect, test } from "@playwright/test";

import { roomPhotoFixture } from "../fixtures";
import { E2E_UPLOAD_ROOM_ID } from "../env";
import {
  login,
  mockStorageEntries,
  uploadProjectUrl,
  uploadRoomPhotoViaUi,
} from "../helpers";

/**
 * Upload flow (issue #165 acceptance criterion 2).
 *
 * The PoC's fake-FileList driver "succeeded" (signed-URL PUT returned
 * 200) while storing a 0-byte object. This spec uploads REAL bytes via
 * Playwright's file-input integration through the app's real UI —
 * signed-URL action, browser PUT, confirm action, Prisma link — and pins
 * both halves of the contract:
 *   1. the PUT is non-empty (the 0-byte-object regression);
 *   2. byte identity between the browser's PUT body and the object the
 *      mock storage actually received (sha256 equality).
 *
 * The PUT body intentionally differs from the original fixture: the app
 * re-encodes uploads client-side (browser-image-compression), so the
 * meaningful invariant is wire↔storage identity, not fixture↔storage.
 */
test.describe("room photo upload", () => {
  test("stores a byte-identical object in storage", async ({ page }) => {
    const file = roomPhotoFixture();

    await login(page);
    await page.goto(uploadProjectUrl());
    await expect(page.getByRole("heading", { name: "Upload Room" })).toBeVisible();

    const { putSha256, putSize } = await uploadRoomPhotoViaUi(page, {
      name: "room-photo.png",
      mimeType: "image/png",
      buffer: file,
    });

    expect(putSize, "PUT body must not be empty (PoC stored 0-byte objects)").toBeGreaterThan(0);
    expect(putSize).toBeLessThanOrEqual(2048 * 2048);

    const stored = await mockStorageEntries();
    const roomObject = stored.find(
      (entry) =>
        entry.bucket === "room-photos" &&
        entry.path === `rooms/${E2E_UPLOAD_ROOM_ID}/before-image.png`
    );
    expect(roomObject, "mock storage must have received the upload").toBeDefined();
    expect(roomObject!.size, "storage size must equal the PUT body size").toBe(putSize);
    expect(roomObject!.sha256, "storage bytes must be byte-identical to the PUT body").toBe(
      putSha256
    );
    expect(roomObject!.contentType).toMatch(/^image\//);
  });

  test("renders the linked photo in the room frame after upload", async ({ page }) => {
    const file = roomPhotoFixture();

    await login(page);
    await page.goto(uploadProjectUrl());

    await uploadRoomPhotoViaUi(page, {
      name: "room-photo.png",
      mimeType: "image/png",
      buffer: file,
    });

    // onUploadComplete swapped the empty frame for the linked photo
    // (served by the mock storage public URL through next/image).
    await expect(page.locator('img[alt="Room"]')).toBeVisible({ timeout: 15_000 });
  });
});
