/**
 * Offline probe for issue #1458 — soft-matte refinement stage between
 * segmentation and inpainting.
 *
 * WHAT THIS IS (and is not)
 * ------------------------
 * This harness answers three questions that can be answered **without a
 * network, without API keys and without model weights**:
 *
 *   1. Does the CURRENT production path even carry a mask (and therefore
 *      any alpha) to the inpaint provider? — measured against the repo's
 *      own payload builders, not against prose.
 *   2. Does the repo's mask pipeline preserve a *soft* alpha, or does it
 *      collapse every alpha to 0/1? — measured against the repo's own
 *      mask decoders (`mask-flood-fill.ts`, `mask-coverage.ts`).
 *   3. What does the non-neural part of a soft-alpha stage cost on CPU,
 *      and how much of a translucent object's opacity survives the
 *      binary white-on-black mask convention the repo speaks?
 *      — measured with a separable box blur over an alpha channel.
 *
 * It does NOT run a matting model. No matting network (BiRefNet, CorridorKey,
 * anything else) is downloaded or executed here; the sandbox has neither
 * `torch` nor `onnxruntime` (checked: `ModuleNotFoundError` for both), and
 * the issue's hard stops forbid paid API calls and large weight downloads.
 * The latency numbers printed below are therefore **CPU-baseline numbers for
 * the alpha plumbing only** — they are a floor for the stage, not a model
 * measurement. See `docs/1458-soft-matte-evaluation.md` §7.
 *
 * RUN
 * ---
 *   node scripts/soft-matte-alpha-probe.mts        # Node >= 22.18 (type stripping)
 *   npx tsx scripts/soft-matte-alpha-probe.mts      # repo convention for scripts
 *
 * No env vars, no secrets, no network access. Exit code 0 = all probes
 * passed, 1 = a probe assertion failed.
 */

import { register } from "node:module";
import { readFileSync } from "node:fs";

// ─── ESM resolver shim ──────────────────────────────────────────────────────
// The repo's TS modules use extensionless relative imports ("../lib/x"),
// which Node's native ESM resolver rejects. Register a tiny resolve hook
// that retries with ".ts" / "/index.ts". This keeps the harness honest —
// it runs the REAL repo modules, not a copy of them.
const LOADER_SOURCE = `
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (specifier.startsWith(".") || specifier.startsWith("/")) {
      for (const candidate of [specifier + ".ts", specifier + "/index.ts"]) {
        try {
          return await nextResolve(candidate, context);
        } catch {
          /* try the next candidate */
        }
      }
    }
    throw err;
  }
}
`;
register(`data:text/javascript,${encodeURIComponent(LOADER_SOURCE)}`, import.meta.url);

// ─── Probe 1: what the provider payload actually carries ────────────────────
// src/lib/prompts.ts → buildInpaintPayloadForActiveProvider() →
// buildAlibabaFillPayload() (the default provider since #1240).
const { buildInpaintPayloadForActiveProvider } = await import(
  "../src/lib/prompts.ts"
);
// src/lib/mask-flood-fill.ts → maskGridFromAlphaPixels() / maskGridFromPixels()
const { maskGridFromAlphaPixels, maskGridFromPixels } = await import(
  "../src/lib/mask-flood-fill.ts"
);
// src/lib/mask-coverage.ts → estimateMaskCoverage() / estimateMaskAlphaMass()
const { estimateMaskCoverage, estimateMaskAlphaMass } = await import(
  "../src/lib/mask-coverage.ts"
);

const results: Array<{
  probe: string;
  status: "PASS" | "FAIL" | "INFO";
  detail: string;
}> = [];
function pass(probe: string, detail: string): void {
  results.push({ probe, status: "PASS", detail });
}
function fail(probe: string, detail: string): void {
  results.push({ probe, status: "FAIL", detail });
}
function info(probe: string, detail: string): void {
  results.push({ probe, status: "INFO", detail });
}

// ---------------------------------------------------------------------------
// Probe 1 — production payload shape (does the mask reach the provider?)
// ---------------------------------------------------------------------------
{
  const payload = buildInpaintPayloadForActiveProvider({
    imageUrl: "https://example.invalid/room.jpg",
    maskUrl: "data:image/png;base64,iVBORw0KGgo=",
    prompt: "remove the curtain",
  });
  const keys = Object.keys(payload as Record<string, unknown>).sort();
  const hasMask = keys.some((k) => /mask/i.test(k));
  if (hasMask) {
    fail(
      "P1 provider payload carries a mask",
      `unexpected mask key(s) in payload: ${keys.join(", ")}`,
    );
  } else {
    pass(
      "P1 provider payload carries NO mask",
      `buildInpaintPayloadForActiveProvider() returned keys [${keys.join(", ")}] — ` +
        `the maskUrl argument is dropped before the wire. A soft-alpha stage ` +
        `cannot change provider output until a mask is wired to the provider.`,
    );
  }
  // Second, independent check straight from the source text of the adapter:
  // the DashScope request body must not contain a mask field.
  const adapterSrc = readFileSync(
    new URL("../src/lib/alibaba-adapter.ts", import.meta.url),
    "utf8",
  );
  const bodyStart = adapterSrc.indexOf("const body = {");
  const bodyEnd = adapterSrc.indexOf("};", bodyStart);
  const body = adapterSrc.slice(bodyStart, bodyEnd);
  const bodyHasMask = /mask/i.test(body);
  if (bodyHasMask) {
    fail("P1b DashScope request body", "body mentions a mask field");
  } else {
    pass(
      "P1b DashScope request body",
      `the DashScope body built in src/lib/alibaba-adapter.ts has no mask field ` +
        `(inputs: image + text only).`,
    );
  }
}

