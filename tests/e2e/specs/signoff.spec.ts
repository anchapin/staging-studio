import { expect, test, type Page } from "@playwright/test";

import { E2E_SIGNOFF_PROJECT_ID, nextEnv } from "../env";
import { signPreviewToken } from "../../../src/lib/preview-token";

// Same key wiring as preview.spec.ts: the app under test signs/verifies
// preview tokens with the secret from nextEnv() (see playwright.config.ts's
// webServer). preview-token.ts reads PREVIEW_TOKEN_SECRET at call time, so
// setting it here makes in-spec minting match the app's verification key.
process.env.PREVIEW_TOKEN_SECRET = nextEnv().PREVIEW_TOKEN_SECRET;

const PREVIEW_URL = `/preview/${E2E_SIGNOFF_PROJECT_ID}`;
// Seeded in tests/e2e/global-setup.ts; rendered on the lookbook cover page.
const SEEDED_ADDRESS = "505 Signature Way";

/** Minimal schema-valid PNG (1×1) for direct /api/sign-project POSTs. */
const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** The preview URL for the seeded signoff project with a freshly minted token. */
async function mintedPreviewUrl(): Promise<string> {
  const token = await signPreviewToken(E2E_SIGNOFF_PROJECT_ID);
  return `${PREVIEW_URL}?token=${encodeURIComponent(token)}`;
}

/**
 * The closing signoff section (#lookbook-closing, lookbook-preview-view.tsx
 * canSign gating). Scoping is MANDATORY: the consultation section
 * (#lookbook-consultation) embeds its own SignatureCanvas, so the Draw /
 * Sign & Approve buttons and the approval checkbox exist twice on the
 * page — unscoped role lookups would break Playwright strict mode.
 */
function closingSection(page: Page) {
  return page.locator("#lookbook-closing");
}

/**
 * Client signature & acceptance flow (issue #695).
 *
 * The preview page's closing section renders the interactive
 * SignoffPageClient for token-bearing visitors on unsigned projects
 * (canSign): the client draws a signature (signature-canvas.tsx → PNG
 * data URL), agrees to the approval text, and POSTs the REAL
 * /api/sign-project — the app's only mutation endpoint reachable without
 * a session, guarded solely by the HMAC preview token (issue #684
 * hardening: cuid projectId, PNG data-URL prefix + 1 MB cap, token scope
 * match, and Signed-status immutability).
 *
 * Hermetic: tokens are minted in-spec against the same HMAC secret the
 * app verifies with; the sign route's Prisma write lands in the
 * disposable Dockerized Postgres; no third-party provider is involved,
 * so no route interception is registered — the point is exercising the
 * real route end to end.
 *
 * Order matters within this file (single worker, declaration order): the
 * drawing test signs the seeded project, and the immutability test leans
 * on that Signed status — its first POST tolerates 200 or 409 so it also
 * holds when the file is run filtered/standalone.
 */
