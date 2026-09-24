import { describe, it, expect } from "vitest";
import {
  PROJECT_ID_PATTERN,
  SIGNATURE_DATA_URL_PREFIX,
  MAX_SIGNATURE_DATA_URL_LENGTH,
  signProjectPayloadSchema,
  signProjectRequestSchema,
  tokenMatchesProject,
} from "@/lib/sign-project-schema";

const VALID_PROJECT_ID = `c${"a".repeat(24)}`;
const OTHER_PROJECT_ID = `c${"b".repeat(24)}`;
const VALID_SIGNATURE = `${SIGNATURE_DATA_URL_PREFIX}iVBORw0KGgo=`;
const VALID_TOKEN = "eyJwcm9qZWN0SWQiOiJjYWFhIn0.c2lnbmF0dXJl";

describe("signProjectRequestSchema", () => {
  it("accepts a well-formed request (happy path)", () => {
    const parsed = signProjectRequestSchema.safeParse({
      projectId: VALID_PROJECT_ID,
      signatureDataUrl: VALID_SIGNATURE,
      token: VALID_TOKEN,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({
        projectId: VALID_PROJECT_ID,
        signatureDataUrl: VALID_SIGNATURE,
        token: VALID_TOKEN,
      });
    }
  });

  it("rejects a malformed projectId", () => {
    for (const bad of [
      "",
      "not-a-cuid",
      `c${"a".repeat(23)}`,
      `c${"a".repeat(25)}`,
      `C${"a".repeat(24)}`,
      `c${"A".repeat(24)}`,
      42,
      null,
      undefined,
    ]) {
      const parsed = signProjectRequestSchema.safeParse({
        projectId: bad,
        signatureDataUrl: VALID_SIGNATURE,
        token: VALID_TOKEN,
      });
      expect(parsed.success, `projectId=${String(bad)}`).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0]?.path).toContain("projectId");
      }
    }
  });

  it("rejects a non-PNG data URL", () => {
    for (const bad of [
      "data:image/jpeg;base64,AAAA",
      "data:image/png",
      "https://example.com/signature.png",
      "iVBORw0KGgo=",
      "",
      1234,
      null,
      undefined,
    ]) {
      const parsed = signProjectRequestSchema.safeParse({
        projectId: VALID_PROJECT_ID,
        signatureDataUrl: bad,
        token: VALID_TOKEN,
      });
      expect(parsed.success, `signatureDataUrl=${String(bad)}`).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0]?.path).toContain("signatureDataUrl");
      }
    }
  });

  it("rejects a missing or empty token", () => {
    for (const bad of ["", undefined, null, 99]) {
      const parsed = signProjectRequestSchema.safeParse({
        projectId: VALID_PROJECT_ID,
        signatureDataUrl: VALID_SIGNATURE,
        token: bad,
      });
      expect(parsed.success, `token=${String(bad)}`).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0]?.path).toContain("token");
      }
    }
  });

  it("rejects an oversized signature data URL beyond the 1 MB cap", () => {
    const atLimit = signProjectRequestSchema.safeParse({
      projectId: VALID_PROJECT_ID,
      signatureDataUrl: `${SIGNATURE_DATA_URL_PREFIX}${"A".repeat(
        MAX_SIGNATURE_DATA_URL_LENGTH - SIGNATURE_DATA_URL_PREFIX.length
      )}`,
      token: VALID_TOKEN,
    });
    expect(atLimit.success).toBe(true);

    const overLimit = signProjectRequestSchema.safeParse({
      projectId: VALID_PROJECT_ID,
      signatureDataUrl: `${SIGNATURE_DATA_URL_PREFIX}${"A".repeat(
        MAX_SIGNATURE_DATA_URL_LENGTH - SIGNATURE_DATA_URL_PREFIX.length + 1
      )}`,
      token: VALID_TOKEN,
    });
    expect(overLimit.success).toBe(false);
    if (!overLimit.success) {
      expect(overLimit.error.issues[0]?.path).toContain("signatureDataUrl");
    }
  });

  it("rejects unknown keys (strict)", () => {
    const parsed = signProjectRequestSchema.safeParse({
      projectId: VALID_PROJECT_ID,
      signatureDataUrl: VALID_SIGNATURE,
      token: VALID_TOKEN,
      userId: "cmaliciousownershiptransfer",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("signProjectPayloadSchema", () => {
  it("accepts the shared payload (used by saveProjectSignature) without a token", () => {
    const parsed = signProjectPayloadSchema.safeParse({
      projectId: VALID_PROJECT_ID,
      signatureDataUrl: VALID_SIGNATURE,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a malformed projectId in the shared payload too", () => {
    const parsed = signProjectPayloadSchema.safeParse({
      projectId: "../../etc/passwd",
      signatureDataUrl: VALID_SIGNATURE,
    });
    expect(parsed.success).toBe(false);
  });
});

describe("tokenMatchesProject", () => {
  it("accepts a valid verification scoped to the same project", () => {
    expect(
      tokenMatchesProject({ valid: true, projectId: VALID_PROJECT_ID }, VALID_PROJECT_ID)
    ).toBe(true);
  });

  it("rejects a wrong-project token mismatch", () => {
    expect(
      tokenMatchesProject({ valid: true, projectId: OTHER_PROJECT_ID }, VALID_PROJECT_ID)
    ).toBe(false);
  });

  it("rejects an invalid verification regardless of projectId", () => {
    expect(tokenMatchesProject({ valid: false }, VALID_PROJECT_ID)).toBe(false);
  });
});

describe("exported constants", () => {
  it("pins the projectId pattern at cuid shape (c + 24 lowercase alphanumerics)", () => {
    expect(PROJECT_ID_PATTERN.test(VALID_PROJECT_ID)).toBe(true);
    expect(PROJECT_ID_PATTERN.test(OTHER_PROJECT_ID)).toBe(true);
    expect(PROJECT_ID_PATTERN.test(`c${"a".repeat(24)}x`)).toBe(false);
  });

  it("pins the ~1 MB data-URL cap and PNG prefix", () => {
    expect(MAX_SIGNATURE_DATA_URL_LENGTH).toBe(1_048_576);
    expect(SIGNATURE_DATA_URL_PREFIX).toBe("data:image/png;base64,");
  });
});
