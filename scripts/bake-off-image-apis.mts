/**
 * Ranked bake-off of latest image-editing APIs vs the incumbent FLUX.1 Fill pipeline.
 * Issue #1240. Read-only for app code: writes nothing outside ./bake-off/.
 *
 * Usage:
 *   FAL_KEY=... OPENAI_API_KEY=... npm run bake-off
 *   (OPENAI_API_KEY only required if a slot has vendor=openai)
 *
 * Design:
 *  - Slots are DATA in scripts/bake-off-slots.json, not code: each slot names its
 *    vendor, model id, input mode (mask+fill vs instruction), and endpoint.
 *  - Two vendor dispatchers: fal (queue.fal.run + /v1/models/pricing) and
 *    openai (api.openai.com/v1/images/edits, JSON body with URL inputs).
 *  - For OpenAI, our black-rect-on-white masks are inverted to alpha-based
 *    (transparent = edit) via scripts/bake-off-mask-invert.mts.
 *  - Incumbent slot (flux-pro-fill) always runs so every other result is scored
 *    against the same case set on the same day.
 *  - Results go to bake-off/bake-off-results.json for the table Alex signs off on.
 */
import fs from "node:fs";
import path from "node:path";
import { invertFalMaskToOpenAIDataUrl } from "./bake-off-mask-invert.mts";

const BAKE_OFF_DIR = path.resolve(process.cwd(), "bake-off");
const CASES = ["vacant-insert", "occupied-replace", "repeat-stability"];

interface SlotInputShape {
  imageField?: string;
  imageIsArray?: boolean;
  maskField?: string;
  extraFields?: Record<string, string>;
}

interface Slot {
  id: string;
  vendor: "fal" | "openai";
  falModelId: string | null;
  mode: "mask-fill" | "instruction" | "text-to-image";
  expectedEndpoint: string;
  inputShape?: SlotInputShape;
  notes?: string;
}

interface PricingRow {
  endpoint_id: string;
  unit_price: number;
  unit: string;
  currency: string;
}

interface FalRunResult {
  status: string;
  body: Record<string, unknown> | null;
  errorDetail?: string;
}

function requireKey(name: string): string {
  const key = process.env[name];
  if (!key) {
    console.error(
      `${name} is missing. Set it in your shell or .env.local; never paste it in chat.`,
    );
    process.exit(1);
  }
  return key;
}

