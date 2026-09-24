import { deflateSync } from "node:zlib";

/**
 * Deterministic PNG fixtures for the e2e suite (issue #165).
 *
 * PNGs are synthesized at runtime with Node's zlib — no binary files in
 * the repo, byte-identical on every machine and every run. Byte
 * determinism is what makes the upload spec's byte-identity assertion
 * meaningful: the browser PUT body must hash to the same sha256 as the
 * buffer we generated here.
 *
 * The images are flat single-color rectangles; only their dimensions and
 * color matter (the mask canvas keys off aspect ratio, the upload path
 * keys off content-type and bytes).
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** Encodes a flat-color RGB PNG. Deterministic for identical inputs. */
export function solidPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const o = rowStart + 1 + x * 3;
      raw[o] = rgb[0];
      raw[o + 1] = rgb[1];
      raw[o + 2] = rgb[2];
    }
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** The before-photo the specs upload — 96x64 (3:2 aspect) sage green. */
export function roomPhotoFixture(): Buffer {
  return solidPng(96, 64, [122, 139, 111]);
}

/**
 * The fake "fal.ai staged result" the mock storage serves for inpaint
 * completions — 96x64 warm terracotta, visually distinct from the before
 * photo so a mis-render would be noticeable in headed runs.
 */
export function stagedResultFixture(): Buffer {
  return solidPng(96, 64, [204, 122, 90]);
}

/**
 * A second staged image for progressive-edit runs (variant 2 / slot 1).
 */
export function stagedResultFixtureB(): Buffer {
  return solidPng(96, 64, [90, 122, 204]);
}
