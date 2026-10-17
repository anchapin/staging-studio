import { expect, test } from "@playwright/test";

import { roomPhotoFixture } from "../fixtures";
import { E2E_REHEARSAL_PROJECT_ID, E2E_REHEARSAL_ROOM_ID } from "../env";
import {
  interceptExportPdf,
  interceptFurnishingsDetection,
  interceptInpaint,
  interceptLabelInstances,
  login,
  mockStorageEntries,
  paintMaskZigzag,
  uploadRoomPhotoViaUi,
  waitForDirectivesSaved,
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
    // The redesign's `<CopyPanel>` (issue #1343) posts to
    // `/api/v1/listing-copy` instead of the legacy `/api/generate-copy` —
    // mock the new route directly in this spec (the helper used by
    // `edit-room-redesign-copypanel.spec.ts` is intentionally local
    // there, not exported to `helpers.ts`, since the legacy surface no
    // longer has a buyer for it).
    interceptRehearsalListingCopy(page);
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
    await expect(
      page.getByRole("button", { name: "All rooms", exact: true })
    ).toBeVisible();

    // ---- Directives + mask --------------------------------------------
    // The new surface's Directions textarea (label = "Directions" —
    // see StagePanel.tsx lines 263–268). The legacy "Staging
    // directives (required)" label lives on the legacy mount only and
    // is unreachable when the harness default is `1`.
    await page.getByRole("textbox", { name: "Directions" }).fill(DIRECTIVES);
    // The new surface's Paint area scope radio accepts brush strokes.
    await page.getByRole("radio", { name: "Paint area" }).click();
    await paintMaskZigzag(page);
    const applyButton = page.getByTestId("run-button");
    await expect(applyButton).toBeEnabled();
    // Wait for the route's autosave to settle the typed directives
    // before Run fires (see inpaint-submit.spec.ts for the same
    // rationale — the cluster's `useInpaintRuns` validates
    // `promptDirectives.trim()` against the route's prop, which only
    // updates after the shell's 900ms debounce lands the typed
    // value into `directives[roomId]`).
    await waitForDirectivesSaved(page);

    // ---- Inpaint (fal.ai simulated) ------------------------------------
    await applyButton.click();
    await expect(page.getByText("Inpainting completed successfully!")).toBeVisible({
      timeout: 20_000,
    });
    // Post-inpaint confirmation: the new `<VersionStrip>` (issue
    // #1340) repaints the slot's caption from "Empty" to "First
    // pass" once `v.url` lands (VersionStrip.tsx:144–150). The
    // section's `aria-label="Versions"` scopes the search so it
    // doesn't match the empty default state on mount. The legacy
    // "Staged result" heading lived on the pre-redesign surface; PR
    // #1355 retargeted every other selector to the redesign, this
    // spec missed the retarget in that pass.
    await expect(
      page
        .getByRole("region", { name: "Versions" })
        .getByText("First pass", { exact: true })
    ).toBeVisible({ timeout: 20_000 });

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

    // Back into the project dashboard for the copy + export legs.
    await page
      .locator(".space-y-3", { hasText: "Rehearsal Room" })
      .getByRole("button", { name: "Edit staging" })
      .click();
    await expect(
      page.getByRole("button", { name: "All rooms", exact: true })
    ).toBeVisible();
    // Issue #1361 — `EditRoomRunCluster.beginRun` (via the route's
    // `beforeRun` flush hook) awaits the directive autosave
    // controller's `flush()` before `submitInpaint`, so the inpaint
    // submission on the first Run click above landed with
    // `DIRECTIVES` already persisted to `Room.rawDirectives` — i.e.
    // the autosave race that previously required this workaround
    // is closed. Combined with #1359's `initialDirections` prop +
    // lazy reducer initializer, the textarea on this re-mounted
    // studio carries the autosaved value verbatim. No refill.
    // (Pre-#1361 workarounds commented in the prior handoff at
    // .handoffs/2026-10-16-directions-rehydration-mini-slice.md.)

    // ---- Copy (OpenAI simulated) ---------------------------------------
    // The redesign's `<CopyPanel>` reads its `directions` brief from
    // the shared Staging-tab textarea (already populated by the inpaint
    // leg above), exposes `<Headline>` / `<Description>` inputs, and
    // persists the rewrite via `POST /api/v1/listing-copy` (issue
    // #1343). The success path writes the rewrite's `headline`/`body`
    // straight into the two inputs (no toast on success) — that's
    // what we wait on. The CTA's `canRewrite` (CopyPanel.tsx:85) is
    // already enabled because `DIRECTIVES` is non-empty from the
    // inpaint leg.
    await page.getByTestId("inspector-tab-copy").click();
    await expect(page.getByTestId("copy-panel")).toBeVisible();
    await page.getByTestId("copy-rewrite-button").click();
    await expect(page.getByLabel("Headline")).toHaveValue(
      "E2E: anchor the seating area with a neutral sofa and layered lighting."
    );
    await expect(page.getByLabel("Description")).toHaveValue(
      "E2E: buyers picture slow mornings in a calm, finished space."
    );

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

    await page.getByRole("textbox", { name: "Directions" }).fill(DIRECTIVES);
    await page.getByRole("radio", { name: "Paint area" }).click();
    await paintMaskZigzag(page);

    await expect(page.getByTestId("run-button")).toBeEnabled();
    await waitForDirectivesSaved(page);
    await page.getByTestId("run-button").click();

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

/**
 * Local helper: mocks `POST /api/v1/listing-copy` (issue #1343's
 * rewrite route) with the same `{ success, data: { headline, body } }`
 * shape the real route returns. Mirrors the inline mock in
 * `edit-room-redesign-copypanel.spec.ts` — kept local here because
 * the rehearsal spec is the only other consumer; promoting to
 * `helpers.ts` would add API surface area for a single additional
 * caller. The fixed `headline` / `body` strings are the spec's
 * post-rewrite assertions — changing them would fail the test
 * loudly.
 *
 * The mock runs at the browser network layer (`page.route`); the
 * real `/api/v1/listing-copy` route never executes, so the
 * `OPENAI_API_KEY` is not exercised. (Same hermeticity guarantee
 * the previous `interceptGenerateCopy` helper provided for the
 * legacy `/api/generate-copy` route.)
 */
function interceptRehearsalListingCopy(page: import("@playwright/test").Page): void {
  page.route("**/api/v1/listing-copy", (route) => {
    if (route.request().method() !== "POST") {
      void route.fallback();
      return;
    }
    void route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          headline:
            "E2E: anchor the seating area with a neutral sofa and layered lighting.",
          body: "E2E: buyers picture slow mornings in a calm, finished space.",
        },
        finishReason: "stop",
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        model: "gpt-4o-mini",
      }),
    });
  });
}
