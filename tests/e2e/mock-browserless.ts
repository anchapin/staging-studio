import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { MOCK_BROWSERLESS_HOST, MOCK_BROWSERLESS_PORT } from "./env";

/**
 * Local mock of the Browserless.io PDF endpoint (issue #1084).
 *
 * Why this exists: `src/app/api/export-pdf` fetches Browserless from the
 * Next.js server process, so a Playwright `page.route` glob aimed at
 * `chrome.browserless.io/pdf` can never intercept it — browser-context
 * interception only sees traffic the BROWSER makes, and the browser
 * never requests that URL. Specs that want the real route handler
 * therefore need the outbound call to resolve somewhere local, which is
 * what this server is for. It is reached only because
 * `resolveBrowserlessPdfUrl` honors the hermetic-gated override.
 *
 * Why the other export specs don't need it: `helpers.interceptExportPdf`
 * mocks the app's OWN `/api/export-pdf` route, so the real handler never
 * runs there. This server exists for the specs that deliberately
 * exercise the real handler.
 *
 * Surfaces:
 *   POST /pdf            → 200 + a minimal valid PDF, or 503 when the
 *                          outcome is "outage" (provider-unavailable drill)
 *   POST /__e2e/outcome  → { outcome: "success" | "outage" }
 *   GET  /__e2e/requests → every PDF request received
 *
 * Control + inspection go over HTTP (not a direct method) because specs
 * run in a worker process, separate from this server's runner process —
 * the same reason `mockStorageEntries` exists in helpers.ts.
 */

export type BrowserlessOutcome = "success" | "outage";

export interface CapturedBrowserlessRequest {
  method: string;
  url: string;
  /** Raw `Authorization` header, so specs can pin the Basic key shape. */
  authorization: string;
  contentType: string;
  body: string;
}

/** A syntactically valid, deliberately tiny PDF (the route sniffs `%PDF`). */
export function minimalPdfBytes(): Buffer {
  return Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
      "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
      "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n" +
      "trailer<</Root 1 0 R>>\n%%EOF",
    "utf8"
  );
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export class MockBrowserless {
  private server: Server | null = null;
  private outcome: BrowserlessOutcome = "success";
  private readonly requests: CapturedBrowserlessRequest[] = [];

  /** Starts listening; resolves once the socket accepts connections. */
  start(): Promise<void> {
    this.server = createServer((req, res) => {
      void this.handle(req, res);
    });
    return new Promise((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(MOCK_BROWSERLESS_PORT, MOCK_BROWSERLESS_HOST, () => resolve());
    });
  }

  stop(): Promise<void> {
    if (!this.server) return Promise.resolve();
    return new Promise((resolve) => this.server!.close(() => resolve()));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = (req.url ?? "/").split("?")[0];
    const body = await readBody(req);

    if (path.startsWith("/__e2e/")) {
      if (path === "/__e2e/outcome" && req.method === "POST") {
        const parsed = JSON.parse(body || "{}") as { outcome?: string };
        this.outcome = parsed.outcome === "outage" ? "outage" : "success";
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ outcome: this.outcome }));
        return;
      }
      if (path === "/__e2e/requests") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(this.requests));
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "unknown e2e control route" }));
      return;
    }

    this.requests.push({
      method: req.method ?? "",
      url: req.url ?? "",
      authorization: req.headers.authorization ?? "",
      contentType: req.headers["content-type"] ?? "",
      body,
    });

    // The outage drill mirrors a provider-side 503, which the route maps
    // to a 503 for the caller (it propagates the upstream status rather
    // than normalizing to 500 — see the route's non-ok branch).
    if (this.outcome === "outage") {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "Browserless unavailable" }));
      return;
    }

    const pdf = minimalPdfBytes();
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.length),
    });
    res.end(pdf);
  }
}
