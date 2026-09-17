import { createHash } from "node:crypto";
import { expect, type Page, type Request, type Route } from "@playwright/test";

import {
  APP_URL,
  E2E_EMAIL,
  E2E_PASSWORD,
  E2E_UPLOAD_PROJECT_ID,
  MOCK_SUPABASE_URL,
  STAGED_RESULT_HOST,
  STAGED_RESULT_PUBLIC_URL,
} from "./env";
import { stagedResultFixture } from "./fixtures";

/**
 * Shared e2e helpers (issue #165).
 *
 * Everything a spec needs to drive the app through its real UI: UI login
 * against the mock GoTrue, focused-editor navigation, mask-paint mouse
 * choreography (the interaction class the PoC's dispatched-event driver
 * could not perform), and Playwright route mocks for every third-party-
 * backed API route so no paid service is ever contacted.
 */

/** Signs in through the real /login form; the mock accepts any credentials. */
export async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(E2E_EMAIL);
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign In" }).click();
  // /dashboard server-redirects authed users straight to /projects
  // (src/app/dashboard/page.tsx), so the settled URL is /projects.
  await page.waitForURL(`${APP_URL}/projects`);
}

/**
 * Opens the focused single-room editor (issue #169 flow) for a seeded
 * room. Each grid card is a `.space-y-3` wrapper holding the room heading
 * and its "Edit staging" button.
 */
export async function openFocusedEditor(
  page: Page,
  projectId: string,
  roomName: string
): Promise<void> {
  await page.goto(`/projects/${projectId}`);
  await expect(page.getByRole("heading", { name: roomName })).toBeVisible();
  await page
    .locator(".space-y-3", { hasText: roomName })
    .getByRole("button", { name: "Edit staging" })
    .click();
  await expect(page.getByRole("button", { name: "All rooms" })).toBeVisible();
}

/**
 * Paints a multi-stroke zig-zag across the middle of the mask canvas with
 * REAL trusted mouse events (CDP input pipeline) — the exact interaction
 * class that silently failed under the PoC's dispatched-event driver
 * (strokes never landed; exported masks were 100% black). Strokes cover a
 * deliberate band so the coverage assertion has margin.
 */
export async function paintMaskZigzag(page: Page): Promise<void> {
  const canvas = maskCanvas(page);
  await expect(canvas).toBeVisible();
  // Raw page.mouse does NOT auto-scroll like locator clicks do; the mask
  // canvas sits below the fold in the focused editor, so bring it into
  // view before reading its viewport-relative box.
  await canvas.scrollIntoViewIfNeeded();

  const box = await canvas.boundingBox();
  if (!box) throw new Error("mask canvas not laid out");

  const xLeft = box.x + box.width * 0.15;
  const xRight = box.x + box.width * 0.85;
  const rows = [0.3, 0.45, 0.6, 0.75];

  await page.mouse.move(xLeft, box.y + box.height * rows[0]);
  await page.mouse.down();
  for (let i = 0; i < rows.length; i += 1) {
    const x = i % 2 === 0 ? xRight : xLeft;
    await page.mouse.move(x, box.y + box.height * rows[i], { steps: 12 });
  }
  await page.mouse.up();
}

function maskCanvas(page: Page): ReturnType<Page["locator"]> {
  return page
    .getByRole("application")
    .locator('canvas[aria-label^="Room mask painting canvas"]');
}

interface InpaintCaptureState {
  submitPayload: Record<string, unknown> | null;
  maskDataUrl: string;
  mode: "completed" | "terminal";
}

export interface InpaintInterception {
  /** Captured JSON body of the browser's POST /api/inpaint. */
  submitBody(): Record<string, unknown>;
  /** Captured mask data URL, exactly as the browser put it on the wire. */
  maskDataUrl(): string;
  /** Switch status polling to return a completed staged image. */
  respondWithCompleted(): void;
  /** Switch status polling to return a terminal (non-retryable) failure. */
  respondWithTerminalFailure(): void;
}

/**
 * Intercepts the inpaint pair at the browser network layer so neither
 * fal.ai nor this app's fal-backed route is ever contacted:
 *   POST /api/inpaint            → 200 { requestId }
 *   GET  /api/inpaint/:id/status → COMPLETED + mock staged image URL, or
 *                                  a terminal failure for the drill.
 */
export function interceptInpaint(page: Page): InpaintInterception {
  const state: InpaintCaptureState = { submitPayload: null, maskDataUrl: "", mode: "completed" };

  const fulfillStatus = (route: Route): void => {
    if (state.mode === "terminal") {
      void route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Request not found",
          message: "Simulated: inpaint request expired before completion.",
          retryable: false,
        }),
      });
      return;
    }
    void route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "completed",
        imageUrl: STAGED_RESULT_PUBLIC_URL,
      }),
    });
  };

  page.route("**/api/inpaint", (route) => {
    if (route.request().method() !== "POST") {
      void route.fallback();
      return;
    }
    state.submitPayload = JSON.parse(route.request().postData() ?? "{}") as Record<
      string,
      unknown
    >;
    state.maskDataUrl = typeof state.submitPayload.maskUrl === "string"
      ? state.submitPayload.maskUrl
      : "";
    void route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ requestId: "e2e-fake-request-id" }),
    });
  });

  page.route("**/api/inpaint/*/status", (route) => fulfillStatus(route));

  // The staged result URL is a schema-valid but nonexistent fixture host,
  // so the optimizer route is intercepted in the browser and fulfilled
  // with real fixture bytes; every other optimized image (the loopback
  // before photo, served by the mock storage) falls through to Next.
  page.route("**/_next/image*", (route) => {
    const src = new URL(route.request().url()).searchParams.get("url") ?? "";
    if (src.includes(STAGED_RESULT_HOST)) {
      void route.fulfill({
        status: 200,
        contentType: "image/png",
        body: stagedResultFixture(),
      });
      return;
    }
    void route.fallback();
  });

  return {
    submitBody() {
      if (!state.submitPayload) throw new Error("POST /api/inpaint was never captured");
      return state.submitPayload;
    },
    maskDataUrl() {
      if (!state.maskDataUrl) throw new Error("no mask data URL captured from POST /api/inpaint");
      return state.maskDataUrl;
    },
    respondWithCompleted() {
      state.mode = "completed";
    },
    respondWithTerminalFailure() {
      state.mode = "terminal";
    },
  };
}