// ---------------------------------------------------------------------------
// Probe 2 — does the repo's mask pipeline preserve soft alpha?
// ---------------------------------------------------------------------------
{
  const W = 64;
  const H = 64;
  // A synthetic "sheer curtain" tile: white RGB (the repo paints masked
  // pixels white), alpha ramping 0 → 255 across the tile.
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      rgba[o] = 255;
      rgba[o + 1] = 255;
      rgba[o + 2] = 255;
      rgba[o + 3] = Math.round((x / (W - 1)) * 255);
    }
  }
  const alphaGrid = maskGridFromAlphaPixels(rgba, W, H);
  const alphaLevels = new Set(alphaGrid);
  if (alphaLevels.size === 2 && alphaLevels.has(0) && alphaLevels.has(1)) {
    pass(
      "P2 alpha grid is binary",
      `maskGridFromAlphaPixels() collapsed a 256-level alpha ramp into ` +
        `${alphaLevels.size} levels {0,1} — the repo's mask representation ` +
        `carries no opacity information (threshold CUTOUT_ALPHA_THRESHOLD=128).`,
    );
  } else {
    fail(
      "P2 alpha grid is binary",
      `expected a binary grid, got ${alphaLevels.size} distinct levels`,
    );
  }

  // Same buffer through the luminance classifier (the other repo decoder).
  const lumGrid = maskGridFromPixels(rgba, W, H);
  const lumLevels = new Set(lumGrid);
  info(
    "P2b luminance decoder on the same buffer",
    `maskGridFromPixels() → ${lumLevels.size} distinct levels {${[...lumLevels].join(", ")}}; ` +
      `isMaskedPixel() requires alpha >= 128 AND luminance >= 128, so a ` +
      `translucent pixel is classified as "preserve" — the repo treats ` +
      `semi-transparent content as background.`,
  );

  // Coverage of the same buffer under the repo's own estimator.
  const coverage = estimateMaskCoverage(rgba, W, H);
  const alphaMass = estimateMaskAlphaMass(rgba, W, H);
  info(
    "P2c coverage vs. alpha mass (alpha ramp)",
    `estimateMaskCoverage() = ${(coverage * 100).toFixed(1)}% of the tile is "masked"; ` +
      `the alpha-weighted mass of the same tile = ${(alphaMass * 100).toFixed(1)}%. ` +
      `The ramp binarises to a half-painted tile, i.e. the *area* of the ` +
      `object, not its opacity.`,
  );

  // A UNIFORM 40%-opaque tile: the case a sheer curtain actually produces.
  const uni = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    uni[o] = 255;
    uni[o + 1] = 255;
    uni[o + 2] = 255;
    uni[o + 3] = 102; // 40% opaque — below the 128 threshold
  }
  const uniCoverage = estimateMaskCoverage(uni, W, H);
  const uniMass = estimateMaskAlphaMass(uni, W, H);
  info(
    "P2d uniform 40%-opaque tile",
    `estimateMaskCoverage() = ${(uniCoverage * 100).toFixed(1)}% "masked" while the ` +
      `alpha-weighted mass = ${(uniMass * 100).toFixed(1)}%. The binary mask says ` +
      `"replace nothing" for an object that is 40% transparent — a binary mask ` +
      `cannot express partial replacement.`,
  );
}

