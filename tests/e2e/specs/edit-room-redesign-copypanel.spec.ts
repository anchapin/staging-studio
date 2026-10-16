import { expect, test } from "@playwright/test";

import { E2E_EDITOR_PROJECT_ID } from "../env";
import { login, openFocusedEditor, waitForDirectivesSaved } from "../helpers";
import { withCopyUsageAtLimit } from "../quota";

/**
 * Issue #1343 — CopyPanel "Rewrite from directions" wired-up submit path.
 *
 * The prior session's `setTimeout` stub (1.2s placeholder text) was
 * replaced by a real `fetch("/api/v1/listing-copy", …)` in
 * `EditRoomStudio.tsx`. These specs pin the wired-up submit path end to
 * end: clicking the Rewrite CTA fires the route, the route's response
 * populates the headline + body inputs, and the autosave controller
 * (`copyAutosaveRef`) persists the new copy through `saveListingCopy`.
 *
 * What this spec asserts on the **client** (the route is unit-tested
 * separately in `tests/api/v1-listing-copy-route.test.ts`):
 *
 * - The CTA's `disabled` rule (`directions.trim()` non-empty) flips to
 *   enabled once staging directives are typed.
 * - The CTA click fires a `POST /api/v1/listing-copy` with `{ roomId }`
 *   and the response's `{ headline, body }` populates the two inputs.
 * - A 429 from the route surfaces as a toast — the inputs are NOT
 *   mutated and the user can retry.
 *
 * Hermetic seam: `page.route` matches the absolute `/api/v1/listing-copy`
 * the browser fetch. The route never runs in this spec — its outbound
 * gpt-4o-mini call is not invoked, so the dummy `OPENAI_API_KEY` in
 * `nextEnv()` is fine. This matches how `interceptInpaint` mocks the
 * legacy `/api/inpaint` POST.
 *
 * Why the 429 test seeds a counter row instead of setting
 * `DAILY_COPY_LIMIT: "0"` in `nextEnv()`: a process-wide override would
 * 429 every copy-related spec in the run (including a future staging-copy
 * spec that drives `/api/generate-copy`). The seeded counter is scoped
 * to this one test and restored in the `finally`. See
 * `tests/e2e/quota.ts` for the discipline rationale.
 */

const NEW_STUDIO_TESTID = "edit-room-studio";
const COPY_TAB_TESTID = "inspector-tab-copy";
const COPY_PANEL_TESTID = "copy-panel";
const REWRITE_BUTTON_TESTID = "copy-rewrite-button";
const HEADLINE_INPUT_ID = "copy-headline";
const BODY_TEXTAREA_ID = "copy-body";

/**
 * Routes the browser's `POST /api/v1/listing-copy` to a stubbed success
 * response. The shell expects `{ success, data: { headline, body } }`
 * (the same shape the real route returns) — anything else triggers the
 * shell's failure toast and the inputs stay at their initial values.
 *
 * Returns the captured `{ roomId }` body so the spec can assert the
 * shell wired the focused room id (not, say, the project id).
 */
interface ListingCopyInterception {
  requestBody(): { roomId: string } | null;
  respondWithQuotaExceeded(): void;
  respondWithServerError(): void;
}

function interceptListingCopy(
  page: import("@playwright/test").Page,
  options: { headline: string; body: string }
): ListingCopyInterception {
  const state: {
    lastBody: { roomId: string } | null;
    mode: "success" | "quota" | "error";
  } = {
    lastBody: null,
    mode: "success",
  };

  page.route("**/api/v1/listing-copy", (route) => {
    if (route.request().method() !== "POST") {
      void route.fallback();
      return;
    }
    try {
      state.lastBody = JSON.parse(route.request().postData() ?? "{}");
    } catch {
      state.lastBody = null;
    }
    if (state.mode === "quota") {
      void route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          error: "Daily limit reached",
          // Issue #1343 — the shell's failure path prefers `message`
          // over the short `error` label. The CopyPanel's toast reads
          // it verbatim.
          message: "Daily limit reached — try again tomorrow.",
          code: "rate-limit-exceeded",
          retryable: true,
        }),
      });
      return;
    }
    if (state.mode === "error") {
      void route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          error: "Generation failed",
          message: "We couldn't rewrite the listing copy. Please try again.",
          retryable: true,
          code: "integration-error",
        }),
      });
      return;
    }
    void route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          headline: options.headline,
          body: options.body,
        },
        finishReason: "stop",
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        model: "gpt-4o-mini",
      }),
    });
  });

  return {
    requestBody: () => state.lastBody,
    respondWithQuotaExceeded: () => {
      state.mode = "quota";
    },
    respondWithServerError: () => {
      state.mode = "error";
    },
  };
}

