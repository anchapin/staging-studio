/**
 * Seam test: payload builder -> Alibaba adapter (the production path).
 *
 * The adapter's own unit tests hand-feed it camelCase inputs and the
 * prompts tests never covered the Alibaba builder, so the seam between
 * `buildInpaintPayloadForActiveProvider` (which emits snake_case
 * `image_url`) and the adapter's `submit` (which read camelCase
 * `imageUrl`) was exercised by NO test — and the DashScope request went
 * out with an empty image URL on every production inpaint call since
 * the #1240 migration. This test wires the REAL builder output into
 * the REAL adapter and pins what reaches the DashScope wire: the
 * caller's image URL in the message content, and the caller's
 * strength/seed in `parameters` (the #1362b threading).
 *
 * Fetch and the circuit breaker are mocked, as in
 * tests/alibaba-adapter.test.ts. No network, placeholder env only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockExecute = vi.hoisted(() => vi.fn());
vi.mock("@/lib/circuit-breaker", () => ({
  getCircuitBreaker: vi.fn(() => ({
    service: "alibaba-cloud",
    execute: mockExecute,
    state: "closed" as const,
  })),
}));

const IMAGE_URL =
  "https://example.supabase.co/storage/v1/object/public/staging-images/before.png";
const RESULT_URL = "https://dashscope.example/output.png";

let capturedBody: Record<string, unknown> | null = null;

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  mockExecute.mockReset();
  mockExecute.mockImplementation(async (fn: () => Promise<unknown>) => fn());
  capturedBody = null;
  process.env.ALIBABA_DASHSCOPE_API_KEY = "<redacted>";
  process.env.ALIBABA_BAILIAN_WORKSPACE_ID = "llm-test-workspace";
  process.env.ALIBABA_INPAINT_MODEL = "qwen-image-2.1-pro";
  process.env.INFERENCE_PROVIDER = "alibaba";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init?: { body?: string }) => {
      capturedBody = JSON.parse(init?.body ?? "{}") as Record<
        string,
        unknown
      >;
      return Response.json({
        request_id: "ds-1",
        output: {
          choices: [
            { message: { content: [{ image: RESULT_URL }] } },
          ],
        },
        usage: { image_count: 1, width: 2048, height: 1536 },
      });
    }),
  );
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

describe("alibaba payload seam (builder -> adapter -> DashScope wire)", () => {
  it("sends the caller's image URL and prompt to DashScope", async () => {
    const { buildInpaintPayloadForActiveProvider } = await import(
      "@/lib/prompts"
    );
    const { createAlibabaClient } = await import("@/lib/alibaba-adapter");
    const { LOGICAL_MODEL } = await import("@/lib/inference");

    const input = buildInpaintPayloadForActiveProvider({
      imageUrl: IMAGE_URL,
      maskUrl: "https://example.supabase.co/mask.png",
      prompt: "Modern Farmhouse style. Stage the room.",
    });

    const client = createAlibabaClient();
    const out = await client.submit(LOGICAL_MODEL.FLUX_FILL, { input });
    expect(out.result?.imageUrl).toBe(RESULT_URL);

    const body = capturedBody as {
      input: {
        messages: Array<{
          content: Array<{ image?: string; text?: string }>;
        }>;
      };
    };
    expect(body.input.messages[0].content[0].image).toBe(IMAGE_URL);
    expect(body.input.messages[0].content[1].text).toBe(
      "Modern Farmhouse style. Stage the room.",
    );
  });

  it("threads the caller's strength and seed into parameters (#1362b)", async () => {
    const { buildInpaintPayloadForActiveProvider } = await import(
      "@/lib/prompts"
    );
    const { createAlibabaClient } = await import("@/lib/alibaba-adapter");
    const { LOGICAL_MODEL } = await import("@/lib/inference");

    const input = buildInpaintPayloadForActiveProvider({
      imageUrl: IMAGE_URL,
      maskUrl: "https://example.supabase.co/mask.png",
      prompt: "Stage it",
      strength: 0.8,
      seed: 123,
    });

    const client = createAlibabaClient();
    await client.submit(LOGICAL_MODEL.FLUX_FILL, { input });

    const body = capturedBody as {
      parameters: { strength?: number; seed?: number };
    };
    expect(body.parameters.strength).toBe(0.8);
    expect(body.parameters.seed).toBe(123);
  });
});
