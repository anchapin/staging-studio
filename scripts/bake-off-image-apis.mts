/**
 * Ranked bake-off of latest image-editing APIs vs the incumbent FLUX.1 Fill pipeline.
 * Issue #1240. Read-only for app code: writes nothing outside ./bake-off/.
 *
 * Usage:  FAL_KEY=... npm run bake-off   (fails fast when FAL_KEY is missing)
 *
 * Design:
 *  - Slots are DATA in scripts/bake-off-slots.json, not code: each slot names its
 *    fal model id, input mode (mask+fill vs instruction) and expected endpoint.
 *    Verify each slot against fal's model page (catalog + price) before the paid
 *    run; endpoints are merchant copy, not verified API surface.
 *  - Incumbent slot (flux-pro-fill) always runs so every other result is scored
 *    against the same case set on the same day.
 *  - Results go to bake-off/bake-off-results.json for the table Alex signs off on.
 */
import fs from "node:fs";
import path from "node:path";

const BAKE_OFF_DIR = path.resolve(process.cwd(), "bake-off");
const CASES = ["vacant-insert", "occupied-replace", "repeat-stability"];

interface Slot {
  id: string;
  falModelId: string;
  mode: "mask-fill" | "instruction";
  expectedEndpoint: string;
  notes?: string;
}

interface PricingRow {
  endpoint_id: string;
  unit_price: number;
  unit: string;
  currency: string;
}

function requireFalKey(): string {
  const key = process.env.FAL_KEY;
  if (!key) {
    console.error(
      "FAL_KEY is missing. Set it in your shell (deployment env) or .env.local; never paste it in chat.",
    );
    process.exit(1);
  }
  return key;
}

async function falQueueRun(model: string, input: Record<string, unknown>, key: string) {
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
  for (let i = 0; i < 120; i++) {
    const poll = await fetch(status_url, { headers: { Authorization: `Key ${key}` } });
    const { status } = (await poll.json()) as { status: string };
    if (status === "COMPLETED") break;
    if (status === "FAILED") throw new Error("provider reported FAILED");
    await new Promise((r) => setTimeout(r, 2000));
  }
  return fetch(response_url, { headers: { Authorization: `Key ${key}` } });
}

async function fetchPricing(
  endpointIds: string[],
  key: string,
): Promise<Map<string, PricingRow>> {
  // fal pricing API is not key-gated but we pass FAL_KEY for parity with queue calls.
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

async function main() {
  const key = requireFalKey();
  const slots: Slot[] = JSON.parse(
    fs.readFileSync("scripts/bake-off-slots.json", "utf8"),
  );
  fs.mkdirSync(BAKE_OFF_DIR, { recursive: true });

  // Pre-cache pricing per endpoint so the table Alex signs off on has real USD figures.
  const pricing = await fetchPricing(slots.map((s) => s.expectedEndpoint), key);

  const results: Array<Record<string, unknown>> = [];
  for (const slot of slots) {
    for (const cs of CASES) {
      const caseInput = JSON.parse(
        fs.readFileSync(path.join(BAKE_OFF_DIR, `${cs}.json`), "utf8"),
      );
      const input: Record<string, unknown> = { prompt: casePrompt(caseInput) };
      if (caseInput.imageUrl) input.image_url = caseInput.imageUrl;
      if (slot.mode === "mask-fill" && caseInput.maskUrl) {
        input.mask_url = caseInput.maskUrl;
      }
      const started = Date.now();
      try {
        const res = await falQueueRun(slot.expectedEndpoint, input, key);
        const body = (await res.json()) as Record<string, unknown>;
        const images = (body as { images?: Array<{ url: string }> }).images;
        const firstImage = images?.[0];
        results.push({
          slot: slot.id,
          case: cs,
          latency_ms: Date.now() - started,
          unit_price_usd: pricing.get(slot.expectedEndpoint)?.unit_price ?? null,
          billing_unit: pricing.get(slot.expectedEndpoint)?.unit ?? null,
          output: firstImage?.url ?? null,
          output_dimensions:
            firstImage && "width" in firstImage && "height" in firstImage
              ? `${(firstImage as { width: number }).width}x${(firstImage as { height: number }).height}`
              : null,
          ok: true,
        });
      } catch (err) {
        results.push({ slot: slot.id, case: cs, ok: false, error: String(err) });
      }
    }
  }
  fs.writeFileSync(
    path.join(BAKE_OFF_DIR, "bake-off-results.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(`wrote ${results.length} rows to bake-off/bake-off-results.json`);
}

function casePrompt(c: Record<string, unknown>): string {
  return (c as { prompt?: string }).prompt ?? "";
}

main();
