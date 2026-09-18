/**
 * Deterministic PNG fixtures for the SAM 3.1 concept flow (issues #231
 * and #248).
 *
 * The concept-flow spec mocks `/api/segment/furnishings` with MULTIPLE
 * detected instances so real canvas clicks can toggle two distinct
 * objects. TWO provider encodings are generated:
 *
 * - `grayscaleMaskPng` — the LIVE `fal-ai/sam-3-1/image` format captured
 *   2026-09-18 (issue #248): color type 0, white object on black, NO
 *   alpha channel. `CONCEPT_INSTANCE_GRAYSCALE_MASKS` is the spec's
 *   PRIMARY fixture, so the full auto-fire → toggle → union → batch path
 *   runs against what the provider really serves.
 * - `alphaCutoutPng` — the #228-era assumed format (transparent
 *   background, photo-colored object pixels), kept for the unit-level
 *   format-parity pins in tests/mask-format.test.ts.
 *
 * Zero dependencies: raw scanlines + zlib deflate + hand-rolled CRC32,
 * mirroring the `solidPng` approach in fixtures.ts. Pure Node —
 * importable from vitest (`tests/cutout-png.test.ts` pins the byte
 * layout) without dragging `@playwright/test` into the unit run.
 *
 * Side effects: none (pure encoding).
 */

import { deflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let crcTableCache: number[] | null = null;

function crcTable(): number[] {
  if (crcTableCache) return crcTableCache;
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  crcTableCache = table;
  return table;
}

/** CRC-32 (IEEE 802.3) — the PNG chunk checksum. Pure. */
export function crc32(buf: Buffer): number {
  const table = crcTable();
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/** One opaque rectangle: inclusive start, exclusive end per axis. */
export interface CutoutRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CutoutSpec {
  width: number;
  height: number;
  /** Opaque regions; everything else stays fully transparent. */
  regions: readonly CutoutRegion[];
  /** Fill color of the opaque regions (defaults to the photo's sage). */
  rgb?: readonly [number, number, number];
}

/**
 * Encodes a width×height RGBA PNG: fully transparent background, the
 * given regions opaque. Deterministic for identical inputs.
 */
export function alphaCutoutPng(spec: CutoutSpec): Buffer {
  const rgb = spec.rgb ?? [122, 139, 111];
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(spec.width, 0);
  ihdr.writeUInt32BE(spec.height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA (the cutout format carries alpha)
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = spec.width * 4;
  const raw = Buffer.alloc((stride + 1) * spec.height);
  for (const region of spec.regions) {
    for (let y = region.y; y < region.y + region.h; y++) {
      for (let x = region.x; x < region.x + region.w; x++) {
        const offset = y * (stride + 1) + 1 + x * 4;
        raw[offset] = rgb[0];
        raw[offset + 1] = rgb[1];
        raw[offset + 2] = rgb[2];
        raw[offset + 3] = 255; // opaque: the pixel IS the object
      }
    }
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Same pixels as {@link alphaCutoutPng}, as a decodable data URL. */
export function alphaCutoutDataUrl(spec: CutoutSpec): string {
  return `data:image/png;base64,${alphaCutoutPng(spec).toString("base64")}`;
}

/**
 * Encodes a width×height GRAYSCALE PNG (color type 0, 8-bit): black
 * background, the given regions white — the live SAM 3.1 mask format
 * (issue #248). Ignores `spec.rgb` (a grayscale mask has no color).
 * Deterministic for identical inputs.
 */
export function grayscaleMaskPng(spec: CutoutSpec): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(spec.width, 0);
  ihdr.writeUInt32BE(spec.height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // color type: grayscale (no alpha channel — the live format)
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = spec.width;
  const raw = Buffer.alloc((stride + 1) * spec.height);
  for (const region of spec.regions) {
    for (let y = region.y; y < region.y + region.h; y++) {
      for (let x = region.x; x < region.x + region.w; x++) {
        raw[y * (stride + 1) + 1 + x] = 255; // white: the pixel IS the object
      }
    }
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Same pixels as {@link grayscaleMaskPng}, as a decodable data URL. */
export function grayscaleMaskDataUrl(spec: CutoutSpec): string {
  return `data:image/png;base64,${grayscaleMaskPng(spec).toString("base64")}`;
}

/** Geometry of every e2e fixture image (matches `roomPhotoFixture`). */
export const FIXTURE_IMAGE_WIDTH = 96;
export const FIXTURE_IMAGE_HEIGHT = 64;

/**
 * Two DISJOINT detected instances for the concept-flow spec (issue #231):
 *
 *  - index 0: horizontal band across rows 30–34, full width — the same
 *    geometry as the preset's single cutout fixture, so canvas-center
 *    clicks (y ≈ 0.5) hit it;
 *  - index 1: block at rows 44–60 × cols 4–40 — a lower-left click
 *    (x ≈ 0.2, y ≈ 0.8) hits ONLY this one, because the regions don't
 *    overlap and `findInstanceAtPoint` returns the best-ranked instance
 *    containing the point.
 *
 * The disjointness is what makes two-instance toggling deterministic.
 * Both encodings share the geometry: GRAYSCALE is the spec's primary
 * fixture (issue #248); the alpha cutouts stay for unit-level parity.
 */
export const CONCEPT_INSTANCE_CUTOUTS: string[] = [
  alphaCutoutDataUrl({
    width: FIXTURE_IMAGE_WIDTH,
    height: FIXTURE_IMAGE_HEIGHT,
    regions: [{ x: 0, y: 30, w: FIXTURE_IMAGE_WIDTH, h: 5 }],
  }),
  alphaCutoutDataUrl({
    width: FIXTURE_IMAGE_WIDTH,
    height: FIXTURE_IMAGE_HEIGHT,
    regions: [{ x: 4, y: 44, w: 37, h: 17 }],
  }),
];

/** {@link CONCEPT_INSTANCE_CUTOUTS} in the live grayscale format (#248). */
export const CONCEPT_INSTANCE_GRAYSCALE_MASKS: string[] = [
  grayscaleMaskDataUrl({
    width: FIXTURE_IMAGE_WIDTH,
    height: FIXTURE_IMAGE_HEIGHT,
    regions: [{ x: 0, y: 30, w: FIXTURE_IMAGE_WIDTH, h: 5 }],
  }),
  grayscaleMaskDataUrl({
    width: FIXTURE_IMAGE_WIDTH,
    height: FIXTURE_IMAGE_HEIGHT,
    regions: [{ x: 4, y: 44, w: 37, h: 17 }],
  }),
];
