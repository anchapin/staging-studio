import { describe, expect, it } from "vitest";

import { SAM_TOOL_ENABLED } from "@/lib/sam-tool";

describe("SAM_TOOL_ENABLED", () => {
  // Pins the issue #202 revival: the SAM Select Object tool is surfaced in
  // the editor UI again (processing indicator + pre-warm + cache landed
  // with it). The flag remains the kill switch — flipping it back to false
  // hides the tool, gates the pre-warm, and skips the select-object e2e
  // specs, and updates this pin in the same change.
  it("is enabled after the post-demo revival (issue #202)", () => {
    expect(SAM_TOOL_ENABLED).toBe(true);
  });
});
