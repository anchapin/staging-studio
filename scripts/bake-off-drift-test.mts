/**
 * Drift test: submit the same prompt + same seed N times to a model,
 * pixel-diff the unedited region across the N outputs. Reports mean and
 * max RGB delta outside the mask.
 *
 * Usage: FAL_KEY=... npx tsx scripts/bake-off-drift-test.mts
 *
 * Compares two slots:
 *   - flux-pro-fill (incumbent, mask-fill) — expected to lock pixels outside
 *     the mask numerically.
 *   - seedream-5-flash (instruction, no mask) — what we want to characterize.
 *
 * If seedream drifts more than ~1% of the unedited region's pixels (by mean
 * RGB delta), the dual-model comparison UI is misleading: the user can't tell
 * quality from drift. Threshold here is loose; a real "no drift" expectation
 * is mean delta < 2 across RGB.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import sharp from "sharp";

const BAKE_OFF_DIR = path.resolve(process.cwd(), "bake-off");
const RUNS = 3;
const SEED = 42; // Fixed seed for reproducibility across the N submissions.

interface CaseFixture {
  prompt: string;
  imageUrl: string;
  maskUrl: string | null;
}

interface RgbaImage {
  width: number;
  height: number;
  pixels: Buffer; // RGBA
}

function requireFalKey(): string {
  const key = process.env.FAL_KEY;
  if (!key) {
    console.error("FAL_KEY is missing.");
    process.exit(1);
  }
  return key;
}

async function decodePng(buf: Buffer): Promise<RgbaImage> {
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
    } else if (type === "IEND") break;
    i += 8 + len + 4;
  }
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  if (colorType !== 2 && colorType !== 6) {
    throw new Error(`unsupported color type ${colorType}`);
  }
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const out = Buffer.alloc(width * height * 4);
  let prevRow = Buffer.alloc(stride);
  for (let row = 0; row < height; row++) {
    const filter = raw[row * (stride + 1)];
    const cur = Buffer.from(
      raw.slice(row * (stride + 1) + 1, (row + 1) * (stride + 1)),
    );
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

async function fetchImage(url: string): Promise<RgbaImage> {
  const r = await fetch(url);
  const buf = Buffer.from(await r.arrayBuffer());
  // Probe PNG magic; otherwise route through sharp which handles JPEG/PNG/WebP.
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return decodePng(buf);
  }
  const result = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (!result.data || result.data.length === 0) {
    throw new Error(`sharp returned empty buffer for ${url}`);
  }
  return { width: result.info.width, height: result.info.height, pixels: result.data };
}

interface SlotConfig {
  id: string;
  vendor: "fal" | "openai";
  mode: "mask-fill" | "instruction";
  expectedEndpoint: string;
  // Per-slot field overrides mirroring scripts/bake-off-slots.json inputShape.
  maskField?: string;
  referenceImageUrl?: string | null;
}

async function falQueueSubmit(
  model: string,
  input: Record<string, unknown>,
  key: string,
): Promise<{ status: string; images: Array<{ url: string }> }> {
  const submit = await fetch(`https://queue.fal.run/${model}`, {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!submit.ok) throw new Error(`submit ${submit.status}: ${await submit.text()}`);
  const { status_url, response_url } = (await submit.json()) as {
    status_url: string;
    response_url: string;
  };
  for (let i = 0; i < 150; i++) {
    const poll = await fetch(status_url, {
      headers: { Authorization: `Key ${key}` },
    });
    const { status } = (await poll.json()) as { status: string };
    if (status === "COMPLETED") break;
    if (status === "FAILED") {
      throw new Error(`provider FAILED: ${await poll.text()}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  const res = await fetch(response_url, {
    headers: { Authorization: `Key ${key}` },
  });
  return (await res.json()) as { status: string; images: Array<{ url: string }> };
}

async function runSlot(
  slot: SlotConfig,
  caseInput: CaseFixture,
  key: string,
): Promise<RgbaImage[]> {
  console.log(`\n[${slot.id}] submitting ${RUNS} runs with seed=${SEED}`);
  const images: RgbaImage[] = [];
  for (let i = 0; i < RUNS; i++) {
    const input: Record<string, unknown> = {
      prompt: caseInput.prompt,
      seed: SEED,
    };
    const maskField = slot.maskField ?? "mask_url";
    if (slot.mode === "instruction" && caseInput.imageUrl) {
      input.image_urls = [caseInput.imageUrl];
    } else if (slot.mode === "mask-fill") {
      input.image_url = caseInput.imageUrl;
      input[maskField] = caseInput.maskUrl;
      // Kontext LoRA requires reference_image_url. Pass the source image as
      // the reference so the model has full context of the existing scene
      // rather than getting distracted by an arbitrary stock photo.
      if (slot.referenceImageUrl !== undefined) {
        input.reference_image_url =
          slot.referenceImageUrl === "$imageUrl" ? caseInput.imageUrl : slot.referenceImageUrl;
      }
    }
    const t0 = Date.now();
    const out = await falQueueSubmit(slot.expectedEndpoint, input, key);
    const firstUrl = out.images[0]?.url;
    if (!firstUrl) {
      throw new Error(`${slot.id} run ${i + 1}: no image in response`);
    }
    const img = await fetchImage(firstUrl);
    images.push(img);
    console.log(`  run ${i + 1}: ${(Date.now() - t0) / 1000}s -> ${img.width}x${img.height}`);
  }
  return images;
}

interface DiffStats {
  meanR: number;
  meanG: number;
  meanB: number;
  maxR: number;
  maxG: number;
  maxB: number;
  pixelsCompared: number;
}

function diffImages(a: RgbaImage, b: RgbaImage, mask: RgbaImage): DiffStats {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(
      `dimension mismatch ${a.width}x${a.height} vs ${b.width}x${b.height}`,
    );
  }
  if (a.width !== mask.width || a.height !== mask.height) {
    throw new Error(`mask dim mismatch`);
  }
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let maxR = 0;
  let maxG = 0;
  let maxB = 0;
  let compared = 0;
  for (let i = 0; i < a.width * a.height; i++) {
    // Skip pixels inside the mask (white == edit area, black == preserve). Drift
    // is measured only in the preserved region so we exclude the model's actual
    // edit output from the comparison.
    const mr = mask.pixels[i * 4];
    const mg = mask.pixels[i * 4 + 1];
    const mb = mask.pixels[i * 4 + 2];
    if ((mr + mg + mb) / 3 >= 128) continue;
    const dr = Math.abs(a.pixels[i * 4] - b.pixels[i * 4]);
    const dg = Math.abs(a.pixels[i * 4 + 1] - b.pixels[i * 4 + 1]);
    const db = Math.abs(a.pixels[i * 4 + 2] - b.pixels[i * 4 + 2]);
    sumR += dr;
    sumG += dg;
    sumB += db;
    if (dr > maxR) maxR = dr;
    if (dg > maxG) maxG = dg;
    if (db > maxB) maxB = db;
    compared++;
  }
  return {
    meanR: compared ? sumR / compared : 0,
    meanG: compared ? sumG / compared : 0,
    meanB: compared ? sumB / compared : 0,
    maxR,
    maxG,
    maxB,
    pixelsCompared: compared,
  };
}

function fmtStats(label: string, stats: DiffStats): string {
  const mean = (stats.meanR + stats.meanG + stats.meanB) / 3;
  const max = Math.max(stats.maxR, stats.maxG, stats.maxB);
  return `  ${label}: mean delta ${mean.toFixed(3)} (R ${stats.meanR.toFixed(2)} G ${stats.meanG.toFixed(2)} B ${stats.meanB.toFixed(2)}) max ${max} over ${stats.pixelsCompared} unedited pixels`;
}

async function resizeMaskTo(mask: RgbaImage, target: RgbaImage): Promise<RgbaImage> {
  if (mask.width === target.width && mask.height === target.height) return mask;
  // Use sharp to resize the mask's white-rect-on-black PNG (white = edit area)
  // to the output's dimensions.
  // sharp expects RGBA layout and infers format from input buffer dimensions.
  const result = await sharp(mask.pixels, {
    raw: { width: mask.width, height: mask.height, channels: 4 },
  })
    .resize(target.width, target.height, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (!result.data || result.data.length === 0) {
    throw new Error(`resizeMaskTo: empty buffer (mask ${mask.width}x${mask.height} -> target ${target.width}x${target.height})`);
  }
  return { width: result.info.width, height: result.info.height, pixels: result.data };
}

async function main() {
  const key = requireFalKey();
  const caseInput = JSON.parse(
    fs.readFileSync(path.join(BAKE_OFF_DIR, "vacant-insert.json"), "utf8"),
  ) as CaseFixture;

  console.log("decoding shared mask + source image...");
  const maskSrc = await fetchImage(caseInput.maskUrl!);

  const slots: SlotConfig[] = [
    {
      id: "seedream-5-flash",
      vendor: "fal",
      mode: "instruction",
      expectedEndpoint: "bytedance/seedream/v5/flash/edit",
    },
    {
      id: "qwen-image-2-1",
      vendor: "fal",
      mode: "instruction",
      expectedEndpoint: "fal-ai/qwen-image-2.1/edit",
    },
    {
      id: "nano-banana-2-1",
      vendor: "fal",
      mode: "instruction",
      expectedEndpoint: "fal-ai/nano-banana-2.1/edit",
    },
  ];

  for (const slot of slots) {
    const images = await runSlot(slot, caseInput, key);
    if (images.length < 2) {
      console.log(`[${slot.id}] not enough images to diff`);
      continue;
    }
    // Resize mask to each output's dimensions (the two slots output at
    // different resolutions, so we resize per-image rather than once globally).
    console.log(`\n[${slot.id}] pairwise drift in unedited region (lower = more stable):`);
    for (let i = 1; i < images.length; i++) {
      const maskSized = await resizeMaskTo(maskSrc, images[0]);
      console.log(fmtStats(`run 1 vs run ${i + 1}`, diffImages(images[0], images[i], maskSized)));
    }
    for (let i = 0; i < images.length; i++) {
      for (let j = i + 1; j < images.length; j++) {
        const maskSized = await resizeMaskTo(maskSrc, images[i]);
        console.log(fmtStats(`run ${i + 1} vs run ${j + 1}`, diffImages(images[i], images[j], maskSized)));
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});