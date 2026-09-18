import { inflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  CONCEPT_INSTANCE_CUTOUTS,
  FIXTURE_IMAGE_HEIGHT,
  FIXTURE_IMAGE_WIDTH,
  alphaCutoutPng,
  crc32,
} from "./e2e/cutout-png";

/**
 * Pins the byte layout of the e2e cutout-fixture encoder (issue #231).
 * The Playwright concept spec depends on the browser decoding these PNGs
 * into the exact opaque regions the click choreography targets — a silent
 * encoder regression (wrong color type, broken CRC, shifted rows) would
 * otherwise surface as a baffling "instance never toggled" spec failure.
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface PngChunk {
  type: string;
  data: Buffer;
}

function parseChunks(png: Buffer): PngChunk[] {
  expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  const chunks: PngChunk[] = [];
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    const data = png.subarray(offset + 8, offset + 8 + length);
    const crc = png.readUInt32BE(offset + 8 + length);
    expect(crc, `CRC of ${type} chunk`).toBe(crc32(png.subarray(offset + 4, offset + 8 + length)));
    chunks.push({ type, data });
    offset += 12 + length;
  }
  return chunks;
}

/** Alpha at (x, y) from the inflated, filter-byte-stripped scanlines. */
function alphaAt(raw: Buffer, width: number, x: number, y: number): number {
  const stride = width * 4;
  return raw[y * (stride + 1) + 1 + x * 4 + 3];
}

describe("alphaCutoutPng", () => {
  it("encodes a spec-compliant RGBA PNG whose chunk CRCs verify", () => {
    const png = alphaCutoutPng({
      width: FIXTURE_IMAGE_WIDTH,
      height: FIXTURE_IMAGE_HEIGHT,
      regions: [{ x: 0, y: 30, w: FIXTURE_IMAGE_WIDTH, h: 5 }],
    });
    const chunks = parseChunks(png);

    expect(chunks.map((chunk) => chunk.type)).toEqual(["IHDR", "IDAT", "IEND"]);
    const ihdr = chunks[0].data;
    expect(ihdr.length).toBe(13);
    expect(ihdr.readUInt32BE(0)).toBe(FIXTURE_IMAGE_WIDTH);
    expect(ihdr.readUInt32BE(4)).toBe(FIXTURE_IMAGE_HEIGHT);
    expect(ihdr[8]).toBe(8); // bit depth
    expect(ihdr[9]).toBe(6); // color type: RGBA
    expect(chunks[2].data.length).toBe(0); // IEND
  });

  it("carries opaque pixels exactly inside the regions and transparent outside", () => {
    const png = alphaCutoutPng({
      width: FIXTURE_IMAGE_WIDTH,
      height: FIXTURE_IMAGE_HEIGHT,
      regions: [
        { x: 0, y: 30, w: FIXTURE_IMAGE_WIDTH, h: 5 },
        { x: 4, y: 44, w: 37, h: 17 },
      ],
    });
    const idat = parseChunks(png)[1].data;
    const raw = inflateSync(idat);
    expect(raw.length).toBe(FIXTURE_IMAGE_HEIGHT * (FIXTURE_IMAGE_WIDTH * 4 + 1));

    // Band instance: rows 30–34 opaque across the full width.
    expect(alphaAt(raw, FIXTURE_IMAGE_WIDTH, 0, 30)).toBe(255);
    expect(alphaAt(raw, FIXTURE_IMAGE_WIDTH, 95, 32)).toBe(255);
    // Block instance: rows 44–60 × cols 4–40.
    expect(alphaAt(raw, FIXTURE_IMAGE_WIDTH, 4, 44)).toBe(255);
    expect(alphaAt(raw, FIXTURE_IMAGE_WIDTH, 40, 60)).toBe(255);
    // Outside both regions: transparent (row above the band, col right of
    // the block, and the bottom floor strip).
    expect(alphaAt(raw, FIXTURE_IMAGE_WIDTH, 48, 29)).toBe(0);
    expect(alphaAt(raw, FIXTURE_IMAGE_WIDTH, 41, 50)).toBe(0);
    expect(alphaAt(raw, FIXTURE_IMAGE_WIDTH, 48, 63)).toBe(0);
  });

  it("is deterministic for identical inputs", () => {
    const spec = {
      width: FIXTURE_IMAGE_WIDTH,
      height: FIXTURE_IMAGE_HEIGHT,
      regions: [{ x: 4, y: 44, w: 37, h: 17 }],
    } as const;
    expect(alphaCutoutPng(spec).equals(alphaCutoutPng(spec))).toBe(true);
  });

  it("ships the two-instance fixture with disjoint opaque regions", () => {
    expect(CONCEPT_INSTANCE_CUTOUTS).toHaveLength(2);
    for (const dataUrl of CONCEPT_INSTANCE_CUTOUTS) {
      expect(dataUrl).toMatch(/^data:image\/png;base64,/);
      // Every fixture must decode as structurally valid PNG.
      const png = Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ""), "base64");
      expect(parseChunks(png).map((chunk) => chunk.type)).toEqual(["IHDR", "IDAT", "IEND"]);
    }
  });
});
