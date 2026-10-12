/**
 * One-shot helper: bake 3 mask PNGs (centered rectangle) and upload each via
 * fal.storage so the incumbent FLUX.1 Fill slot has a real mask URL to consume.
 *
 * Reads case images from bake-off/<case>.json (imageUrl field), generates a
 * centered-rectangle mask matching the source dimensions, uploads to fal
 * storage, and writes the resulting URL back into maskUrl in-place.
 *
 * Usage: FAL_KEY=... npx tsx scripts/bake-off-prep-masks.mts
 *
 * Idempotent: only runs the upload + write when maskUrl is null or starts with
 * "https://v3b.fal.media/" (i.e. a stale upload from a prior run).
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fal } from "@fal-ai/client";

const CASES = ["vacant-insert", "occupied-replace", "repeat-stability"];
const BAKE_OFF_DIR = path.resolve(process.cwd(), "bake-off");

interface CaseFixture {
  prompt?: string;
  imageUrl?: string;
  maskUrl?: string | null;
}

function maskPng(width: number, height: number): Buffer {
  // Centered rectangle covering ~45% of the image area — the staging zone.
  const w = Math.round(width * 0.55);
  const h = Math.round(height * 0.55);
  const x0 = Math.round((width - w) / 2);
  const y0 = Math.round((height - h) / 2);

  const png = new PngBuilder(width, height);
  png.fillWhite();
  png.fillBlackRect(x0, y0, w, h);
  return png.toBuffer();
}

class PngBuilder {
  private pixels: Uint8Array;
  constructor(
    private width: number,
    private height: number,
  ) {
    // RGBA pixel buffer.
    this.pixels = new Uint8Array(width * height * 4);
  }
  fillWhite() {
    for (let i = 0; i < this.pixels.length; i += 4) {
      this.pixels[i] = 255;
      this.pixels[i + 1] = 255;
      this.pixels[i + 2] = 255;
      this.pixels[i + 3] = 255;
    }
  }
  fillBlackRect(x: number, y: number, w: number, h: number) {
    for (let row = y; row < y + h; row++) {
      for (let col = x; col < x + w; col++) {
        const i = (row * this.width + col) * 4;
        this.pixels[i] = 0;
        this.pixels[i + 1] = 0;
        this.pixels[i + 2] = 0;
        this.pixels[i + 3] = 255;
      }
    }
  }
  toBuffer(): Buffer {
    return encodePng(this.width, this.height, this.pixels);
  }
}

// Minimal PNG encoder (RGBA, no filter, no compression — zlib stream only).
function encodePng(
  width: number,
  height: number,
  rgba: Uint8Array,
): Buffer {
  const crc32 = crc32Table();

  function chunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, "ascii");
    const crc = Buffer.alloc(4);
    const c = crc32Val(crc32, Buffer.concat([typeBuf, data]));
    crc.writeUInt32BE(c >>> 0, 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  }

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // IDAT — prepend filter byte 0 per row
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let row = 0; row < height; row++) {
    raw[row * (stride + 1)] = 0;
    rgba.subarray(row * stride, (row + 1) * stride).copy(
      raw,
      row * (stride + 1) + 1,
    );
  }
  const idat = zlib.deflateSync(raw);

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function crc32Table(): Uint32Array {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
}

function crc32Val(table: Uint32Array, buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

async function probeImageDimensions(
  url: string,
): Promise<{ width: number; height: number }> {
  // Read first 24 bytes of PNG header. For JPEG we'd need full scan; Unsplash
  // returns JPEG for ?w= queries. Probe via HEAD's content-type, fall back to
  // 1024x1024 default for unknown encodings (FLUX.1 Fill requires exact-match
  // dimensions so we'll catch a mismatch downstream).
  const head = await fetch(url, { method: "HEAD" });
  const ct = head.headers.get("content-type") ?? "";
  if (ct.includes("png")) {
    const r = await fetch(url);
    const buf = Buffer.from(await r.arrayBuffer());
    // PNG: width @ 16-19, height @ 20-23 (big-endian)
    return {
      width: buf.readUInt32BE(16),
      height: buf.readUInt32BE(20),
    };
  }
  // JPEG: scan for SOF0/SOF2 marker (0xFFC0 / 0xFFC2) — segments start after 0xFFD8
  const r = await fetch(url);
  const buf = Buffer.from(await r.arrayBuffer());
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) break;
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker === 0xc0 || marker === 0xc2) {
      return {
        height: buf.readUInt16BE(i + 5),
        width: buf.readUInt16BE(i + 7),
      };
    }
    i += 2 + len;
  }
  throw new Error(`could not determine dimensions for ${url}`);
}

async function main() {
  const key = process.env.FAL_KEY;
  if (!key) {
    console.error(
      "FAL_KEY is missing. Set it in your shell or .env.local; never paste it in chat.",
    );
    process.exit(1);
  }
  fal.config({ credentials: key });

  for (const cs of CASES) {
    const fixturePath = path.join(BAKE_OFF_DIR, `${cs}.json`);
    const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as CaseFixture;
    if (fixture.maskUrl && fixture.maskUrl.startsWith("https://")) {
      console.log(`${cs}: already has maskUrl, skipping`);
      continue;
    }
    if (!fixture.imageUrl) {
      console.warn(`${cs}: no imageUrl, skipping`);
      continue;
    }
    console.log(`${cs}: probing ${fixture.imageUrl}`);
    const { width, height } = await probeImageDimensions(fixture.imageUrl);
    console.log(`  dimensions: ${width}x${height}`);
    const png = maskPng(width, height);
    const file = new File([png], `${cs}-mask.png`, { type: "image/png" });
    console.log(`  uploading mask (${png.length} bytes)`);
    const url = await fal.storage.upload(file);
    fixture.maskUrl = url;
    fs.writeFileSync(fixturePath, JSON.stringify(fixture, null, 2) + "\n");
    console.log(`  wrote ${url}`);
  }
  console.log("done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});