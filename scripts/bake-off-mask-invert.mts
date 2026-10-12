/**
 * Helpers for OpenAI's edits endpoint, which uses a different mask convention
 * than fal: transparent pixels = area to edit, opaque = area to keep. Our
 * fal masks follow fal's convention: white pixels = edit area, black pixels = keep.
 *
 * invertFalMaskToOpenAIDataUrl(maskUrl)
 *   Fetches the white-rect-on-black mask, converts white pixels (the fal edit area)
 *   to alpha=0 transparent and black pixels to alpha=255 opaque, returning a base64
 *   data URL ready for OpenAI's image_url field. Pixel dimensions unchanged.
 */
import zlib from "node:zlib";

interface PngDims {
  width: number;
  height: number;
}

async function probeDims(url: string): Promise<PngDims> {
  const head = await fetch(url, { method: "HEAD" });
  const ct = head.headers.get("content-type") ?? "";
  if (!ct.includes("png")) {
    throw new Error(`mask URL ${url} is not PNG (content-type: ${ct})`);
  }
  const r = await fetch(url);
  const buf = Buffer.from(await r.arrayBuffer());
  // PNG: width @ 16-19, height @ 20-23 (big-endian)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

interface ParsedMask {
  width: number;
  height: number;
  // RGBA pixel buffer: white-rect-on-black convention (fal style; white = edit).
  pixels: Buffer;
}

async function loadMask(url: string): Promise<ParsedMask> {
  const r = await fetch(url);
  const buf = Buffer.from(await r.arrayBuffer());
  return decodePng(buf);
}

// Minimal RGBA PNG decoder for our 8-bit masks (no interlace, no 16-bit).
function decodePng(buf: Buffer): ParsedMask {
  if (
    buf[0] !== 0x89 ||
    buf[1] !== 0x50 ||
    buf[2] !== 0x4e ||
    buf[3] !== 0x47
  ) {
    throw new Error("not a PNG");
  }
  let i = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];
  while (i < buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.slice(i + 4, i + 8).toString("ascii");
    const data = buf.slice(i + 8, i + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }
    i += 8 + len + 4;
  }
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  if (colorType !== 2 && colorType !== 6) {
    throw new Error(
      `unsupported color type ${colorType}; expected RGB(2) or RGBA(6)`,
    );
  }
  const channels = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  let prevRow = Buffer.alloc(stride);
  for (let row = 0; row < height; row++) {
    const filter = raw[row * (stride + 1)];
    const cur = Buffer.from(raw.slice(row * (stride + 1) + 1, (row + 1) * (stride + 1)));
    // Apply PNG filter.
    const recon = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? recon[x - channels] : 0;
      const b = prevRow[x];
      const c = x >= channels ? prevRow[x - channels] : 0;
      let v: number;
      switch (filter) {
        case 0:
          v = cur[x];
          break;
        case 1:
          v = (cur[x] + a) & 0xff;
          break;
        case 2:
          v = (cur[x] + b) & 0xff;
          break;
        case 3:
          v = (cur[x] + ((a + b) >> 1)) & 0xff;
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          v = (cur[x] + paeth) & 0xff;
          break;
        }
        default:
          throw new Error(`unsupported filter ${filter}`);
      }
      recon[x] = v;
    }
    prevRow = recon;
    // Emit RGBA.
    for (let x = 0; x < width; x++) {
      const si = x * channels;
      const di = (row * width + x) * 4;
      out[di] = recon[si];
      out[di + 1] = recon[si + 1];
      out[di + 2] = recon[si + 2];
      out[di + 3] = channels === 4 ? recon[si + 3] : 0xff;
    }
  }
  return { width, height, pixels: out };
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

function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const table = crc32Table();
  function chunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32Val(table, Buffer.concat([typeBuf, data])) >>> 0, 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let row = 0; row < height; row++) {
    raw[row * (stride + 1)] = 0;
    rgba.copy(raw, row * (stride + 1) + 1, row * stride, (row + 1) * stride);
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

/**
 * Detect whether a pixel is the "edit" area (white on the fal mask) or the
 * "keep" area (black) by luminance threshold. White = edit (luminance >= 128).
 */
function isEdit(r: number, g: number, b: number): boolean {
  return (r + g + b) / 3 >= 128;
}

export async function invertFalMaskToOpenAIDataUrl(
  maskUrl: string,
): Promise<string> {
  const dims = await probeDims(maskUrl);
  const mask = await loadMask(maskUrl);
  if (mask.width !== dims.width || mask.height !== dims.height) {
    throw new Error("PNG dimension probe mismatch");
  }
  const { width, height, pixels } = mask;
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const r = pixels[i * 4];
    const g = pixels[i * 4 + 1];
    const b = pixels[i * 4 + 2];
    const edit = isEdit(r, g, b);
    if (edit) {
      // transparent inside the edit region
      out[i * 4] = 0;
      out[i * 4 + 1] = 0;
      out[i * 4 + 2] = 0;
      out[i * 4 + 3] = 0;
    } else {
      // opaque outside
      out[i * 4] = 255;
      out[i * 4 + 1] = 255;
      out[i * 4 + 2] = 255;
      out[i * 4 + 3] = 255;
    }
  }
  const png = encodePng(width, height, out);
  return `data:image/png;base64,${png.toString("base64")}`;
}