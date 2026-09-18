/**
 * Feature flag: SAM 3.1 concept-selection mask tool ("Select Objects").
 *
 * Issue #228: the old per-click `fal-ai/sam` Select Object tool is
 * replaced by concept selection — ONE call per (image, concept) to
 * `POST /api/segment/furnishings` (issue #227) returns every instance;
 * clicks hit-test client-side for free. The editor-open pre-warm ping
 * (`warm: true`, issue #202) is gone: the REAL `furniture` detection IS
 * the prewarm, and its instances feed the chip UI the moment the editor
 * opens.
 *
 * The flag remains the kill switch: flipping it to `false` hides the
 * tool button and its hint copy, gates the editor-open auto-fire, and
 * skips the concept-tool e2e specs — the brush and flood-fill tools are
 * untouched.
 *
 * Environment override: `NEXT_PUBLIC_SAM_TOOL_ENABLED=false` (inlined at
 * build time) disables the tool — the e2e harness builds with it off
 * until the `fal-ai/sam-3-1/image` interception lands (issue #231), so
 * the editor-open auto-fire can never reach the real route mid-suite.
 * Unset (production/dev) defaults to ENABLED.
 */
export const SAM_TOOL_ENABLED =
  process.env.NEXT_PUBLIC_SAM_TOOL_ENABLED !== "false";