test.describe("client signature & acceptance flow (issue #695)", () => {
  test("minted token renders the interactive signoff affordance (canSign)", async ({
    page,
  }) => {
    const response = await page.goto(await mintedPreviewUrl());
    expect(response?.status()).toBe(200);
    await expect(page.getByText(SEEDED_ADDRESS).first()).toBeVisible();

    // Unsigned project + token → the closing section renders the signing
    // form (SignoffPageClient opens straight into it), not the static
    // thank-you page the isSigned branch shows.
    const closing = closingSection(page);
    await expect(
      closing.getByRole("heading", { name: "Approve Your Staging Plan" })
    ).toBeVisible();
    await expect(closing.getByRole("button", { name: "Draw" })).toBeVisible();
    await expect(
      closing.getByRole("button", { name: "Sign & Approve" })
    ).toBeVisible();
    await expect(closing.getByText("Staging Approved")).toHaveCount(0);
  });

  test("drawn signature submits, persists after reload, and renders in the print view", async ({
    page,
  }) => {
    await page.goto(await mintedPreviewUrl());
    const closing = closingSection(page);

    // The canvas opens in "type" mode; switch to freehand drawing. The
    // overlay hint exists only in draw mode, so it doubles as the
    // mode-switch confirmation — and leaves exactly one canvas in the
    // closing section (the type-mode one unmounts).
    await closing.getByRole("button", { name: "Draw" }).click();
    await expect(closing.getByText("Draw your signature above")).toBeVisible();
    const canvas = closing.locator("canvas");
    await expect(canvas).toBeVisible();

    // Real trusted mouse events (CDP input pipeline) — the interaction
    // class signature-canvas.tsx's native mousedown/mousemove/mouseup
    // listeners require (same choreography as the mask-paint spec). The
    // signoff project seeds no room photos, so nothing above the canvas
    // reflows mid-stroke and the viewport box stays valid.
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    if (!box) throw new Error("signature canvas not laid out");

    const yMid = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.2, yMid);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.8, yMid, { steps: 12 });
    await page.mouse.up();

    // Prove the stroke landed on the backing store before exporting: a
    // blank (fully transparent) canvas still produces a schema-valid PNG
    // data URL, so only pixel-level ink proves the drawing worked.
    const inkedPixels = await canvas.evaluate((el) => {
      if (!(el instanceof HTMLCanvasElement)) return 0;
      const ctx = el.getContext("2d");
      if (!ctx) return 0;
      const { data } = ctx.getImageData(0, 0, el.width, el.height);
      let inked = 0;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] !== 0) inked += 1;
      }
      return inked;
    });
    expect(inkedPixels).toBeGreaterThan(0);

    // Approval + submit — the real (unintercepted) /api/sign-project
    // validates the minted token and writes to the Dockerized Postgres.
    await closing.getByRole("checkbox").check();
    await closing.getByRole("button", { name: "Sign & Approve" }).click();

    // Success flips the closing section to the static signed display.
    await expect(
      closing.getByRole("heading", { name: "Staging Approved" })
    ).toBeVisible();
    await expect(closing.getByAltText("Client signature")).toBeVisible();

    // Fresh navigation with a fresh token: the server-rendered isSigned
    // branch must persist the Signed status and render the stored PNG
    // (unoptimized <img>, so the data URL reaches the DOM verbatim).
    const response = await page.goto(await mintedPreviewUrl());
    expect(response?.status()).toBe(200);
    await expect(
      closing.getByRole("heading", { name: "Staging Approved" })
    ).toBeVisible();
    const signatureImage = closing.getByAltText("Client signature");
    await expect(signatureImage).toBeVisible();
    await expect(signatureImage).toHaveAttribute(
      "src",
      /^data:image\/png;base64,/
    );
    // canSign is now false — the interactive form must not render again.
    await expect(
      closing.getByRole("button", { name: "Sign & Approve" })
    ).toHaveCount(0);
  });

  test("tampered token is refused at both the page and the sign API", async ({
    page,
  }) => {
    const token = await signPreviewToken(E2E_SIGNOFF_PROJECT_ID);
    // Keep the payload.signature shape but corrupt the MAC, so the token
    // fails HMAC verification (not mere parsing) exactly like a forged one.
    const tampered = `${token}corrupted`;

    // Page level (preview-access): anonymous + invalid token → 404, no
    // existence leak.
    const response = await page.goto(
      `${PREVIEW_URL}?token=${encodeURIComponent(tampered)}`
    );
    expect(response?.status()).toBe(404);

    // API level: the session-less mutation endpoint must refuse the same
    // forged credential with 401 before touching the database.
    const signResponse = await page.request.post("/api/sign-project", {
      data: {
        projectId: E2E_SIGNOFF_PROJECT_ID,
        signatureDataUrl: TINY_PNG_DATA_URL,
        token: tampered,
      },
    });
    expect(signResponse.status()).toBe(401);
    expect((await signResponse.json()).message).toContain(
      "expired or is invalid"
    );
  });

  test("already-Signed project refuses a second signature (issue #684 immutability)", async ({
    page,
  }) => {
    const token = await signPreviewToken(E2E_SIGNOFF_PROJECT_ID);
    const payload = {
      projectId: E2E_SIGNOFF_PROJECT_ID,
      signatureDataUrl: TINY_PNG_DATA_URL,
      token,
    };

    // In-suite the drawing test above already signed the project (this
    // POST returns 409); a filtered standalone run signs here (200).
    // Either way the SECOND attempt below is what proves immutability.
    const first = await page.request.post("/api/sign-project", {
      data: payload,
    });
    expect([200, 409]).toContain(first.status());

    const second = await page.request.post("/api/sign-project", {
      data: payload,
    });
    expect(second.status()).toBe(409);
    expect((await second.json()).message).toContain("already been signed");

    // The print view agrees: a fresh token renders the static signed
    // page, never a second signing form. (The consultation section's own
    // signature form is client-state only — the closing section is the
    // server-gated surface, hence the scoping.)
    await page.goto(`${PREVIEW_URL}?token=${encodeURIComponent(token)}`);
    const closing = closingSection(page);
    await expect(
      closing.getByRole("heading", { name: "Staging Approved" })
    ).toBeVisible();
    await expect(
      closing.getByRole("button", { name: "Sign & Approve" })
    ).toHaveCount(0);
  });
});
