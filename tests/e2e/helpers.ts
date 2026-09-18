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
  /** Every POST /api/inpaint body, in submission order (issue #231). */
  submitPayloads: Array<Record<string, unknown>>;
  maskDataUrl: string;
  mode: "completed" | "terminal";
}

export interface InpaintInterception {
  /** Captured JSON body of the browser's most recent POST /api/inpaint. */
  submitBody(): Record<string, unknown>;
  /** Every captured POST /api/inpaint body, in submission order. */
  submitBodies(): Array<Record<string, unknown>>;
  /** How many POST /api/inpaint requests the browser has issued so far. */
  requestCount(): number;
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
  const state: InpaintCaptureState = { submitPayloads: [], maskDataUrl: "", mode: "completed" };

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
    const submitPayload = JSON.parse(route.request().postData() ?? "{}") as Record<
      string,
      unknown
    >;
    state.submitPayloads.push(submitPayload);
    state.maskDataUrl = typeof submitPayload.maskUrl === "string" ? submitPayload.maskUrl : "";
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
      const last = state.submitPayloads[state.submitPayloads.length - 1];
      if (!last) throw new Error("POST /api/inpaint was never captured");
      return last;
    },
    submitBodies() {
      return [...state.submitPayloads];
    },
    requestCount() {
      return state.submitPayloads.length;
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

interface FurnishingsDetectionCaptureState {
  submitPayload: Record<string, unknown> | null;
  requestCount: number;
  mode: "success" | "empty" | "failure";
  /**
   * Success-mode alpha cutouts (the multi-instance mock backing the
   * concept-flow spec, issue #231). null → the default single-band
   * fixture the preset specs assert geometry against.
   */
  successMasks: string[] | null;
}

export interface FurnishingsDetectionInterception {
  /** Captured JSON body of the browser's POST /api/segment/furnishings. */
  submitBody(): Record<string, unknown>;
  /** How many detection requests the browser has issued so far. */
  requestCount(): number;
  /** Switches responses to an empty detection (no objects found). */
  respondWithEmpty(): void;
  /** Switches responses back to the success fixture (default). */
  respondWithSuccess(): void;
  /**
   * Switches success responses to the given per-instance alpha cutouts
   * (issue #231) — the multi-instance mock the concept-flow spec toggles
   * against. Pass the same URLs repeatedly to vary instance count.
   */
  respondWithMaskDataUrls(maskDataUrls: string[]): void;
  /** Switches responses to a simulated detection failure. */
  respondWithFailure(): void;
}

// 96x64 RGBA PNG matching the verified fal-ai/sam-3-1 mask format
// (issue #223): transparent background with an opaque photo-colored band
// across rows 30–34 — at the e2e before photo's exact natural dimensions
// (no resampling) so the preset's cutout→white conversion, union, and
// 15px dilation are deterministic: the band dilates to rows 15–49,
// leaving the ceiling strip (rows 0–14) and floor strip (rows 50–63)
// outside the regeneration mask.
const FURNISHINGS_CUTOUT_FIXTURE_DATA_URL = `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABACAYAAADlNHIOAAAARUlEQVR42u3RAQkAMAhEUfunWAhD2MqVEITtPbgC9yMAAAAAAAAAAAAAAJ5Qedr2JoAAAjhCgI8DAAAAAAAAAAAAAAAzLnWJ0uyi1qBkAAAAAElFTkSuQmCC`;

/**
 * Intercepts the SAM 3.1 furnishings-detection route (issue #223) at the
 * browser network layer so fal.ai and the real route handler are never
 * contacted. Success mode returns per-instance alpha-cutout mask fixtures
 * (the format the live endpoint serves — see furnishing-detection.ts) and
 * echoes the requested concept, like the real route. Since issue #231 the
 * concept tool is compiled ON in the e2e build, so EVERY editor-opening
 * spec must register this interception (the editor auto-fires the
 * catch-all detection on open); the spec observes the run through the
 * /api/inpaint interception.
 */
export function interceptFurnishingsDetection(
  page: Page
): FurnishingsDetectionInterception {
  const state: FurnishingsDetectionCaptureState = {
    submitPayload: null,
    requestCount: 0,
    mode: "success",
    successMasks: null,
  };

  page.route("**/api/segment/furnishings", (route) => {
    if (route.request().method() !== "POST") {
      void route.fallback();
      return;
    }
    state.requestCount += 1;
    state.submitPayload = JSON.parse(route.request().postData() ?? "{}") as Record<
      string,
      unknown
    >;
    if (state.mode === "failure") {
      void route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Furnishings detection failed",
          message: "Simulated SAM 3.1 failure (e2e).",
        }),
      });
      return;
    }
    if (state.mode === "empty") {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ maskDataUrls: [] }),
      });
      return;
    }
    void route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        concept:
          typeof state.submitPayload?.concept === "string"
            ? state.submitPayload.concept
            : "furniture",
        maskDataUrls: state.successMasks ?? [FURNISHINGS_CUTOUT_FIXTURE_DATA_URL],
      }),
    });
  });

  return {
    submitBody() {
      if (!state.submitPayload) {
        throw new Error("POST /api/segment/furnishings was never captured");
      }
      return state.submitPayload;
    },
    requestCount() {
      return state.requestCount;
    },
    respondWithEmpty() {
      state.mode = "empty";
    },
    respondWithSuccess() {
      state.mode = "success";
      state.successMasks = null;
    },
    respondWithMaskDataUrls(maskDataUrls: string[]) {
      state.mode = "success";
      state.successMasks = [...maskDataUrls];
    },
    respondWithFailure() {
      state.mode = "failure";
    },
  };
}

/**
 * Intercepts the OpenAI-backed copy route; the browser call never reaches
 * the real route handler, so no OPENAI_API_KEY is exercised.
 */
export function interceptGenerateCopy(page: Page): void {  page.route("**/api/generate-copy", (route) => {
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

export interface WhitePixelGeometry {
  /** White pixels / total pixels, 0..1. */
  share: number;
  /** White-pixel centroid normalized to the mask (0..1 per axis). */
  centroid: { x: number; y: number };
  /** Normalized white-pixel bounding box (0..1 per axis). */
  bbox: { minX: number; maxX: number; minY: number; maxY: number };
}

/**
 * Decodes a PNG data URL INSIDE the browser and locates its white pixels
 * geometrically — normalized share, centroid, and bounding box. Issue #181
 * uses this to prove a stroke painted at a known viewport point exports to
 * the matching photo region (mask lands under the cursor) at 2x DPR.
 */
export async function whitePixelGeometry(page: Page, dataUrl: string): Promise<WhitePixelGeometry> {
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
    let sumX = 0;
    let sumY = 0;
    let minX = canvas.width;
    let maxX = -1;
    let minY = canvas.height;
    let maxY = -1;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const i = (y * canvas.width + x) * 4;
        if (data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200) {
          white++;
          sumX += x;
          sumY += y;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (white === 0) throw new Error("mask contains no white pixels");
    return {
      share: white / (canvas.width * canvas.height),
      centroid: { x: sumX / white / canvas.width, y: sumY / white / canvas.height },
      bbox: {
        minX: minX / canvas.width,
        maxX: maxX / canvas.width,
        minY: minY / canvas.height,
        maxY: maxY / canvas.height,
      },
    };
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
