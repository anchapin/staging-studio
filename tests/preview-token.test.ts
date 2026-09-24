import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PREVIEW_TOKEN_TTL_SECONDS,
  signPreviewToken,
  verifyPreviewToken,
} from "@/lib/preview-token";

/**
 * Negative-path pins for the HMAC preview token (issue #705): expiry,
 * signature tamper, payload tamper, cross-project scope, and malformed
 * input. Timing is deterministic — fake timers freeze Date.now() so the
 * exp boundary (exp <= now means expired) is exercised exactly.
 */

const PROJECT_A = "project-alpha";
const PROJECT_B = "project-beta";

const NOW = new Date("2026-01-15T12:00:00Z");

function toBase64Url(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

function fromBase64Url(text: string): string {
  return Buffer.from(text, "base64url").toString("utf8");
}

/** Deterministically change the first character of a base64url segment. */
function flipFirstChar(segment: string): string {
  return (segment[0] === "A" ? "B" : "A") + segment.slice(1);
}

function splitToken(token: string): { payload: string; signature: string } {
  const [payload, signature] = token.split(".");
  return { payload, signature };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("verifyPreviewToken positive anchor", () => {
  it("accepts a freshly minted default-TTL token for its own project", async () => {
    const token = await signPreviewToken(PROJECT_A);

    await expect(verifyPreviewToken(token)).resolves.toEqual({
      valid: true,
      projectId: PROJECT_A,
    });
  });

  it("uses a 5-minute default TTL", () => {
    expect(PREVIEW_TOKEN_TTL_SECONDS).toBe(300);
  });
});

describe("verifyPreviewToken expiry", () => {
  it("rejects a zero-TTL token as expired at the mint instant", async () => {
    const token = await signPreviewToken(PROJECT_A, 0);

    // exp === now and expiry is inclusive (exp <= now): expired immediately.
    await expect(verifyPreviewToken(token)).resolves.toEqual({ valid: false });
  });

  it("rejects a negative-TTL token as expired", async () => {
    const token = await signPreviewToken(PROJECT_A, -60);

    await expect(verifyPreviewToken(token)).resolves.toEqual({ valid: false });
  });

  it("accepts one second before expiry, rejects exactly at expiry", async () => {
    const token = await signPreviewToken(PROJECT_A, 60);

    vi.advanceTimersByTime(59 * 1000);
    await expect(verifyPreviewToken(token)).resolves.toEqual({
      valid: true,
      projectId: PROJECT_A,
    });

    vi.advanceTimersByTime(1000);
    await expect(verifyPreviewToken(token)).resolves.toEqual({ valid: false });
  });

  it("rejects a token after its TTL has elapsed", async () => {
    const token = await signPreviewToken(PROJECT_A, 300);

    vi.advanceTimersByTime(301 * 1000);
    await expect(verifyPreviewToken(token)).resolves.toEqual({ valid: false });
  });
});

describe("verifyPreviewToken signature tamper", () => {
  it("rejects a token whose signature byte is flipped", async () => {
    const token = await signPreviewToken(PROJECT_A);
    const { payload, signature } = splitToken(token);
    const tampered = `${payload}.${flipFirstChar(signature)}`;

    await expect(verifyPreviewToken(tampered)).resolves.toEqual({
      valid: false,
    });
  });

  it("rejects a truncated signature", async () => {
    const token = await signPreviewToken(PROJECT_A);
    const { payload, signature } = splitToken(token);
    const tampered = `${payload}.${signature.slice(0, -1)}`;

    await expect(verifyPreviewToken(tampered)).resolves.toEqual({
      valid: false,
    });
  });

  it("rejects swapped payload/signature segments", async () => {
    const token = await signPreviewToken(PROJECT_A);
    const { payload, signature } = splitToken(token);

    await expect(verifyPreviewToken(`${signature}.${payload}`)).resolves.toEqual(
      { valid: false },
    );
  });
});

describe("verifyPreviewToken payload tamper", () => {
  it("rejects re-scoping the payload to another project without re-signing", async () => {
    const token = await signPreviewToken(PROJECT_A);
    const { payload, signature } = splitToken(token);
    const claims = JSON.parse(fromBase64Url(payload)) as {
      projectId: string;
      exp: number;
    };
    const forgedPayload = toBase64Url(
      JSON.stringify({ ...claims, projectId: PROJECT_B }),
    );

    await expect(
      verifyPreviewToken(`${forgedPayload}.${signature}`),
    ).resolves.toEqual({ valid: false });
  });

  it("rejects extending the expiry claim without re-signing", async () => {
    const token = await signPreviewToken(PROJECT_A, 60);
    const { payload, signature } = splitToken(token);
    const claims = JSON.parse(fromBase64Url(payload)) as {
      projectId: string;
      exp: number;
    };
    const forgedPayload = toBase64Url(
      JSON.stringify({ ...claims, exp: claims.exp + 3600 }),
    );

    await expect(
      verifyPreviewToken(`${forgedPayload}.${signature}`),
    ).resolves.toEqual({ valid: false });
  });
});

describe("verifyPreviewToken project scope", () => {
  it("returns the signed projectId, never the verifier's project", async () => {
    const token = await signPreviewToken(PROJECT_A);

    const result = await verifyPreviewToken(token);

    expect(result).toEqual({ valid: true, projectId: PROJECT_A });
    if (result.valid) {
      expect(result.projectId).toBe(PROJECT_A);
      expect(result.projectId).not.toBe(PROJECT_B);
    }
  });

  it("validates a project-B token as scoped to B, unusable for A", async () => {
    const token = await signPreviewToken(PROJECT_B);

    const result = await verifyPreviewToken(token);

    expect(result).toEqual({ valid: true, projectId: PROJECT_B });
    if (result.valid) {
      expect(result.projectId === PROJECT_A).toBe(false);
    }
  });
});

describe("verifyPreviewToken malformed input", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
  ])("rejects a %s token", async (_label, token) => {
    await expect(verifyPreviewToken(token)).resolves.toEqual({
      valid: false,
    });
  });

  it.each([
    ["no separator", "garbage"],
    ["three segments", "payload.signature.extra"],
    ["empty payload", ".c2lnbmF0dXJl"],
    ["empty signature", "cGF5bG9hZA"],
    ["bare dot", "."],
  ])("rejects a token with %s", async (_label, token) => {
    await expect(verifyPreviewToken(token)).resolves.toEqual({
      valid: false,
    });
  });

  it("rejects a payload that is not valid base64url", async () => {
    await expect(verifyPreviewToken("!!.c2lnbmF0dXJl")).resolves.toEqual({
      valid: false,
    });
  });

  it("rejects a signature that is not valid base64url", async () => {
    await expect(verifyPreviewToken("cGF5bG9hZA.!!")).resolves.toEqual({
      valid: false,
    });
  });

  it.each([
    ["non-JSON text", "bm90LWpzb24"],
    ["JSON array", "WzEsIDJd"],
    ["empty JSON object", "e30"],
    ["missing exp", toBase64Url(JSON.stringify({ projectId: PROJECT_A }))],
    [
      "empty projectId",
      toBase64Url(JSON.stringify({ projectId: "", exp: 9999999999 })),
    ],
    [
      "non-string projectId",
      toBase64Url(JSON.stringify({ projectId: 42, exp: 9999999999 })),
    ],
    [
      "non-number exp",
      toBase64Url(JSON.stringify({ projectId: PROJECT_A, exp: "soon" })),
    ],
    [
      "non-finite exp",
      toBase64Url(JSON.stringify({ projectId: PROJECT_A, exp: 1e999 })),
    ],
  ])(
    "rejects a well-signed-shape token whose payload has %s",
    async (_label, encodedPayload) => {
      await expect(
        verifyPreviewToken(`${encodedPayload}.c2lnbmF0dXJl`),
      ).resolves.toEqual({ valid: false });
    },
  );
});
