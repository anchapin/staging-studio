import { expect, test } from "@playwright/test";

import { roomPhotoFixture } from "../fixtures";
import { E2E_REHEARSAL_PROJECT_ID, E2E_REHEARSAL_ROOM_ID } from "../env";
import {
  interceptExportPdf,
  interceptFurnishingsDetection,
  interceptGenerateCopy,
  interceptInpaint,
  interceptLabelInstances,
  login,
  mockStorageEntries,
  openEditorTab,
  paintMaskZigzag,
  uploadRoomPhotoViaUi,
  whitePixelShare,
} from "../helpers";

const REHEARSAL_PROJECT = `/projects/${E2E_REHEARSAL_PROJECT_ID}`;
const DIRECTIVES = "Stage the room for a growing family: neutral sofa, layered lighting, warm wood.";

/**
 * The T10 rehearsal drill, scripted (issue #165 acceptance criterion 3;
 * drill defined in #163).
 *
 * One unbroken chain through the real UI — login → project → upload →
 * paint mask → inpaint → copy → export — with every third-party provider
 * (fal.ai, OpenAI, Browserless) simulated at the browser network layer so
 * the run is hermetic and deterministic. The failure drills pin the
 * fallback reveals: a terminal inpaint failure and a simulated export
 * outage must both surface actionable error UI, never a dead end.
 */
