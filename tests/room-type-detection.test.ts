import { describe, it, expect, vi, beforeEach } from "vitest";
import { detectRoomType } from "@/lib/room-type-detection";
import { ROOM_TYPE_SYSTEM_PROMPT } from "@/lib/prompts";
import { assertOpenAIConfigured } from "@/lib/ai";
import { generateObject } from "ai";

type GenerateObjectCall = {
  model: unknown;
  messages: Array<{
    role: string;
    content: string | Array<{ type: string; text?: string; image?: string }>;
  }>;
  [key: string]: unknown;
};

const generateObjectCalls: GenerateObjectCall[] = [];
let mockResolveValue: { object: { roomType: string } } = {
  object: { roomType: "Living Room" },
};

vi.mock("ai");

vi.mock("@/lib/ai", () => ({
  aiModel: "mock-model",
  assertOpenAIConfigured: vi.fn(),
}));

describe("detectRoomType", () => {
  beforeEach(() => {
    generateObjectCalls.length = 0;
    mockResolveValue = { object: { roomType: "Living Room" } };

    vi.mocked(generateObject).mockImplementation(
      async (opts: unknown) => {
        generateObjectCalls.push(opts as GenerateObjectCall);
        return mockResolveValue as Awaited<ReturnType<typeof generateObject>>;
      }
    );
  });

  it("returns the room type from the AI response", async () => {
    const result = await detectRoomType("data:image/png;base64,fake");
    expect(result).toBe("Living Room");
    expect(vi.mocked(generateObject)).toHaveBeenCalled();
  });

  it("passes model, system prompt, and user message with image to the AI", async () => {
    await detectRoomType("data:image/jpeg;base64,kitchen-photo");

    expect(generateObjectCalls.length).toBe(1);
    const opts = generateObjectCalls[0]!;

    // Model is the configured AI model
    expect(opts.model).toBe("mock-model");

    // System prompt is sent as a system message
    const systemMsg = opts.messages.find((m) => m.role === "system");
    expect(systemMsg).toBeDefined();
    expect(systemMsg!.content).toBe(ROOM_TYPE_SYSTEM_PROMPT);

    // User message contains the instruction text and the image
    const userMsg = opts.messages.find((m) => m.role === "user");
    expect(userMsg).toBeDefined();
    expect(userMsg!.role).toBe("user");

    const content = userMsg!.content;
    if (Array.isArray(content)) {
      const imageBlock = content.find((b) => b.type === "image");
      expect(imageBlock).toBeDefined();
      expect(imageBlock!.image).toBe("data:image/jpeg;base64,kitchen-photo");

      const textBlock = content.find((b) => b.type === "text");
      expect(textBlock).toBeDefined();
      expect(textBlock!.text).toBe(
        "What type of room is shown in this photo?"
      );
    } else {
      // If content is a string (not expected here), fail
      expect(typeof content).toBe("object");
    }

    // Schema is used by generateObject to structure the response
    expect(opts.schema).not.toBeUndefined();
  });

  it("returns Primary Bedroom for a bedroom photo", async () => {
    mockResolveValue = { object: { roomType: "Primary Bedroom" } };

    const result = await detectRoomType("data:image/png;base64,bedroom");
    expect(result).toBe("Primary Bedroom");
  });

  it("asserts OpenAI is configured before calling generateObject", async () => {
    await detectRoomType("data:image/png;base64,dining");
    expect(vi.mocked(assertOpenAIConfigured)).toHaveBeenCalledTimes(1);
  });
});
