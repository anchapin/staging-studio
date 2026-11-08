/**
 * OpenAI GPT-Image adapter for the inference abstraction (issue #1506,
 * implementing the #1502 / #1504 spike recommendations — see
 * docs/gpt-image-2-6-evaluation.md and
 * docs/gpt-image-2-6-integration-spike.md).
 *
 * The GPT Image edits endpoint (`POST /v1/images/edits`) is a
 * synchronous one-round-trip API like DashScope's, so this adapter
 * mirrors the alibaba-adapter's shape: `submit()` performs the call,
 * caches the result under a local UUID, and returns it inline so the
 * inpaint route can write COMPLETED + resultUrl in the same request;
 * `status()` / `result()` serve from that cache.
 *
 * Differences from Alibaba that shape this file:
 *
 *   - The endpoint takes multipart form data with the actual image and
 *     mask BYTES (not URLs), so the adapter fetches both first.
 *   - The mask must be re-encoded as an opaque RGB guidance image
 *     (black = edit, alpha 255 everywhere) via gpt-image-mask.ts —
 *     alpha-varying masks are composited into GPT Image's output and
 *     flatten to black (the #1502 correction).
 *   - The response carries base64 PNG bytes, not a hosted URL, so the
 *     adapter re-hosts the final PNG to the `staging-images` bucket at
 *     the same `after-<requestId>.png` path persistInpaintImage uses,
 *     and returns the public URL as the sync result.
 *   - Output size is pinned to 1536x1024: #1504 measured that
 *     2048x1536 is honored by the API but worsens outside-mask
 *     preservation (mean Δ 28.7 vs 13.1 on the same case).
 *
 * Optional compositing: when OPENAI_INPAINT_COMPOSITE=whole-object,
 * the model output is composited inside the feathered mask over the
 * source photo (PNG sources only), making the outside region
 * pixel-identical to the source. #1504 showed object-crossing mask
 * boundaries ghost under compositing, so this stays OFF unless an
 * operator asserts the whole-object condition; threading mask origin
 * from the client dispatch seam is the tracked follow-up.
 *
 * Required env (read lazily):
 *   - OPENAI_API_KEY       — shared with lib/ai.ts (copy generation)
 * Optional env:
 *   - OPENAI_INPAINT_MODEL — default "gpt-image-2.6-flare"
 *     ("gpt-image-2.6-sunburst" for multi-round consistency work)
 *   - OPENAI_INPAINT_COMPOSITE — "whole-object" enables compositing
 */
import { PNG } from "pngjs";

import { getCircuitBreaker } from "@/lib/circuit-breaker";
import { requireEnvVars } from "@/lib/env";
import {
  compositeEditedRegion,
  guidanceMaskPixels,
  resizeRgbaBilinear,
} from "@/lib/gpt-image-mask";
import {
  InferenceRequestGoneError,
  LOGICAL_MODEL,
  type InferenceCancelResult,
  type InferenceClient,
  type InferenceStatusResult,
  type LogicalModel,
} from "@/lib/inference";
import { logger } from "@/lib/logger";
import { maskGridFromProviderPixels } from "@/lib/mask-format";
import { createSupabaseRequestClient } from "@/lib/supabase";

const EDITS_URL = "https://api.openai.com/v1/images/edits";
const OUTPUT_SIZE = "1536x1024";
const DEFAULT_MODEL = "gpt-image-2.6-flare";

/** Reads the OpenAI env lazily (adapter is a no-op until used). */
function requireOpenAiEnv(): { apiKey: string; model: string } {
  const env = requireEnvVars("OPENAI_API_KEY");
  return {
    apiKey: env["OPENAI_API_KEY"],
    model: process.env.OPENAI_INPAINT_MODEL?.trim() || DEFAULT_MODEL,
  };
}

/** Asserts the OpenAI provider is configured. Side effects: reads process.env; throws when missing. */
export function assertOpenAiConfigured(): void {
  requireEnvVars("OPENAI_API_KEY");
}

function resolveOpenAiModel(logical: LogicalModel): string {
  switch (logical) {
    case LOGICAL_MODEL.FLUX_FILL:
      return process.env.OPENAI_INPAINT_MODEL?.trim() || DEFAULT_MODEL;
    default:
      throw new Error(
        `OpenAI adapter: unknown logical model "${String(logical)}". ` +
          `Add a case to resolveOpenAiModel.`,
      );
  }
}

const openAiResultCache = new Map<
  string,
  { imageUrl: string; width: number | null; height: number | null }
>();

function newRequestId(): string {
  return crypto.randomUUID();
}

