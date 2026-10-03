#!/usr/bin/env tsx
/**
 * Live integration probe for the Replicate inference adapter (#1200).
 *
 * The adapter's unit tests mock `fetch`, so they prove our URL paths and
 * request bodies, not Replicate's real wire format. This probe makes one
 * real FLUX.1 Fill inpaint through the SAME path production uses:
 *
 *   createReplicateClient().submit -> status (poll) -> result
 *   -> extractInpaintImageUrls (the #1199 normalizer) -> download the image
 *
 * and prints a verdict plus the observed wire facts (status strings seen,
 * output shape, latency, image bytes/content-type).
 *
 * Usage (needs a real token; each run is one billed prediction, roughly
 * $0.05 on black-forest-labs/flux-fill-pro):
 *
 *   REPLICATE_API_TOKEN=r8_... npx tsx scripts/replicate-integration-probe.mts
 *   # also write the verdict JSON to .agents/results/
 *   REPLICATE_API_TOKEN=r8_... npx tsx scripts/replicate-integration-probe.mts --save
 *
 * Optional env:
 *   PROBE_IMAGE_URL / PROBE_MASK_URL  a real photo + mask (https). Default is
 *     a generated 256x256 gray image and a white center-square mask, sent
 *     as PNG data URLs, so the probe has no external dependency.
 *   REPLICATE_FLUX_FILL_MODEL         same override the adapter honors.
 *   PROBE_TIMEOUT_MS                  overall poll cap (default 180000).
 *
 * Idempotent: writes nothing to the app database or storage. Re-running
 * just makes another prediction. Exit code 0 = PASS, 1 = FAIL.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

import { createReplicateClient } from "../src/lib/replicate-adapter";
import { buildReplicateFillPayload } from "../src/lib/prompts";
import { LOGICAL_MODEL } from "../src/lib/inference";
import { extractInpaintImageUrls } from "../src/lib/inpaint-output";

// ─── tiny PNG encoder (8-bit grayscale) ────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function grayPngDataUrl(size: number, pixel: (x: number, y: number) => number): string {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  const raw = Buffer.alloc((size + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) raw[y * (size + 1) + 1 + x] = pixel(x, y);
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

function shapeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `array(len=${value.length}, of ${value.length ? shapeOf(value[0]) : "?"})`;
  }
  if (typeof value === "object") return `object{${Object.keys(value as object).join(",")}}`;
  return typeof value;
}

// ─── probe ─────────────────────────────────────────────────────────────────
async function main(): Promise<number> {
  const save = process.argv.includes("--save");
  if (!process.env.REPLICATE_API_TOKEN?.trim()) {
    console.error("[probe] REPLICATE_API_TOKEN is not set. Nothing was sent.");
    return 1;
  }
  const timeoutMs = Number(process.env.PROBE_TIMEOUT_MS ?? 180_000);
  const SIZE = 256;
  const imageUrl =
    process.env.PROBE_IMAGE_URL?.trim() ||
    grayPngDataUrl(SIZE, (x, y) => (((x >> 5) + (y >> 5)) % 2 ? 160 : 96));
  const maskUrl =
    process.env.PROBE_MASK_URL?.trim() ||
    grayPngDataUrl(SIZE, (x, y) => (x > 64 && x < 192 && y > 64 && y < 192 ? 255 : 0));

  const report: Record<string, unknown> = {
    probe: "replicate-integration",
    issue: 1200,
    startedAt: new Date().toISOString(),
    model: process.env.REPLICATE_FLUX_FILL_MODEL?.trim() || "black-forest-labs/flux-fill-pro",
    inputs: process.env.PROBE_IMAGE_URL ? "env urls" : "generated data urls",
  };
  const fail = (stage: string, error: unknown): number => {
    report.verdict = "FAIL";
    report.failedStage = stage;
    report.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return 1;
  };

  const client = createReplicateClient();
  const payload = buildReplicateFillPayload({
    imageUrl,
    maskUrl,
    prompt: "a mid-century modern armchair in walnut and cream boucle",
    promptStrength: 0.85,
  }) as unknown as Record<string, unknown>;

  const t0 = Date.now();
  try {
    let requestId: string;
    try {
      ({ request_id: requestId } = await client.submit(LOGICAL_MODEL.FLUX_FILL, { input: payload }));
      report.requestId = requestId;
      report.submitMs = Date.now() - t0;
    } catch (e) {
      return fail("submit", e);
    }

    const seen: string[] = [];
    let polls = 0;
    let delay = 1_000;
    for (;;) {
      if (Date.now() - t0 > timeoutMs) {
        report.statusesSeen = seen;
        return fail("status", new Error(`timed out after ${timeoutMs}ms`));
      }
      let st;
      try {
        st = await client.status(LOGICAL_MODEL.FLUX_FILL, requestId);
      } catch (e) {
        report.statusesSeen = seen;
        return fail("status", e);
      }
      polls++;
      const rawStatus = (st.raw as { status?: string } | undefined)?.status;
      const label = rawStatus ? `${rawStatus}->${st.status}` : st.status;
      if (seen[seen.length - 1] !== label) seen.push(label);
      if (st.status === "COMPLETED") break;
      if (st.status === "ERROR") {
        report.statusesSeen = seen;
        report.providerError = (st.raw as { error?: unknown } | undefined)?.error ?? null;
        return fail("status", new Error("provider reported ERROR"));
      }
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 1.5, 5_000);
    }
    report.statusesSeen = seen;
    report.statusPolls = polls;
    report.completedMs = Date.now() - t0;

    let output: unknown;
    try {
      ({ data: output } = await client.result(LOGICAL_MODEL.FLUX_FILL, requestId));
    } catch (e) {
      return fail("result", e);
    }
    report.outputShape = shapeOf(output);
    const urls = extractInpaintImageUrls(output);
    report.imageUrls = urls;
    if (urls.length === 0) {
      report.rawOutput = output;
      return fail("normalize", new Error("no image URL in output (#1199 normalizer)"));
    }

    try {
      const res = await fetch(urls[0]);
      const bytes = Buffer.from(await res.arrayBuffer());
      report.download = {
        httpStatus: res.status,
        contentType: res.headers.get("content-type"),
        bytes: bytes.length,
      };
      if (!res.ok || bytes.length === 0) {
        return fail("download", new Error(`HTTP ${res.status}, ${bytes.length} bytes`));
      }
    } catch (e) {
      return fail("download", e);
    }

    report.totalMs = Date.now() - t0;
    report.verdict = "PASS";
    return 0;
  } finally {
    report.finishedAt = new Date().toISOString();
    const json = JSON.stringify(report, null, 2);
    console.log(json);
    console.log(`\n[probe] ${report.verdict}${report.failedStage ? ` at ${report.failedStage}` : ""}`);
    if (save) {
      mkdirSync(".agents/results", { recursive: true });
      const file = `.agents/results/replicate-probe-${String(report.startedAt).slice(0, 10)}.json`;
      writeFileSync(file, json + "\n");
      console.log(`[probe] saved ${file}`);
    }
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error("[probe] crashed", error);
    process.exit(1);
  }
);
