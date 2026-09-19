import { expect, test } from "@playwright/test";

import {
  E2E_CONCEPT_PROJECT_ID,
  E2E_CONCEPT_ROOM_ID,
  SAM_TOOL_ENABLED_IN_E2E_BUILD,
} from "../env";
import { CONCEPT_INSTANCE_GRAYSCALE_MASKS } from "../cutout-png";
import {
  interceptFurnishingsDetection,
  interceptInpaint,
  interceptLabelInstances,
  login,
  openFocusedEditor,
  whitePixelShare,
} from "../helpers";

const CONSOLE_EVENT_PREFIX = "[concept-tool] ";

/**
 * SAM 3.1 concept find-and-replace, end to end (issue #231; #249 adds the
 * free-text normalization and select-all/clear affordances).
 *
 * The REAL UI path runs with the flag ON: the editor-open auto-fire, the
 * concept chips, the per-instance toggles, the #230 pre-filled prompts,
 * and the #229 batch dispatch — only the `fal-ai/sam-3-1/image`-backed
 * route is mocked, at the browser network layer, with two disjoint
 * instance masks in the LIVE grayscale format (white object on black, no
 * alpha channel — issue #248) so canvas clicks hit known instances
 * deterministically and the mask pipeline runs against what the provider
 * really serves. The alpha-cutout encoding stays pinned at unit level
 * (tests/mask-format.test.ts).
 *
 * Kill-switch semantics: when the flag is compiled OFF
 * (SAM_TOOL_ENABLED_IN_E2E_BUILD=false) the whole concept surface
 * disappears from the app, so this spec skips — flag-off runs never
 * exercise concept specs.
 */