async function fetchBytes(
  url: string,
): Promise<{ bytes: Buffer; contentType: string }> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Fetching ${url} returned ${r.status}`);
  return {
    bytes: Buffer.from(await r.arrayBuffer()),
    contentType: r.headers.get("content-type") ?? "application/octet-stream",
  };
}

/** Encodes the dispatched mask (either provider format) as an opaque-RGB guidance PNG. */
export function buildGuidanceMaskPng(maskPngBytes: Buffer): Buffer {
  const mask = PNG.sync.read(maskPngBytes);
  const pixels = guidanceMaskPixels(mask.data, mask.width, mask.height);
  const out = new PNG({ width: mask.width, height: mask.height });
  out.data = Buffer.from(pixels);
  return PNG.sync.write(out);
}

interface OpenAiEditResponse {
  data?: Array<{ b64_json?: string }>;
  error?: { message?: string };
}

/** Issues the GPT Image edits call (multipart, bytes in, base64 out). Circuit-breaker wrapped like the other adapters. */
async function openAiEdit(
  apiKey: string,
  model: string,
  image: { bytes: Buffer; contentType: string },
  guidanceMaskPng: Buffer,
  prompt: string,
): Promise<Buffer> {
  const cb = getCircuitBreaker("openai", {
    failureThreshold: 3,
    cooldownMs: 30_000,
  });
  try {
    return await cb.execute(async () => {
      const form = new FormData();
      form.append("model", model);
      form.append("prompt", prompt);
      form.append("quality", "medium");
      form.append("size", OUTPUT_SIZE);
      form.append("n", "1");
      const imageName = image.contentType.includes("png")
        ? "image.png"
        : "image.jpg";
      form.append(
        "image",
        new Blob([new Uint8Array(image.bytes)], { type: image.contentType }),
        imageName,
      );
      form.append(
        "mask",
        new Blob([new Uint8Array(guidanceMaskPng)], { type: "image/png" }),
        "mask.png",
      );
      const r = await fetch(EDITS_URL, {
        method: "POST",
        headers: { Authorization: "Bearer " + apiKey },
        body: form,
      });
      const payload = (await r.json()) as OpenAiEditResponse;
      if (!r.ok) {
        throw new Error(
          `OpenAI ${model} returned ${r.status}: ${payload.error?.message ?? "no message"}`,
        );
      }
      const b64 = payload.data?.[0]?.b64_json;
      if (!b64) {
        throw new Error(`OpenAI ${model} completed but returned no image`);
      }
      return Buffer.from(b64, "base64");
    });
  } catch (error) {
    logger.error(
      {
        event: "openai_error",
        errorType: "ExternalApiError",
        model,
        error: error instanceof Error ? error.message : String(error),
      },
      `[ExternalApiError] openai gpt-image error: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  }
}

/**
 * Applies the optional whole-object composite. Returns the final PNG
 * bytes: the composited image when the gate is on and the source is a
 * PNG, otherwise the model output unchanged.
 */
function maybeComposite(
  resultPngBytes: Buffer,
  source: { bytes: Buffer; contentType: string },
  maskPngBytes: Buffer,
): Buffer {
  if (process.env.OPENAI_INPAINT_COMPOSITE?.trim() !== "whole-object") {
    return resultPngBytes;
  }
  if (!source.contentType.includes("png")) return resultPngBytes;
  const src = PNG.sync.read(source.bytes);
  const gen = PNG.sync.read(resultPngBytes);
  const mask = PNG.sync.read(maskPngBytes);
  if (mask.width !== src.width || mask.height !== src.height) {
    return resultPngBytes;
  }
  const grid = maskGridFromProviderPixels(mask.data, mask.width, mask.height);
  const resized = resizeRgbaBilinear(
    gen.data,
    gen.width,
    gen.height,
    src.width,
    src.height,
  );
  const composited = compositeEditedRegion(
    src.data,
    resized,
    grid,
    src.width,
    src.height,
  );
  const out = new PNG({ width: src.width, height: src.height });
  out.data = Buffer.from(composited);
  return PNG.sync.write(out);
}

/** Re-hosts the final PNG in the staging-images bucket (persistInpaintImage's convention) and returns its public URL. */
async function uploadResultPng(
  requestId: string,
  pngBytes: Buffer,
): Promise<{ imageUrl: string; width: number | null; height: number | null }> {
  const supabase = await createSupabaseRequestClient();
  const objectPath = `after-${requestId}.png`;
  const { error: uploadError } = await supabase.storage
    .from("staging-images")
    .upload(objectPath, new Blob([new Uint8Array(pngBytes)], { type: "image/png" }), {
      contentType: "image/png",
      upsert: true,
    });
  if (uploadError) {
    throw new Error(`OpenAI result upload failed: ${uploadError.message}`);
  }
  const { data } = supabase.storage
    .from("staging-images")
    .getPublicUrl(objectPath);
  if (!data?.publicUrl) {
    throw new Error("OpenAI result upload produced no public URL");
  }
  let width: number | null = null;
  let height: number | null = null;
  try {
    const parsed = PNG.sync.read(pngBytes);
    width = parsed.width;
    height = parsed.height;
  } catch {
    // Dimensions are informational; a parse hiccup must not fail the run.
  }
  return { imageUrl: data.publicUrl, width, height };
}

