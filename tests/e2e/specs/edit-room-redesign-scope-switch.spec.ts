import { expect, test } from "@playwright/test";

import { E2E_EDITOR_PROJECT_ID } from "../env";
import { login, openFocusedEditor } from "../helpers";

/**
 * Issue #1344 — `NEXT_PUBLIC_EDIT_ROOM_REDESIGN=1` is set by
 * `tests/e2e/env.ts`'s `nextEnv()` so the e2e harness boots the
 * new `<EditRoomStudio>` surface (and the existing mask-paint /
 * concept-flow / version-history specs got their selectors
 * updated for the same surface). This spec pins the
 * flag-on path's *minimum*: the new studio renders, the segmented
 * scope control swaps the inspector body, and the directions
 * textarea autosaves through the new surface's debounced
 * controller.
 *
 * Why these three assertions:
 * - "new studio renders" is the contract — without it every other
 *   flag-on spec is moot.
 * - "scope switches swap the inspector body" is the design's
 *   primary interaction (whole-room → objects → paint area →
 *   inspector body changes accordingly).
 * - "Directions autosaves → Saved indicator flips" is the
 *   existing #496 contract (route-level autosave controller),
 *   re-asserted on the new surface.
 */

const NEW_STUDIO_TESTID = "edit-room-studio";

// Issue #1344 — `NEXT_PUBLIC_EDIT_ROOM_REDESIGN` is build-time inlined
// at `"1"` (see tests/e2e/env.ts) so the new `<EditRoomStudio>`
// surface is live for the whole suite. The four `edit-room-redesign-*`
// specs exercise the wired-up submit path; the legacy specs were
// updated to the new surface's selectors in the same PR.
test.describe("Edit Room redesign — scope switch (issue #1344, flag=ON)", () => {
  test("with the flag on, the new studio renders under /projects/[id]", async ({
    page,
  }) => {
    await login(page);
    await openFocusedEditor(page, E2E_EDITOR_PROJECT_ID, "Mask Room");

    // The new surface's root container carries `data-testid="edit-room-studio"`.
    // The legacy `<InpaintEditor>` does NOT render that testid, so its
    // presence is a clean positive pin for the redesign surface.
    await expect(page.getByTestId(NEW_STUDIO_TESTID)).toBeVisible();

    // The TopBar's "All rooms" exit button (data-testid absent on the
    // legacy surface, which uses an `<ArrowLeft>` icon-only link).
    await expect(
      page.getByRole("button", { name: "Exit to all rooms" })
    ).toBeVisible();
  });

  test("scope segmented control swaps the inspector body", async ({ page }) => {
    await login(page);
    await openFocusedEditor(page, E2E_EDITOR_PROJECT_ID, "Mask Room");
    await expect(page.getByTestId(NEW_STUDIO_TESTID)).toBeVisible();

    // The StagePanel's segmented control renders three radios under the
    // "What should change?" heading. Initial scope = whole-room; click
    // "Objects" → inspector body swaps to the objects-scope affordances.
    const wholeRoom = page.getByRole("radio", { name: "Whole room" });
    const objects = page.getByRole("radio", { name: "Objects" });
    const paintArea = page.getByRole("radio", { name: "Paint area" });
    await expect(wholeRoom).toBeChecked();

    await objects.click();
    // The Objects scope swaps the inspector body to the chip-row +
    // object-list pattern. On the ORIGINAL photo (the studio's default
    // viewing), the panel renders an explanatory notice — the chip
    // row + DetectedObjectList only mount when `viewing !== "original"`,
    // because picking objects off an empty room is meaningless. The
    // notice text comes from src/components/edit-room/StagePanel.tsx
    // (lines 217–222).
    await expect(
      page.getByText(/The original photo is empty\./)
    ).toBeVisible();

    await paintArea.click();
    // Paint-area scope swaps to a status line. The StagePanel renders
    // "Brush over the part of the photo…" (no mask yet) and
    // "Area painted. Start over" once the mask is non-empty
    // (StagePanel.tsx lines 238–255).
    await expect(
      page.getByText(/Brush over the part of the photo/)
    ).toBeVisible();

    // And back to whole-room to leave the suite deterministic.
    await wholeRoom.click();
    await expect(wholeRoom).toBeChecked();
  });

  test("Directions textarea autosaves — 'Saved' indicator flips", async ({
    page,
  }) => {
    // Issue #496 contract re-asserted: the route's AutosaveController's
    // status pill flips from default → Saving… → Saved once a typed
    // directive persists through the 2s idle window. The new studio
    // forwards `saveStatus` to its TopBar pill, so the assertion is
    // identical to the legacy flow but on the new surface.
    await login(page);
    await openFocusedEditor(page, E2E_EDITOR_PROJECT_ID, "Mask Room");
    await expect(page.getByTestId(NEW_STUDIO_TESTID)).toBeVisible();

    // The StagePanel's Directions textarea has id="directions" and
    // is labelled "Directions" (NOT "Staging directives (required)",
    // which is the legacy `<InpaintEditor>` label).
    const directions = page.getByRole("textbox", { name: "Directions" });
    await expect(directions).toBeVisible();
    await directions.fill("Modern coastal palette with linen sofa.");

    // Wait out the autosave window (default 1000ms in AutosaveController;
    // the project view uses 2000ms via the directives controller per
    // #496). Allow 4s for the Saving… → Saved flip.
    await expect(page.getByText("Saved")).toBeVisible({ timeout: 4_000 });
  });
});