test.describe("rehearsal drill", () => {
  test("login → project → upload → mask → inpaint → copy → export runs green", async ({
    page,
  }) => {
    const file = roomPhotoFixture();
    const inpaint = interceptInpaint(page);
    // Issue #231: the editor auto-fires a SAM 3.1 detection on open —
    // both editor visits are covered by this one interception.
    interceptFurnishingsDetection(page);
    interceptLabelInstances(page); // issue #252: billed detections label via OpenAI — keep it mocked
    interceptGenerateCopy(page);
    interceptExportPdf(page, "success");

    await login(page);

    // ---- Upload -------------------------------------------------------
    await page.goto(REHEARSAL_PROJECT);
    await expect(page.getByRole("heading", { name: "Rehearsal Room" })).toBeVisible();
    const { putSha256 } = await uploadRoomPhotoViaUi(
      page,
      {
        name: "rehearsal-photo.png",
        mimeType: "image/png",
        buffer: file,
      },
      "Rehearsal Room"
    );
    // Scoped to the Rehearsal Room card — the project seeds a second
    // room (issue #250) whose photos also render with alt="Room".
    await expect(
      page
        .locator(".space-y-3", { hasText: "Rehearsal Room" })
        .locator('img[alt="Room"]')
    ).toBeVisible({ timeout: 15_000 });

    // ---- Focused editor (grid → focused, issue #169 flow) --------------
    await page
      .locator(".space-y-3", { hasText: "Rehearsal Room" })
      .getByRole("button", { name: "Edit staging" })
      .click();
    await expect(page.getByRole("button", { name: "All rooms" })).toBeVisible();

    // ---- Directives + mask --------------------------------------------
    // ("Staging directives (required)" is the Room Details field — the
    // Manual paint panel's inline mirror carries a distinct label since
    // issue #742, so this locator stays unique.)
    await page.getByLabel("Staging directives (required)").fill(DIRECTIVES);
    await paintMaskZigzag(page);
    // Issue #252: the single-object run affordance lives in the Manual
    // paint tab; the editor opens on Auto detect (flag on). The run
    // button reads "Generate" since #629's operation mode tabs.
    await openEditorTab(page, "Manual paint");
    const applyButton = page.getByRole("button", { name: "Generate", exact: true });
    await expect(applyButton).toBeEnabled();

    // ---- Inpaint (fal.ai simulated) ------------------------------------
    await applyButton.click();
    await expect(page.getByText("Inpainting completed successfully!")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("heading", { name: "Staged result" })).toBeVisible({
      timeout: 20_000,
    });

    const body = inpaint.submitBody();
    expect(body.roomId).toBe(E2E_REHEARSAL_ROOM_ID);
    expect(body.promptDirectives).toBe(DIRECTIVES);
    const whiteShare = await whitePixelShare(page, inpaint.maskDataUrl());
    expect(whiteShare).toBeGreaterThan(0.01);

    // The staged image persisted through the real room PATCH route: a
    // fresh navigation (server-rendered from the database, back in the
    // all-rooms grid since editor state is client-side) still shows it.
    await page.reload();
    await expect(
      page.locator('img[alt="Rehearsal Room staged — Variant A"]')
    ).toBeVisible({ timeout: 20_000 });

    // Back into the focused editor for the copy + export legs.
    await page
      .locator(".space-y-3", { hasText: "Rehearsal Room" })
      .getByRole("button", { name: "Edit staging" })
      .click();
    await expect(page.getByRole("button", { name: "All rooms" })).toBeVisible();

    // ---- Copy (OpenAI simulated) ---------------------------------------
    // Copy generation reads the room's shared staging directives — the
    // Room copy section no longer carries its own directives box (its
    // hint now points at the Room Details field), so seed the copy run
    // through that field (issue #742).
    const copyForm = page.locator('section[aria-label="Room copy"]');
    await page
      .getByLabel("Staging directives (required)")
      .fill("Key priorities: brighten, declutter, and define a seating area.");
    await copyForm.getByRole("button", { name: "Generate Copy" }).click();
    await expect(page.getByText("Copy generated successfully!")).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.getByText("E2E: anchor the seating area with a neutral sofa and layered lighting.")
    ).toBeVisible();
    await expect(page.getByText("Pack away personal photos")).toBeVisible();

    // ---- Export (Browserless simulated, success) ------------------------
    // Export lives on the lookbook page (issue #250 feedback): the book
    // is previewed before the PDF API is paid for.
    await page.goto(`${REHEARSAL_PROJECT}/lookbook`);
    await expect(
      page.getByRole("button", { name: "Export PDF" })
    ).toBeVisible();
    // Register the download listener BEFORE the click: the intercepted
    // fetch resolves in milliseconds, and a late listener misses the
    // event entirely.
    const downloadPromise = page.waitForEvent("download", { timeout: 20_000 });
    await page.getByRole("button", { name: "Export PDF" }).click();
    expect((await downloadPromise).suggestedFilename()).toBe("303 Rehearsal Road.pdf");
    await expect(page.getByText("PDF exported successfully!")).toBeVisible();

    // ---- Byte-identity of the upload this rehearsal performed -----------
    const stored = await mockStorageEntries();
    const roomObject = stored.find(
      (entry) =>
        entry.bucket === "room-photos" &&
        entry.path === `rooms/${E2E_REHEARSAL_ROOM_ID}/before-image.png`
    );
    expect(roomObject).toBeDefined();
    expect(roomObject!.size).toBeGreaterThan(0);
    expect(roomObject!.sha256).toBe(putSha256);
  });

  test("failure drill: terminal inpaint error reveals error UI with retry", async ({
    page,
  }) => {
    const inpaint = interceptInpaint(page);
    inpaint.respondWithTerminalFailure();
    interceptFurnishingsDetection(page); // editor-open auto-fire stays hermetic
    interceptLabelInstances(page); // issue #252: keep the labeling call mocked too

    await login(page);
    await page.goto(REHEARSAL_PROJECT);

    // The drill needs an image + mask. Upload from the all-rooms grid
    // BEFORE entering the focused editor: since #450 the focused editor
    // shows its own source-image canvas (RoomCanvas is hidden while the
    // InpaintEditor is active), so the room card's upload/replace
    // affordance only exists in the grid view.
    await uploadRoomPhotoViaUi(
      page,
      {
        name: "rehearsal-photo.png",
        mimeType: "image/png",
        buffer: roomPhotoFixture(),
      },
      "Rehearsal Room"
    );

    await page
      .locator(".space-y-3", { hasText: "Rehearsal Room" })
      .getByRole("button", { name: "Edit staging" })
      .click();

    await page.getByLabel("Staging directives (required)").fill(DIRECTIVES);
    await paintMaskZigzag(page);
    // Issue #252: the single-object run affordance lives in the Manual
    // paint tab; the editor opens on Auto detect (flag on).
    await openEditorTab(page, "Manual paint");

    await page.getByRole("button", { name: "Generate", exact: true }).click();

    // The submit itself succeeds (interception), then polling reports the
    // terminal failure — the fallback reveal must name the problem and
    // offer a retry, never dead-end.
    await expect(
      page.getByText("Simulated: inpaint request expired before completion.")
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Retry inpainting" })).toBeVisible();
  });

  test("failure drill: export outage reveals error UI with retry", async ({ page }) => {
    interceptExportPdf(page, "outage");

    await login(page);
    // Export lives on the lookbook page (issue #250 feedback).
    await page.goto(`${REHEARSAL_PROJECT}/lookbook`);

    await page.getByRole("button", { name: "Export PDF" }).click();

    await expect(page.getByText("Simulated Browserless outage (e2e drill).")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("button", { name: "Retry PDF export" })).toBeVisible();
  });
});