async function runInpaintSync(
  requestId: string,
  imageUrl: string,
  maskUrl: string,
  prompt: string,
  apiKey: string,
  model: string,
): Promise<{ imageUrl: string; width: number | null; height: number | null }> {
  const [image, mask] = await Promise.all([
    fetchBytes(imageUrl),
    fetchBytes(maskUrl),
  ]);
  const guidance = buildGuidanceMaskPng(mask.bytes);
  const rawResult = await openAiEdit(apiKey, model, image, guidance, prompt);
  const finalPng = maybeComposite(rawResult, image, mask.bytes);
  return uploadResultPng(requestId, finalPng);
}

/** Creates the OpenAI-backed `InferenceClient`. Env reads happen on the first request. */
export function createOpenAiClient(): InferenceClient {
  return {
    async subscribe<T = unknown>(
      logicalModel: LogicalModel,
      options: { input: Record<string, unknown>; abortSignal?: AbortSignal },
    ): Promise<T> {
      const { apiKey } = requireOpenAiEnv();
      const model = resolveOpenAiModel(logicalModel);
      const requestId = newRequestId();
      try {
        const picked = await runInpaintSync(
          requestId,
          String(options.input.imageUrl ?? ""),
          String(options.input.maskUrl ?? ""),
          String(options.input.prompt ?? ""),
          apiKey,
          model,
        );
        return picked.imageUrl as T;
      } catch (error) {
        logger.error(
          {
            event: "inference_error",
            provider: "openai",
            logicalModel,
            model,
            error: error instanceof Error ? error.message : String(error),
          },
          `[inference] openai subscribe error: ${error instanceof Error ? error.message : String(error)}`,
        );
        throw error;
      }
    },

    async submit(
      logicalModel: LogicalModel,
      options: {
        input: Record<string, unknown>;
        abortSignal?: AbortSignal;
        webhookUrl?: string;
      },
    ): Promise<{
      request_id: string;
      result?: { imageUrl: string; width: number | null; height: number | null };
    }> {
      // Synchronous API: do the POST now, cache the result, and return
      // it inline so the route writes COMPLETED + resultUrl in the same
      // request (the #1240 multi-instance discipline).
      const { apiKey } = requireOpenAiEnv();
      const model = resolveOpenAiModel(logicalModel);
      const requestId = newRequestId();
      const picked = await runInpaintSync(
        requestId,
        String(options.input.imageUrl ?? ""),
        String(options.input.maskUrl ?? ""),
        String(options.input.prompt ?? ""),
        apiKey,
        model,
      );
      openAiResultCache.set(requestId, picked);
      return { request_id: requestId, result: picked };
    },

    async status(
      _logicalModel: LogicalModel,
      requestId: string,
    ): Promise<InferenceStatusResult> {
      if (openAiResultCache.has(requestId)) return { status: "COMPLETED" };
      throw new InferenceRequestGoneError(
        "openai",
        404,
        `OpenAI inpaint result for ${requestId} is no longer in the in-process cache`,
      );
    },

    /**
     * Issue #1421 cancel path: the edits endpoint is synchronous — the
     * POST has already returned and been billed by the time submit()
     * resolves, and there is no job id or cancel endpoint. Drop the
     * local cache entry and report cancelled: false so the caller
     * records the cost as a known write-off (same as Alibaba).
     */
    async cancel(
      _logicalModel: LogicalModel,
      requestId: string,
    ): Promise<InferenceCancelResult> {
      const evicted = openAiResultCache.delete(requestId);
      return {
        cancelled: false,
        reason:
          "openai_synchronous_api_has_no_cancel_endpoint" +
          (evicted ? " (local result cache evicted)" : ""),
      };
    },

    async result<T = unknown>(
      _logicalModel: LogicalModel,
      requestId: string,
    ): Promise<{ data: T }> {
      const cached = openAiResultCache.get(requestId);
      if (!cached) {
        throw new InferenceRequestGoneError(
          "openai",
          404,
          `OpenAI inpaint result for ${requestId} is no longer in the in-process cache`,
        );
      }
      return { data: cached.imageUrl as T };
    },
  };
}