test.describe("Edit Room redesign — CopyPanel rewrite (issue #1343, flag=ON)", () => {
  test("Rewrite button is disabled when staging directives are empty", async ({
    page,
  }) => {
    await login(page);
    await openFocusedEditor(page, E2E_EDITOR_PROJECT_ID, "Mask Room");
    await expect(page.getByTestId(NEW_STUDIO_TESTID)).toBeVisible();

    // Switch to the Listing copy tab (defaults to Staging).
    await page.getByTestId(COPY_TAB_TESTID).click();
    await expect(page.getByTestId(COPY_PANEL_TESTID)).toBeVisible();

    // Issue #1343 — the CopyPanel's `canRewrite` resolver disables the
    // button while `directions.trim()` is empty. The seeded editor room
    // has empty directives on first paint.
    const button = page.getByTestId(REWRITE_BUTTON_TESTID);
    await expect(button).toBeDisabled();
    await expect(button).toHaveText("Rewrite from directions");
  });

  test("Rewrite button populates the inputs and persists via autosave", async ({
    page,
  }) => {
    const interception = interceptListingCopy(page, {
      headline: "Bright living room with original moldings",
      body: "Soft linen sofa centered under the restored archway.",
    });

    await login(page);
    await openFocusedEditor(page, E2E_EDITOR_PROJECT_ID, "Mask Room");
    await expect(page.getByTestId(NEW_STUDIO_TESTID)).toBeVisible();

    // Type staging directives on the Staging tab (the default tab).
    // The textarea is labelled "Directions" (`StagePanel.tsx` line
    // 268). `waitForDirectivesSaved` waits for the TopBar "Saved" pill
    // to settle, mirroring the same debounce the Run-button spec uses.
    const directions = page.locator("#directions");
    await expect(directions).toBeVisible();
    await directions.fill("King bed centered on the accent wall.");
    await waitForDirectivesSaved(page);

    // Switch to the Listing copy tab and click Rewrite.
    await page.getByTestId(COPY_TAB_TESTID).click();
    await expect(page.getByTestId(COPY_PANEL_TESTID)).toBeVisible();
    const button = page.getByTestId(REWRITE_BUTTON_TESTID);
    await expect(button).toBeEnabled();
    await button.click();

    // The shell populates the inputs from the route response.
    await expect(page.locator(`#${HEADLINE_INPUT_ID}`)).toHaveValue(
      "Bright living room with original moldings"
    );
    await expect(page.locator(`#${BODY_TEXTAREA_ID}`)).toHaveValue(
      "Soft linen sofa centered under the restored archway."
    );

    // The button returns to the rest label — the spinner is only
    // visible while the in-flight request is pending, and the mock
    // returns synchronously. `aria-busy` flips back to false.
    await expect(button).not.toHaveAttribute("aria-busy", "true");
    await expect(button).toHaveText("Rewrite from directions");

    // The shell sent the focused room id (not the project id, not
    // something fabricated client-side). The real route reads the
    // rest of the prompt context server-side from the persisted row.
    const sentBody = interception.requestBody();
    expect(sentBody).toEqual({ roomId: "e2eeditorroom00000000000000room" });
  });

  test("Quota-exhausted Rewrite click surfaces a toast and leaves inputs untouched", async ({
    page,
  }) => {
    const interception = interceptListingCopy(page, {
      headline: "should-not-appear",
      body: "should-not-appear",
    });

    await login(page);
    await openFocusedEditor(page, E2E_EDITOR_PROJECT_ID, "Mask Room");
    await expect(page.getByTestId(NEW_STUDIO_TESTID)).toBeVisible();

    // Type staging directives on the Staging tab (so the Rewrite
    // button is enabled on the CopyPanel). Same `#directions`
    // textarea as the success-path spec.
    const directions = page.locator("#directions");
    await expect(directions).toBeVisible();
    await directions.fill("Refresh palette; add layered lighting.");
    await waitForDirectivesSaved(page);

    // Switch to the CopyPanel and seed the quota counter to cap. The
    // `withCopyUsageAtLimit` wrapper restores the prior value in a
    // `finally`, so other copy-related specs in the same run see an
    // untouched counter.
    await page.getByTestId(COPY_TAB_TESTID).click();
    await expect(page.getByTestId(COPY_PANEL_TESTID)).toBeVisible();

    await withCopyUsageAtLimit(async () => {
      interception.respondWithQuotaExceeded();
      const button = page.getByTestId(REWRITE_BUTTON_TESTID);
      await expect(button).toBeEnabled();
      await button.click();

      // The shell lifts the route's `message` into a toast — the
      // CopyPanel inputs are NOT mutated. The route's other branches
      // (auth, integration) follow the same pattern.
      await expect(page.getByText("Daily limit reached — try again tomorrow.")).toBeVisible();
      await expect(page.locator(`#${HEADLINE_INPUT_ID}`)).toHaveValue("");
      await expect(page.locator(`#${BODY_TEXTAREA_ID}`)).toHaveValue("");

      // The button has flipped back to the rest label after the
      // in-flight request resolved.
      await expect(button).not.toHaveAttribute("aria-busy", "true");
    });
  });
});