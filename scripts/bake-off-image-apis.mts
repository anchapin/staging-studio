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

async function main() {
  const key = requireFalKey();
  const slots: Slot[] = JSON.parse(
    fs.readFileSync("scripts/bake-off-slots.json", "utf8"),
  );
  fs.mkdirSync(BAKE_OFF_DIR, { recursive: true });

  const results: Array<Record<string, unknown>> = [];
  for (const slot of slots) {
    for (const cs of CASES) {
      const caseInput = JSON.parse(
        fs.readFileSync(path.join(BAKE_OFF_DIR, `${cs}.json`), "utf8"),
      );
      const input =
        slot.mode === "mask-fill"
          ? { prompt: casePrompt(caseInput), image_url: caseInput.imageUrl, mask_url: caseInput.maskUrl }
          : { prompt: casePrompt(caseInput), image_url: caseInput.imageUrl };
      const started = Date.now();
      try {
        const res = await falQueueRun(slot.expectedEndpoint, input, key);
        const body = (await res.json()) as Record<string, unknown>;
        results.push({
          slot: slot.id,
          case: cs,
          latency_ms: Date.now() - started,
          price_usd: (body as { cost_usd?: number }).cost_usd ?? null,
          output: (body as { images?: Array<{ url: string }> }).images?.[0]?.url ?? null,
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
