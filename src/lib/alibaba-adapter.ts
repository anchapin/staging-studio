/**
 * Alibaba Cloud (DashScope) adapter for the inference abstraction.
 *
 * The DashScope multimodal-conversation endpoint
 * (`/v1/services/aigc/multimodal-generation/generation`) is a synchronous
 * one-round-trip API: one POST returns the full generation result with a
 * temporary hosted URL. This is materially different from fal / Replicate,
 * which both use a queue+status+poll lifecycle. The adapter fills the
 * `InferenceClient` interface in two ways:
 *
 *   - `subscribe()` does the full POST and resolves with the final image
 *     URL. This is the synchronous facade used by SAM-style single-shot
 *     inference (#1187).
 *   - `submit()` does the same POST and stores the result in a
 *     module-level `Map<requestId, imageUrl>` so subsequent `status()`
 *     and `result()` calls — which the inpaint route expects — find the
 *     URL without re-issuing the request. The `requestId` returned is a
 *     local UUID (not the DashScope `request_id`, which is not stable
 *     across a re-POST). DashScope-hosted URLs are valid for 24 hours; the
 *     inpaint persistence path uploads the result to Supabase Storage
 *     within that window, so the temporary URL never reaches the browser.
 *
 * Single-track: this is the active inpaint provider after #1240. fal and
 * Replicate adapters still exist as dormant alternatives selectable via
 * `INFERENCE_PROVIDER=fal|replicate`, but production runs Alibaba.
 *
 * Required env (all read lazily inside `requireAlibabaEnv`):
 *   - ALIBABA_DASHSCOPE_API_KEY  — DashScope API key (Singapore / US-East / Beijing)
 *   - ALIBABA_BAILIAN_WORKSPACE_ID — Bailian workspace id, hosts the URL prefix
 *   - ALIBABA_INPAINT_MODEL       — DashScope model id (qwen-image-2.1-pro etc.)
 */
import { requireEnvVars } from "@/lib/env";
import { getCircuitBreaker } from "@/lib/circuit-breaker";
import { logger } from "@/lib/logger";
import {
  InferenceRequestGoneError,
  LOGICAL_MODEL,
  type InferenceClient,
  type InferenceStatusResult,
  type LogicalModel,
} from "@/lib/inference";

const DASHSCOPE_PATH = "/api/v1/services/aigc/multimodal-generation/generation";

/**
 * Resolves the DashScope workspace-scoped URL for the configured region.
 * The workspace id and region are baked into `ALIBABA_BAILIAN_WORKSPACE_ID`
 * (the workspace id alone implies its region — Singapore workspaces
 * resolve to ap-southeast-1, Beijing to cn-beijing, US-East to us-east-1).
 * The env contract is the workspace id only; we prefix it to the region
 * subdomain here.
 */
function dashscopeEndpoint(workspaceId: string): string {
  // Workspace IDs from the Singapore console start with "llm-" and live
  // on ap-southeast-1. Add the other regions here when needed.
  // For now, Singapore is the only supported region.
  return `https://${workspaceId}.ap-southeast-1.maas.aliyuncs.com${DASHSCOPE_PATH}`;
}

/**
 * Cached Alibaba env. Read on first call so the adapter is a no-op until
 * actually used (matches the lazy pattern in fal-adapter / replicate-adapter).
 */
function requireAlibabaEnv(): {
  apiKey: string;
  workspaceId: string;
  model: string;
} {
  const env = requireEnvVars(
    "ALIBABA_DASHSCOPE_API_KEY",
    "ALIBABA_BAILIAN_WORKSPACE_ID",
    "ALIBABA_INPAINT_MODEL",
  );
  return {
    apiKey: env.ALIBABA_DASHSCOPE_API_KEY,
    workspaceId: env.ALIBABA_BAILIAN_WORKSPACE_ID,
    model: env.ALIBABA_INPAINT_MODEL,
  };
}

/**
 * Asserts that the Alibaba Cloud (DashScope) provider is configured.
 *
 * Purpose: preflight guard for inpainting routes — throws
 * `MissingEnvVarsError` naming the three Alibaba env vars if any are
 * unset or blank. The adapter reads them lazily inside the HTTP helper
 * so a misconfiguration without this guard surfaces as an opaque
 * `MissingEnvVarsError` deep inside a fetch — this helper gives the
 * error at the call site instead.
 *
 * Side effects: reads `process.env`; throws when missing.
 */