test.describe("sam 3.1 concept find-and-replace flow", () => {
  test.skip(
    !SAM_TOOL_ENABLED_IN_E2E_BUILD,
    "concept tool is compiled off in the e2e build (kill switch); concept specs are skipped on flag-off runs"
  );

  test("auto-fire → chip switch → toggle instances → pre-filled prompts → batch dispatch → variant written", async ({
    page,
  }) => {
    const inpaint = interceptInpaint(page);
    const detection = interceptFurnishingsDetection(page);
    // Issue #252: the editor labels billed detections via ONE batched
    // OpenAI vision call — mocked here; cache hits must never re-fire it.
    const labeling = interceptLabelInstances(page);
    detection.respondWithMaskDataUrls(CONCEPT_INSTANCE_GRAYSCALE_MASKS);

    // The toggles emit the training-corpus event (W3 depends on the
    // shape); collect them for the shape assertion at the end.
    const selectionEvents: Array<Record<string, unknown>> = [];
    page.on("console", (message) => {
      const text = message.text();
      if (!text.startsWith(CONSOLE_EVENT_PREFIX)) return;
      try {
        selectionEvents.push(JSON.parse(text.slice(CONSOLE_EVENT_PREFIX.length)));
      } catch {
        // Non-JSON concept-tool lines are none of this spec's business.
      }
    });

    await login(page);
    // A dedicated seeded room (issue #231): this spec stages real variants
    // into its room, and specs share one database per suite run — the
    // brush/preset specs must never see this test's staged state.
    await openFocusedEditor(page, E2E_CONCEPT_PROJECT_ID, "Concept Room");

    // ---- 1. Editor-open auto-fire: the catch-all concept, once ---------
    await expect
      .poll(() => detection.requestCount(), { timeout: 15_000 })
      .toBe(1);
    const autoFireBody = detection.submitBody();
    expect(autoFireBody.roomId).toBe(E2E_CONCEPT_ROOM_ID);
    expect(autoFireBody.concept).toBe("furniture");
    expect(String(autoFireBody.imageUrl)).toContain(
      `/rooms/${E2E_CONCEPT_ROOM_ID}/before-image.png`
    );

    // ---- 2. Chip switch: one billed call per (image, concept) ----------
    await page.getByRole("button", { name: "sofa" }).click();
    await expect
      .poll(() => detection.requestCount(), { timeout: 15_000 })
      .toBe(2);
    expect(detection.submitBody().concept).toBe("sofa");

    // ---- 2b. Free-text concepts are case-normalized (#249) -------------
    // "Rug" reaches the route as "rug" (the server schema rejects
    // capitals) and bills ONE new (image, concept) call; the fixture
    // answers with the same two-instance response regardless of concept.
    await page.getByLabel("Custom concept:").fill("Rug");
    // exact: true — "Detect" would substring-match the "Select all
    // detected" affordance button (#249).
    await page.getByRole("button", { name: "Detect", exact: true }).click();
    await expect
      .poll(() => detection.requestCount(), { timeout: 15_000 })
      .toBe(3);
    expect(detection.submitBody().concept).toBe("rug");
    // Returning to sofa is a cache hit — zero billed calls.
    await page.getByRole("button", { name: "sofa" }).click();
    expect(detection.requestCount()).toBe(3);

    // Issue #252 (AC-3.2/3.5): each billed detection labeled its instances
    // via ONE batched vision call; the cache hit above must NOT re-fire it.
    await expect
      .poll(() => labeling.requestCount(), { timeout: 15_000 })
      .toBe(3);

    // ---- 3. Toggle two detected instances (clicks are free) ------------
    const selectButton = page.getByRole("button", { name: "Select Regions" });
    await expect(selectButton).toBeEnabled();
    await selectButton.click();

    const canvas = page
      .getByRole("application")
      .locator(
        'canvas[aria-label^="Room mask canvas with the Select Regions tool active"]'
      );
    await expect(canvas).toBeVisible();
    // locator.click (not raw page.mouse): Playwright scrolls the TARGET
    // POINT into view and verifies it receives the event — in the #252
    // fixed layout the canvas can extend below the fold, where raw mouse
    // coordinates silently miss (they cannot leave the viewport).
    const clickAt = async (fx: number, fy: number): Promise<void> => {
      const box = (await canvas.boundingBox())!;
      await canvas.click({
        position: { x: box.width * fx, y: box.height * fy },
      });
    };

    const batchPanel = page.locator('section[aria-label="Batch region staging"]');

    // Instance 0 is the full-width band at rows 30–34 — a canvas-center
    // click lands inside it. The retry wrapper absorbs the decode race
    // between the detection response and the client-side instance grids;
    // the passing attempt ends with the instance selected.
    await expect(async () => {
      await clickAt(0.5, 0.5);
      await expect(batchPanel.getByText("1 / 5 regions")).toBeVisible();
    }).toPass({ timeout: 15_000 });

    // Instance 1 is the block at rows 44–60 × cols 4–40 — only a
    // lower-left click hits it (disjoint regions, best-ranked instance
    // containing the point wins).
    await expect(async () => {
      await clickAt(0.2, 0.8);
      await expect(batchPanel.getByText("2 / 5 regions")).toBeVisible();
    }).toPass({ timeout: 15_000 });

    // Toggles are pure client-side hit-tests — zero extra detection calls.
    expect(detection.requestCount()).toBe(3);

    // ---- 3b. Bulk affordances (#249): disabled-when-complete, clear, ---
    //      select-all rebuilds with zero billed calls
    const selectAllButton = page.getByRole("button", { name: "Select all detected" });
    const clearSelectionButton = page.getByRole("button", { name: "Clear selection" });

    // Both detected instances are already selected (step 3), so select-all
    // is disabled — there is nothing left to add — and reports no calls.
    await expect(selectAllButton).toBeDisabled();
    await expect(clearSelectionButton).toBeEnabled();
    expect(detection.requestCount()).toBe(3);

    // Clear empties BOTH state pieces: the panel unmounts, the canvas
    // shows the instances as detected-only again, and select-all re-arms.
    await clearSelectionButton.click();
    await expect(batchPanel).toBeHidden();
    await expect(selectAllButton).toBeEnabled();

    // Select-all rebuilds the whole set from the cached detection — zero
    // billed calls — and disables itself again once everything is selected.
    await selectAllButton.click();
    await expect(batchPanel.getByText("2 / 5 regions")).toBeVisible();
    expect(detection.requestCount()).toBe(3);
    await expect(selectAllButton).toBeDisabled();

    // ---- 4. Vision labels (#252) + pre-filled prompts ------------------
    //      Rows carry the mocked VISION labels ("E2E sofa N" — label source
    //      of truth is the vision label, D4); the thematic field stays empty.
    await expect(
      batchPanel.locator("li").filter({ hasText: /^E2E sofa \d$/ })
    ).toHaveCount(2);
    const thematicPrompt = batchPanel.getByLabel(
      "Theme (applied to all selected regions at once)"
    );
    await expect(thematicPrompt).toHaveValue("");

    await batchPanel
      .getByRole("radio", { name: "A separate prompt per region" })
      .check();

    const perObjectRows = batchPanel.locator('input[id^="batch-prompt-sofa:"]');
    await expect(perObjectRows).toHaveCount(2);
    // Pre-fill uses the best known label (AC-3.4): the vision label.
    await expect(perObjectRows.nth(0)).toHaveValue("Replace the E2E sofa 1 with ");
    await expect(perObjectRows.nth(1)).toHaveValue("Replace the E2E sofa 2 with ");

    // The seed is editable text — finish both sentences.
    await perObjectRows.nth(0).fill("Replace the sofa with a boucle loveseat.");
    await perObjectRows.nth(1).fill("Replace the sofa with a walnut side table.");

    // ---- 5. Batch dispatch: sequential per-object inpaint runs ---------
    await batchPanel.getByRole("button", { name: "Run batch" }).click();
    await expect(
      page.getByText("Batch complete — 2 regions staged.")
    ).toBeVisible({ timeout: 30_000 });

    // Exactly one billed run per object, in panel order, each through the
    // REAL request builder.
    expect(inpaint.requestCount()).toBe(2);
    const bodies = inpaint.submitBodies();
    expect(bodies[0].promptDirectives).toBe("Replace the sofa with a boucle loveseat.");
    expect(bodies[1].promptDirectives).toBe("Replace the sofa with a walnut side table.");
    // The first object edits the original photo; the second CHAINS from the
    // first object's staged result — per-object results stack into the
    // same variant, so step 2's source is step 1's output.
    expect(bodies[0].imageUrl).toContain(`/rooms/${E2E_CONCEPT_ROOM_ID}/before-image.png`);
    expect(bodies[1].imageUrl).toContain("e2e-fixture.supabase.co");
    for (const body of bodies) {
      expect(body.roomId).toBe(E2E_CONCEPT_ROOM_ID);
      expect(body.variantSlot).toBe(0);
    }

    // Each object carries its OWN white-on-black mask (not the union):
    // the band is ~7.8% of the photo, the block ~10.2%, so a union leak
    // (~18%) or a swapped mask breaks the bounds.
    const firstShare = await whitePixelShare(page, String(bodies[0].maskUrl));
    const secondShare = await whitePixelShare(page, String(bodies[1].maskUrl));
    expect(firstShare).toBeGreaterThan(0.01);
    expect(firstShare).toBeLessThan(0.15);
    expect(secondShare).toBeGreaterThan(0.01);
    expect(secondShare).toBeLessThan(0.15);
    expect(bodies[0].maskUrl).not.toBe(bodies[1].maskUrl);

    // ---- 6. The variant is written through the app's REAL room PATCH ---
    await expect(page.getByRole("heading", { name: "Staged result" })).toBeVisible({
      timeout: 20_000,
    });
    // Two stacked toasts: the per-object batch completes once PER object.
    await expect(
      page.getByText("Staged image saved as Variant A.").first()
    ).toBeVisible();

    // Completion resets the selection set (the panel unmounts).
    await expect(batchPanel).toBeHidden();

    // ---- 7. Training-corpus events (W3 contract shape) ------------------
    expect(selectionEvents.length).toBeGreaterThanOrEqual(2);
    const byInstance = (index: number) =>
      selectionEvents.filter((event) => event.instanceIndex === index);
    expect(byInstance(0)[0]).toMatchObject({
      event: "selection_logged",
      roomId: E2E_CONCEPT_ROOM_ID,
      concept: "sofa",
      instanceIndex: 0,
      score: null, // the mocked response carries no provider scores
    });
    expect(byInstance(1)[0]).toMatchObject({
      event: "selection_logged",
      roomId: E2E_CONCEPT_ROOM_ID,
      concept: "sofa",
      instanceIndex: 1,
    });

    // ---- 8. Cache-served chip return: furniture is already warm ---------
    await page.getByRole("button", { name: "furniture" }).click();
    // The SegmentCache serves the repeat concept without a fetch — the
    // effect would have fired synchronously on an uncached switch. (The
    // three billed calls so far: auto-fire furniture, sofa, normalized rug.)
    expect(detection.requestCount()).toBe(3);
  });
});
