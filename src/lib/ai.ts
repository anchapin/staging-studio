import { openai } from "@ai-sdk/openai";
import { requireEnvVars } from "@/lib/env";

export const aiModel = openai("gpt-4o-mini");

export function assertOpenAIConfigured(): void {
  requireEnvVars("OPENAI_API_KEY");
}