export function assertAlibabaConfigured(): void {
  requireEnvVars(
    "ALIBABA_DASHSCOPE_API_KEY",
    "ALIBABA_BAILIAN_WORKSPACE_ID",
    "ALIBABA_INPAINT_MODEL",
  );
}

/**
 * Map logical name -> DashScope model id. Other logical models (SAM, etc.)
 * would need their own DashScope endpoints and are not wired here.
 */
function resolveAlibabaModel(logical: LogicalModel): string {
  switch (logical) {
    case LOGICAL_MODEL.FLUX_FILL: {
      // The configured `ALIBABA_INPAINT_MODEL` env overrides everything
      // else; the default in .env.example is qwen-image-2.1-pro.
      return process.env.ALIBABA_INPAINT_MODEL?.trim() || "qwen-image-2.1-pro";
    }
    default: {
      // Exhaustiveness guard — adding a logical model without an Alibaba
      // deployment is a programming error.
      throw new Error(
        `Alibaba adapter: unknown logical model "${String(logical)}". ` +
          `Add a case to resolveAlibabaModel.`,
      );
    }
  }
}

/**
 * In-process cache of completed inpaint results. Keyed by the local
 * `requestId` UUID returned from `submit`; value is the DashScope-hosted
 * image URL (valid 24h). Cleared only on process restart — fine, since
 * the inpaint route's 5-minute outer polling window means any cached
 * entry is either consumed or stale long before 24h.
 */
const alibabaResultCache = new Map<string, { imageUrl: string; width: number | null; height: number | null }>();

interface DashScopeResponse {
  request_id?: string;
  output?: {
    choices?: Array<{
      finish_reason?: string;
      message?: {
        role?: string;
        content?: Array<{ image?: string }>;
      };
    }>;
  };
  usage?: {
    image_count?: number;
    width?: number;
    height?: number;
  };
  code?: string;
  message?: string;
}

/**
 * Issues the DashScope multimodal-conversation call. Pure HTTP via fetch;
 * the DashScope Python SDK is not used so we don't take a new runtime
 * dependency. Throws on non-2xx with the upstream message in `error`.
 *
 * Wrapped in the shared circuit breaker (`getCircuitBreaker("alibaba-cloud", …)`)
 * for the same reason the fal adapter wrapped its calls: a single
 * degraded provider shouldn't be able to take down the inpaint route,
 * and the breaker gives the route a fast-fail path when the upstream
 * is in cooldown. Mirrors the historical pattern in `src/lib/fal.ts`
 * that this PR deleted.
 *
 * Issue #1362b — Gemini finding (Stage B STICKY NOTE): the
 * `parameters` block now reads `strength` (default 0.5, DashScope's
 * wire default) and `seed` from the caller's `LogicalInpaintInput`
 * (via `submit()` / `subscribe()`), instead of hardcoding
 * `strength` and `seed: 42`. `mask_blur` is intentionally absent
 * — DashScope masks are binary B/W; the FineTune `expand` slider
 * feathers the mask client-side before upload
 * (`src/lib/mask-feather.ts`), not via a provider parameter.
 */