/**
 * Intercepts the OpenAI-backed copy route; the browser call never reaches
 * the real route handler, so no OPENAI_API_KEY is exercised.
 */
export function interceptGenerateCopy(page: Page): void {
  page.route("**/api/generate-copy", (route) => {
    if (route.request().method() !== "POST") {
      void route.fallback();
      return;
    }
    void route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          observedChallenge: "E2E: the room reads as sparse and lacks a focal point.",
          recommendation: "E2E: anchor the seating area with a neutral sofa and layered lighting.",
          buyerPsychology: "E2E: buyers picture slow mornings in a calm, finished space.",
          checklist: [
            {
              item: "Pack away personal photos",
              category: "DIY/Declutter",
              priority: "Critical",
            },
            {
              item: "Rent a neutral linen sofa",
              category: "Rental Inventory",
              priority: "High",
            },
            {
              item: "Touch up baseboard paint",
              category: "Minor Repair",
              priority: "Standard",
            },
          ],
        },
      }),
    });
  });
}

/**
 * Intercepts the Browserless-backed export route. `outcome` chooses
 * between a successful PDF download (rehearsal) and a simulated provider
 * outage (failure drill).
 */
export function interceptExportPdf(page: Page, outcome: "success" | "outage"): void {
  page.route("**/api/export-pdf", (route) => {
    if (route.request().method() !== "POST") {
      void route.fallback();
      return;
    }
    if (outcome === "outage") {
      void route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "Simulated Browserless outage (e2e drill)." }),
      });
      return;
    }
    void route.fulfill({
      status: 200,
      contentType: "application/pdf",
      body: minimalPdfBytes(),
    });
  });
}

function minimalPdfBytes(): Buffer {
  return Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
      "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
      "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n" +
      "trailer<</Root 1 0 R>>\n%%EOF",
    "utf8"
  );
}

/**
 * Decodes a PNG data URL INSIDE the browser and measures the share of
 * white pixels — sampling the actual mask payload the app put on the wire
 * (issue #165's acceptance criterion: white coverage above a threshold,
 * not a 100% black export).
 */
export async function whitePixelShare(page: Page, dataUrl: string): Promise<number> {
  return page.evaluate(async (src) => {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("mask data URL failed to decode"));
      image.src = src;
    });
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(image, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let white = 0;
    const total = canvas.width * canvas.height;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200) white++;
    }
    return white / total;
  }, dataUrl);
}

export interface MockStorageEntry {
  bucket: string;
  path: string;
  size: number;
  sha256: string;
  contentType: string;
}

/** Fetches the mock storage inventory (Node side, no browser involved). */
export async function mockStorageEntries(): Promise<MockStorageEntry[]> {
  const response = await fetch(`${MOCK_SUPABASE_URL}/__e2e/storage`);
  if (!response.ok) throw new Error(`mock storage inspection failed: HTTP ${response.status}`);
  return (await response.json()) as MockStorageEntry[];
}

/**
 * Uploads a room photo through the real UI (`setInputFiles` → real
 * bytes) and resolves with the sha256 of the browser's PUT body. The PUT
 * listener is registered before the click so nothing can race it.
 */
export async function uploadRoomPhotoViaUi(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer }
): Promise<{ putSha256: string; putSize: number }> {
  const capture: { body: Buffer | null } = { body: null };
  const onPut = (request: Request): void => {
    if (
      request.method() === "PUT" &&
      request.url().startsWith(`${MOCK_SUPABASE_URL}/storage/v1/object/upload/sign/`) &&
      !capture.body
    ) {
      capture.body = request.postDataBuffer();
    }
  };
  page.on("request", onPut);

  try {
    await page
      .getByRole("button", { name: "Upload room photo" })
      .or(page.getByRole("button", { name: "Replace room photo" }))
      .click();
    await page.locator('input[type="file"]').setInputFiles({
      name: file.name,
      mimeType: file.mimeType,
      buffer: file.buffer,
    });
    await expect(
      page.locator('div[role="status"][aria-live="polite"]').filter({
        hasText: "Room photo upload complete.",
      })
    ).toHaveText("Room photo upload complete.", { timeout: 30_000 });
  } finally {
    page.off("request", onPut);
  }

  if (!capture.body) throw new Error("browser never PUT the file to the signed upload URL");
  return {
    putSha256: createHash("sha256").update(capture.body).digest("hex"),
    putSize: capture.body.length,
  };
}

/** Convenience: URL path of the seeded upload-flow project page. */
export function uploadProjectUrl(): string {
  return `/projects/${E2E_UPLOAD_PROJECT_ID}`;
}
