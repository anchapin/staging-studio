import { afterEach, describe, expect, it, vi } from "vitest";

const ENV_VAR = "NEXT_PUBLIC_SAM_TOOL_ENABLED";

async function importFlag(): Promise<typeof import("@/lib/sam-tool")> {
  vi.resetModules();
  return import("@/lib/sam-tool");
}

describe("SAM_TOOL_ENABLED", () => {
  afterEach(() => {
    delete process.env[ENV_VAR];
    vi.resetModules();
  });

  // Pins the issue #228 concept-tool replacement: the SAM 3.1 Select
  // Objects tool ships enabled. The flag remains the kill switch —
  // flipping it off (env or the e2e build) hides the tool + hint copy,
  // gates the editor-open `furniture` auto-fire, and skips the
  // concept-tool e2e specs; brush/flood-fill stay untouched.
  it("defaults to enabled when the env override is unset", async () => {
    delete process.env[ENV_VAR];
    const { SAM_TOOL_ENABLED } = await importFlag();
    expect(SAM_TOOL_ENABLED).toBe(true);
  });

  it("stays enabled for any value other than exactly 'false'", async () => {
    process.env[ENV_VAR] = "";
    expect((await importFlag()).SAM_TOOL_ENABLED).toBe(true);
    process.env[ENV_VAR] = "true";
    expect((await importFlag()).SAM_TOOL_ENABLED).toBe(true);
    process.env[ENV_VAR] = "0";
    expect((await importFlag()).SAM_TOOL_ENABLED).toBe(true);
  });

  it("flips off when NEXT_PUBLIC_SAM_TOOL_ENABLED=false (kill switch)", async () => {
    process.env[ENV_VAR] = "false";
    const { SAM_TOOL_ENABLED } = await importFlag();
    expect(SAM_TOOL_ENABLED).toBe(false);
  });
});