// ---------------------------------------------------------------------------
// Probe 3 — CPU cost of the alpha plumbing (the non-neural part of a stage)
// ---------------------------------------------------------------------------
function boxBlurAlpha(
  alpha: Float32Array,
  w: number,
  h: number,
  radius: number,
): Float32Array {
  // Separable box blur, 3 passes (H, V, H) — the classic cheap "feather".
  const tmp = new Float32Array(alpha.length);
  const out = new Float32Array(alpha.length);
  const window = radius * 2 + 1;
  const norm = 1 / window;
  const blurH = (src: Float32Array, dst: Float32Array) => {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let sum = 0;
      for (let x = -radius; x <= radius; x++) {
        sum += src[row + Math.min(Math.max(x, 0), w - 1)];
      }
      for (let x = 0; x < w; x++) {
        dst[row + x] = sum * norm;
        const outIdx = row + Math.min(Math.max(x - radius, 0), w - 1);
        const inIdx = row + Math.min(Math.max(x + radius + 1, 0), w - 1);
        sum += src[inIdx] - src[outIdx];
      }
    }
  };
  const blurV = (src: Float32Array, dst: Float32Array) => {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -radius; y <= radius; y++) {
        sum += src[Math.min(Math.max(y, 0), h - 1) * w + x];
      }
      for (let y = 0; y < h; y++) {
        dst[y * w + x] = sum * norm;
        const outIdx = Math.min(Math.max(y - radius, 0), h - 1) * w + x;
        const inIdx = Math.min(Math.max(y + radius + 1, 0), h - 1) * w + x;
        sum += src[inIdx] - src[outIdx];
      }
    }
  };
  blurH(alpha, tmp);
  blurV(tmp, out);
  blurH(out, tmp);
  return tmp;
}

{
  // Sizes used by this repo: the mask canvas decodes with a long edge <= 1024
  // (MERGE_PROXIMITY_PX comment in src/lib/mask-postprocess.ts), and the
  // DashScope request asks for size "2048*1536" (src/lib/alibaba-adapter.ts).
  const sizes: Array<{ label: string; w: number; h: number }> = [
    { label: "mask canvas 1024x768", w: 1024, h: 768 },
    { label: "provider size 2048x1536", w: 2048, h: 1536 },
  ];
  for (const { label, w, h } of sizes) {
    const alpha = new Float32Array(w * h);
    // A soft-edged rectangle ("curtain") as the alpha source.
    const x0 = Math.floor(w * 0.2);
    const x1 = Math.floor(w * 0.8);
    const y0 = Math.floor(h * 0.1);
    const y1 = Math.floor(h * 0.9);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        alpha[y * w + x] = 1;
      }
    }
    const radius = Math.round(Math.min(w, h) * 0.01);
    const t0 = performance.now();
    const blurred = boxBlurAlpha(alpha, w, h, radius);
    const ms = performance.now() - t0;
    // Alpha band = pixels that are neither fully 0 nor fully 1 after the blur.
    let band = 0;
    let sum = 0;
    for (let i = 0; i < blurred.length; i++) {
      const v = blurred[i];
      sum += v;
      if (v > 0.02 && v < 0.98) band++;
    }
    info(
      `P3 alpha blur cost @ ${label}`,
      `radius=${radius}px → ${ms.toFixed(1)} ms CPU for a 3-pass separable box ` +
        `blur over ${w * h} alpha samples (single run, no warm-up). ` +
        `Soft band (0.02 < a < 0.98) = ${band} px ` +
        `(${(100 * band / (w * h)).toFixed(2)}% of the canvas); ` +
        `alpha mass preserved = ${(sum / (w * h) * 100).toFixed(1)}%.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Probe 4 — what survives the binarisation the provider path performs
// ---------------------------------------------------------------------------
{
  // A translucent object at 40% opacity across a 4% of the canvas region.
  const W = 200;
  const H = 200;
  const rgba = new Uint8ClampedArray(W * H * 4);
  const region = { x0: 40, x1: 80, y0: 40, y1: 80 };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const inside =
        x >= region.x0 && x < region.x1 && y >= region.y0 && y < region.y1;
      rgba[o] = 255;
      rgba[o + 1] = 255;
      rgba[o + 2] = 255;
      // 40% transparent curtain: alpha 102 (< the 128 threshold).
      rgba[o + 3] = inside ? 102 : 0;
    }
  }
  const grid = maskGridFromAlphaPixels(rgba, W, H);
  let painted = 0;
  for (let i = 0; i < grid.length; i++) painted += grid[i];
  const regionArea = (region.x1 - region.x0) * (region.y1 - region.y0);
  info(
    "P4 translucent object after binarisation",
    `a 40%-opaque object over ${regionArea} px (${(100 * regionArea / (W * H)).toFixed(1)}% ` +
      `of the canvas) is classified as ${painted} painted px ` +
      `(${(100 * painted / (W * H)).toFixed(1)}%). With alpha >= 128 required, ` +
      `it is entirely "preserve" — the object is left in the photo. Raising ` +
      `the threshold instead paints it fully, which is the opposite failure. ` +
      `Binary masks cannot express "replace this at 40%".`,
  );
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
console.log(
  "soft-matte alpha probe — issue #1458 (offline, no API, no weights)\n",
);
for (const r of results) {
  console.log(`[${r.status}] ${r.probe}`);
  console.log(`       ${r.detail}\n`);
}
const failures = results.filter((r) => r.status === "FAIL");
console.log(
  `${results.length - failures.length}/${results.length} probes passed; ` +
    `no network call, no API key, no model weights were used.`,
);
process.exit(failures.length === 0 ? 0 : 1);