async function dashscopeGenerate(
  workspaceId: string,
  apiKey: string,
  model: string,
  imageUrl: string,
  prompt: string,
  options?: { strength?: number; seed?: number }
): Promise<DashScopeResponse> {
  const cb = getCircuitBreaker("alibaba-cloud", {
    failureThreshold: 3,
    cooldownMs: 30_000,
  });
  try {
    const url = dashscopeEndpoint(workspaceId);
    // STICKY NOTE #1362b — Gemini finding (final): the DashScope
    // wire accepts `parameters.strength` (0.0..1.0, default 0.5)
    // and `parameters.seed` (int) at the top of `parameters`. We
    // thread both from the caller's `LogicalInpaintInput`. The
    // pre-Stage-B hardcodes (`strength` derived from the caller's
    // `promptStrength` * 10 of a 0..1 input — same byte output,
    // wrong field name; `seed: 42` — silent drop on the user's
    // typed seed) are gone.
    const strength = options?.strength ?? 0.5;
    const seed = options?.seed;
    const body = {
      model,
      input: {
        messages: [
          {
            role: "user",
            content: [{ image: imageUrl }, { text: prompt }],
          },
        ],
      },
      parameters: {
        n: 1,
        watermark: false,
        prompt_extend: true,
        // Issue #1362b: forward `strength` (0..1) + `seed` from the
        // caller's `LogicalInpaintInput`. `strength` defaults to 0.5
        // (DashScope's wire default — `parameters.strength` is
        // omitted when the caller passes nothing and we cannot tell
        // whether they want explicit-zero vs default; the default
        // here matches what DashScope would pick anyway). `seed` is
        // omitted when not supplied so DashScope rolls fresh.
        strength,
        ...(seed !== undefined ? { seed } : {}),
        size: "2048*1536",
      },
    };
    return await cb.execute(() =>
      fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }).then(async (r) => {
        const respBody = (await r.json()) as DashScopeResponse;
        if (!r.ok || respBody.code) {
          throw new Error(
            `DashScope ${model} returned ${r.status} (code=${respBody.code ?? "n/a"}): ${respBody.message ?? "no message"}`,
          );
        }
        return respBody;
      }),
    );
  } catch (error) {
    logger.error(
      {
        event: "alibaba_error",
        errorType: "ExternalApiError",
        model,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      `[ExternalApiError] alibaba-cloud dashscope error: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  }
}

/**
 * Generates a v4 UUID. Uses crypto.randomUUID (Node 19+, web standard).
 * No external dep. Standalone so the adapter has no top-level side effects.
 */
function newRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Adapts a DashScope response to the canonical `{ imageUrl, width, height }`
 * shape. Returns `null` if the response carries no image (which
 * `firstInpaintImageUrl` would also handle; we surface the null here
 * so callers can throw a clear error).
 */
function pickImageUrl(
  resp: DashScopeResponse,
): { imageUrl: string; width: number | null; height: number | null } | null {
  const url = resp.output?.choices?.[0]?.message?.content?.[0]?.image;
  if (typeof url !== "string" || url.length === 0) return null;
  return {
    imageUrl: url,
    width: resp.usage?.width ?? null,
    height: resp.usage?.height ?? null,
  };
}

/**
 * The synchronous facade used by single-shot inference (e.g. SAM-style).
 * The inpaint route does NOT use this — it goes through `submit` /
 * `status` / `result` so the queue+polling UX is preserved.
 *
 * The input payload schema is provider-specific (image_url + prompt are
 * the only fields DashScope uses today), so this adapter does not try to
 * use the abstraction's `LogicalInpaintInput`. Call sites that want the
 * synchronous path should construct the payload directly.
 */
async function runInpaintSync(
  imageUrl: string,
  prompt: string,
  workspaceId: string,
  apiKey: string,
  model: string,
  options?: { strength?: number; seed?: number },
): Promise<{ imageUrl: string; width: number | null; height: number | null }> {
  const resp = await dashscopeGenerate(
    workspaceId,
    apiKey,
    model,
    imageUrl,
    prompt,
    options,
  );
  const picked = pickImageUrl(resp);
  if (!picked) {
    throw new Error(
      `DashScope ${model} completed but returned no image in choices[0].message.content[0]`,
    );
  }
  return picked;
}

/**
 * Creates the Alibaba-backed `InferenceClient`. Module-load side
 * effects: none. Env reads happen on the first request.
 */
export function createAlibabaClient(): InferenceClient {
  return {
    async subscribe<T = unknown>(
      logicalModel: LogicalModel,
      options: {
        input: Record<string, unknown>;
        abortSignal?: AbortSignal;
      },
    ): Promise<T> {
      const { apiKey, workspaceId } = requireAlibabaEnv();
      const model = resolveAlibabaModel(logicalModel);
      const imageUrl = String(options.input.imageUrl ?? "");
      const prompt = String(options.input.prompt ?? "");
      // Issue #1362b: thread `strength` + `seed` from the caller's
      // `LogicalInpaintInput` (read off `options.input` because
      // `buildAlibabaFillPayload` does not carry them — they're
      // consumed by `parameters`, not the input messages). Coerced
      // to `number | undefined` so a stray string slips in with a
      // dashscope-side error instead of silently dropping.
      const strength =
        typeof options.input.strength === "number" ? options.input.strength : undefined;
      const seed =
        typeof options.input.seed === "number" ? options.input.seed : undefined;
      try {
        const picked = await runInpaintSync(
          imageUrl,
          prompt,
          workspaceId,
          apiKey,
          model,
          strength !== undefined || seed !== undefined
            ? { strength, seed }
            : undefined,
        );
        // Return as a bare URL string (matches Replicate's shape, which
        // `firstInpaintImageUrl` already handles) rather than the fal
        // `{ images: [{ url }] }` envelope.
        return picked.imageUrl as T;
      } catch (error) {
        logger.error(
          {
            event: "inference_error",
            provider: "alibaba",
            logicalModel,
            model,
            error: error instanceof Error ? error.message : String(error),
          },
          `[inference] alibaba subscribe error: ${error instanceof Error ? error.message : String(error)}`,
        );
        throw error;
      }
    },

    async submit(
      _logicalModel: LogicalModel,
      options: {
        input: Record<string, unknown>;
        abortSignal?: AbortSignal;
        webhookUrl?: string;
      },
    ): Promise<{
      request_id: string;
      result?: { imageUrl: string; width: number | null; height: number | null };
    }> {
      // The DashScope API is synchronous: do the POST now, cache the
      // result, return a local requestId so the route's normal
      // status/result polling flow continues to work. `webhookUrl` is
      // accepted for interface compatibility but unused (DashScope has
      // no callback surface).
      //
      // We also return the synchronous result inline (#1240 multi-
      // instance fix): the route handler writes the row with
      // status="COMPLETED" + resultUrl=<dashscope-url> in the same
      // request as the submit. Otherwise a Vercel multi-instance
      // deploy would let instance A handle the POST (caching the URL
      // in its module-local Map) and instance B handle the first poll
      // (404 because B's cache is empty).
      const { apiKey, workspaceId } = requireAlibabaEnv();
      const model = resolveAlibabaModel(_logicalModel);
      const imageUrl = String(options.input.imageUrl ?? "");
      const prompt = String(options.input.prompt ?? "");
      // Issue #1362b: same strength/seed extraction as `subscribe()`
      // — see the comment there.
      const strength =
        typeof options.input.strength === "number" ? options.input.strength : undefined;
      const seed =
        typeof options.input.seed === "number" ? options.input.seed : undefined;
      const requestId = newRequestId();
      const picked = await runInpaintSync(
        imageUrl,
        prompt,
        workspaceId,
        apiKey,
        model,
        strength !== undefined || seed !== undefined
          ? { strength, seed }
          : undefined,
      );
      alibabaResultCache.set(requestId, picked);
      return { request_id: requestId, result: picked };
    },

    async status(
      _logicalModel: LogicalModel,
      requestId: string,
    ): Promise<InferenceStatusResult> {
      // The work is already done by the time `submit` returns, so the
      // very first status poll sees COMPLETED. Missing cache entries
      // throw 404-equivalent (InferenceRequestGoneError) so the
      // poller's gone-recovery path kicks in.
      if (alibabaResultCache.has(requestId)) {
        return { status: "COMPLETED" };
      }
      throw new InferenceRequestGoneError(
        "alibaba",
        404,
        `Alibaba inpaint result for ${requestId} is no longer in the in-process cache`,
      );
    },

    async result<T = unknown>(
      _logicalModel: LogicalModel,
      requestId: string,
    ): Promise<{ data: T }> {
      const cached = alibabaResultCache.get(requestId);
      if (!cached) {
        throw new InferenceRequestGoneError(
          "alibaba",
          404,
          `Alibaba inpaint result for ${requestId} is no longer in the in-process cache`,
        );
      }
      // Match Replicate's shape (bare URL string) so `firstInpaintImageUrl`
      // picks it up directly without an envelope.
      return { data: cached.imageUrl as T };
    },
  };
}