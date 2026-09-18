import { describe, expect, it } from "vitest";

import { SAM_TOOL_ENABLED } from "@/lib/sam-tool";

describe("SAM_TOOL_ENABLED", () => {
  // Pins the issue #189 demo decision: the SAM Select Object tool is hidden
  // from the editor UI (brush-only demo path) while all SAM implementation
  // stays in the codebase. Flipping the flag for the post-demo revival
  // (issue #202) updates this pin in the same change.
  it("is disabled for the demo (issue #189)", () => {
    expect(SAM_TOOL_ENABLED).toBe(false);
  });
});