async function falQueueRun(
  model: string,
  input: Record<string, unknown>,
  key: string,
): Promise<FalRunResult> {
  const submit = await fetch(`https://queue.fal.run/${model}`, {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!submit.ok) {
    throw new Error(`submit ${submit.status}: ${await submit.text()}`);
  }
  const { status_url, response_url } = (await submit.json()) as {
    status_url: string;
    response_url: string;
  };
  let finalStatus = "IN_QUEUE";
  for (let i = 0; i < 150; i++) {
    const poll = await fetch(status_url, {
      headers: { Authorization: `Key ${key}` },
    });
    const { status } = (await poll.json()) as { status: string };
    finalStatus = status;
    if (status === "COMPLETED") break;
    if (status === "FAILED") {
      const failBody = await poll.text();
      throw new Error(`provider reported FAILED: ${failBody}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (finalStatus !== "COMPLETED") {
    throw new Error(`timeout: final status ${finalStatus}`);
  }
  const res = await fetch(response_url, {
    headers: { Authorization: `Key ${key}` },
  });
  const body = (await res.json()) as Record<string, unknown>;
  if (Array.isArray((body as { detail?: unknown }).detail)) {
    return {
      status: finalStatus,
      body: null,
      errorDetail: JSON.stringify((body as { detail: unknown }).detail),
    };
  }
  return { status: finalStatus, body };
}

interface OpenAiRunResult {
  status: string;
  body: Record<string, unknown> | null;
  errorDetail?: string;
}

async function openAiEdit(
  payload: Record<string, unknown>,
  key: string,
): Promise<OpenAiRunResult> {
  const r = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const body = (await r.json()) as Record<string, unknown>;
  if (!r.ok) {
    return {
      status: r.status.toString(),
      body: null,
      errorDetail: JSON.stringify((body as { error?: unknown }).error ?? body),
    };
  }
  return { status: r.status.toString(), body };
}

async function fetchFalPricing(
  endpointIds: string[],
  key: string,
): Promise<Map<string, PricingRow>> {
  const map = new Map<string, PricingRow>();
  for (const id of endpointIds) {
    try {
      const r = await fetch(
        `https://api.fal.ai/v1/models/pricing?endpoint_id=${encodeURIComponent(id)}`,
        { headers: { Authorization: `Key ${key}` } },
      );
      if (!r.ok) {
        console.warn(`pricing lookup failed for ${id}: ${r.status}`);
        continue;
      }
      const body = (await r.json()) as { prices?: PricingRow[] };
      const row = body.prices?.find((p) => p.endpoint_id === id);
      if (row) map.set(id, row);
    } catch (err) {
      console.warn(`pricing lookup errored for ${id}: ${String(err)}`);
    }
  }
  return map;
}

function buildFalInput(
  slot: Slot,
  caseInput: { prompt?: string; imageUrl?: string; maskUrl?: string | null },
): Record<string, unknown> {
  const input: Record<string, unknown> = { prompt: caseInput.prompt ?? "" };
  const shape = slot.inputShape ?? {};
  const imageField = shape.imageField ?? (slot.mode === "instruction" ? "image_urls" : "image_url");
  const imageIsArray = shape.imageIsArray ?? (imageField === "image_urls");
  const maskField = shape.maskField ?? "mask_url";

  if (caseInput.imageUrl) {
    if (imageIsArray) {
      input[imageField] = [caseInput.imageUrl];
    } else {
      input[imageField] = caseInput.imageUrl;
    }
  }
  if (slot.mode === "mask-fill" && caseInput.maskUrl) {
    input[maskField] = caseInput.maskUrl;
  }
  if (shape.extraFields) {
    for (const [k, v] of Object.entries(shape.extraFields)) {
      // $imageUrl / $maskUrl placeholders are resolved against the current
      // case input so per-slot defaults can reference the source image or
      // mask rather than hard-coding a stock example URL.
      let resolved: unknown = v;
      if (v === "$imageUrl") resolved = caseInput.imageUrl;
      else if (v === "$maskUrl") resolved = caseInput.maskUrl;
      input[k] = resolved;
    }
  }
  return input;
}

async function buildOpenAiInput(
  slot: Slot,
  caseInput: { prompt?: string; imageUrl?: string; maskUrl?: string | null },
): Promise<Record<string, unknown>> {
  // input_fidelity is supported by gpt-image-1 / 1.5 only; gpt-image-2.5 rejects
  // it explicitly. See scripts/bake-off-results.json entry from the first
  // attempt ("invalid_input_fidelity_model").
  const input: Record<string, unknown> = {
    model: "gpt-image-2.5-sunburst",
    prompt: caseInput.prompt ?? "",
    quality: "high",
  };
  if (caseInput.imageUrl) {
    input.images = [{ image_url: caseInput.imageUrl }];
  }
  if (slot.mode === "mask-fill" && caseInput.maskUrl) {
    input.mask = { image_url: await invertFalMaskToOpenAIDataUrl(caseInput.maskUrl) };
  }
  return input;
}

function readCase(cs: string): { prompt?: string; imageUrl?: string; maskUrl?: string | null } {
  return JSON.parse(fs.readFileSync(path.join(BAKE_OFF_DIR, `${cs}.json`), "utf8"));
}

async function main() {
  const slots: Slot[] = JSON.parse(
    fs.readFileSync("scripts/bake-off-slots.json", "utf8"),
  );
  fs.mkdirSync(BAKE_OFF_DIR, { recursive: true });
  fs.mkdirSync(path.join(BAKE_OFF_DIR, "outputs"), { recursive: true });

  // Idempotent re-run: load prior results, drop failed rows whose slot is in
  // the current slots list (so failures get overwritten on retry), and skip
  // slots that already have successful results so we don't bill twice.
  const resultsPath = path.join(BAKE_OFF_DIR, "bake-off-results.json");
  let existingResults: Array<Record<string, unknown>> = [];
  if (fs.existsSync(resultsPath)) {
    try {
      existingResults = JSON.parse(fs.readFileSync(resultsPath, "utf8"));
    } catch {
      // Treat a corrupt prior file as empty rather than failing the run.
    }
  }
  const activeSlotIds = new Set(slots.map((s) => s.id));
  const slotHasSuccess = new Set<string>();
  for (const r of existingResults) {
    if (r.ok && activeSlotIds.has(String(r.slot))) {
      slotHasSuccess.add(String(r.slot));
    }
  }
  // Keep rows that are either (a) successful OR (b) for a slot not in the
  // current list (e.g. a slot that was removed from slots.json). Drop rows
  // that are failed AND for a slot that's still in the list — those get
  // overwritten by the new run.
  const survivingResults = existingResults.filter((r) => {
    const id = String(r.slot);
    if (!activeSlotIds.has(id)) return true; // legacy, keep
    if (r.ok) return true; // success, keep
    return false; // failed and being retried, drop
  });
  const newSlots = slots.filter((s) => !slotHasSuccess.has(s.id));
  if (newSlots.length === 0) {
    console.log("all slots already have successful results; nothing to do");
    return;
  }

  // Only require keys we actually need.
  const falSlots = newSlots.filter((s) => s.vendor === "fal");
  const openAiSlots = newSlots.filter((s) => s.vendor === "openai");
  const falKey = falSlots.length ? requireKey("FAL_KEY") : "";
  const openAiKey = openAiSlots.length ? requireKey("OPENAI_API_KEY") : "";

  // Pre-cache pricing for fal endpoints only.
  const pricing = await fetchFalPricing(
    falSlots.map((s) => s.expectedEndpoint),
    falKey,
  );

  const results: Array<Record<string, unknown>> = [];
  for (const slot of newSlots) {
    for (const cs of CASES) {
      const caseInput = readCase(cs);
      const started = Date.now();
      try {
        if (slot.vendor === "fal") {
          const input = buildFalInput(slot, caseInput);
          const { status, body, errorDetail } = await falQueueRun(
            slot.expectedEndpoint,
            input,
            falKey,
          );
          if (!body) {
            results.push({
              slot: slot.id,
              vendor: slot.vendor,
              case: cs,
              ok: false,
              latency_ms: Date.now() - started,
              error: `provider returned validation error: ${errorDetail ?? "(no detail)"}`,
            });
            continue;
          }
          const images = (body as { images?: Array<{ url: string; width?: number; height?: number }> }).images;
          const firstImage = images?.[0];
          results.push({
            slot: slot.id,
            vendor: slot.vendor,
            case: cs,
            ok: true,
            latency_ms: Date.now() - started,
            unit_price_usd: pricing.get(slot.expectedEndpoint)?.unit_price ?? null,
            billing_unit: pricing.get(slot.expectedEndpoint)?.unit ?? null,
            output: firstImage?.url ?? null,
            output_dimensions:
              firstImage?.width && firstImage?.height
                ? `${firstImage.width}x${firstImage.height}`
                : null,
            queue_status: status,
          });
        } else if (slot.vendor === "openai") {
          const input = await buildOpenAiInput(slot, caseInput);
          const { status, body, errorDetail } = await openAiEdit(input, openAiKey);
          if (!body) {
            results.push({
              slot: slot.id,
              vendor: slot.vendor,
              case: cs,
              ok: false,
              latency_ms: Date.now() - started,
              error: `OpenAI returned error: ${errorDetail ?? "(no detail)"}`,
            });
            continue;
          }
          const data = (body as { data?: Array<{ b64_json?: string }> }).data ?? [];
          const firstImage = data[0];
          if (!firstImage?.b64_json) {
            results.push({
              slot: slot.id,
              vendor: slot.vendor,
              case: cs,
              ok: false,
              latency_ms: Date.now() - started,
              error: "OpenAI returned no b64_json in data[0]",
            });
            continue;
          }
          // Save locally so reviewers can open it without a hosted URL expiring.
          const buf = Buffer.from(firstImage.b64_json, "base64");
          const ext = "png";
          const filename = `${slot.id}__${cs}__${Date.now() - started}ms.${ext}`;
          const dest = path.join(BAKE_OFF_DIR, "outputs", filename);
          fs.writeFileSync(dest, buf);
          const usage = body.usage as
            | { input_tokens?: number; output_tokens?: number; total_tokens?: number }
            | undefined;
          results.push({
            slot: slot.id,
            vendor: slot.vendor,
            case: cs,
            ok: true,
            latency_ms: Date.now() - started,
            input_tokens: usage?.input_tokens ?? null,
            output_tokens: usage?.output_tokens ?? null,
            total_tokens: usage?.total_tokens ?? null,
            output: `bake-off/outputs/${filename}`,
            output_dimensions: null, // OpenAI doesn't return dimensions in the response
            http_status: status,
          });
        } else {
          throw new Error(`unknown vendor: ${(slot as { vendor: string }).vendor}`);
        }
      } catch (err) {
        results.push({
          slot: slot.id,
          vendor: slot.vendor,
          case: cs,
          ok: false,
          latency_ms: Date.now() - started,
          error: String(err),
        });
      }
    }
  }
  const merged = [...survivingResults, ...results];
  fs.writeFileSync(
    resultsPath,
    JSON.stringify(merged, null, 2),
  );
  console.log(
    `wrote ${results.length} new rows (${merged.length} total) to bake-off/bake-off-results.json`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});