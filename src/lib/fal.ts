import * as fal from "@fal-ai/serverless-client";
import { requireEnvVars } from "@/lib/env";

fal.config({
  credentials: process.env.FAL_KEY,
});

export { fal };

export function assertFalConfigured(): void {
  requireEnvVars("FAL_KEY");
}
