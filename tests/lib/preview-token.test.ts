import { test, expect, afterEach, describe, it } from "vitest";
import {
  signPreviewToken,
  verifyPreviewToken,
  PREVIEW_TOKEN_QUERY_PARAM,
  PREVIEW_TOKEN_TTL_SECONDS,
} from "@/lib/preview-token";

// Save originals for restoration
const ORIG = {
  PREVIEW_TOKEN_SECRET: process.env.PREVIEW_TOKEN_SECRET,
} as const;

afterEach(() => {
  process.env.PREVIEW_TOKEN_SECRET = ORIG.PREVIEW_TOKEN_SECRET;
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("exports", () => {
  test("PREVIEW_TOKEN_QUERY_PARAM is 'token'", () => {
    expect(PREVIEW_TOKEN_QUERY_PARAM).toBe("token");
  });

  test("PREVIEW_TOKEN_TTL_SECONDS is 300 (5 minutes)", () => {
    expect(PREVIEW_TOKEN_TTL_SECONDS).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// signPreviewToken
// ---------------------------------------------------------------------------

describe("signPreviewToken", () => {
  it("returns a non-empty string token", async () => {
    const token = await signPreviewToken("project-123");
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
  });

  it("token contains a single dot separator", async () => {
    const token = await signPreviewToken("project-123");
    const parts = token.split(".");
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBeTruthy();
    expect(parts[1]).toBeTruthy();
  });

  it("produces different tokens for different projectIds", async () => {
    const tokenA = await signPreviewToken("project-a");
    const tokenB = await signPreviewToken("project-b");
    expect(tokenA).not.toBe(tokenB);
  });

  it("accepts a custom ttlSeconds", async () => {
    const token = await signPreviewToken("project-123", 60);
    expect(typeof token).toBe("string");
    const result = await verifyPreviewToken(token);
    expect(result).toEqual({ valid: true, projectId: "project-123" });
  });
});

// ---------------------------------------------------------------------------
// verifyPreviewToken — valid tokens
// ---------------------------------------------------------------------------

describe("verifyPreviewToken", () => {
  it("returns valid=true and projectId for a freshly minted token", async () => {
    const token = await signPreviewToken("project-abc");
    const result = await verifyPreviewToken(token);
    expect(result).toEqual({ valid: true, projectId: "project-abc" });
  });

  it("returns valid=true for a token minted with default TTL (5 minutes)", async () => {
    const token = await signPreviewToken("my-project");
    const result = await verifyPreviewToken(token);
    expect(result).toEqual({ valid: true, projectId: "my-project" });
  });
});

// ---------------------------------------------------------------------------
// verifyPreviewToken — null / undefined / empty
// ---------------------------------------------------------------------------

describe("verifyPreviewToken — null / undefined / empty", () => {
  it("returns valid=false for null", async () => {
    const result = await verifyPreviewToken(null);
    expect(result).toEqual({ valid: false });
  });

  it("returns valid=false for undefined", async () => {
    const result = await verifyPreviewToken(undefined);
    expect(result).toEqual({ valid: false });
  });

  it("returns valid=false for empty string", async () => {
    const result = await verifyPreviewToken("");
    expect(result).toEqual({ valid: false });
  });
});

// ---------------------------------------------------------------------------
// verifyPreviewToken — malformed structure
// ---------------------------------------------------------------------------

describe("verifyPreviewToken — malformed structure", () => {
  it("returns valid=false for a token with no dot", async () => {
    const result = await verifyPreviewToken("no-dot-at-all");
    expect(result).toEqual({ valid: false });
  });

  it("returns valid=false for a token with too many dots", async () => {
    const result = await verifyPreviewToken("part.part.part");
    expect(result).toEqual({ valid: false });
  });

  it("returns valid=false when payload part is empty", async () => {
    const result = await verifyPreviewToken(".signature");
    expect(result).toEqual({ valid: false });
  });

  it("returns valid=false when signature part is empty", async () => {
    const result = await verifyPreviewToken("payload.");
    expect(result).toEqual({ valid: false });
  });

  it("returns valid=false for invalid base64 in payload", async () => {
    const result = await verifyPreviewToken("!!!not-base64!!.sig");
    expect(result).toEqual({ valid: false });
  });

  it("returns valid=false for valid base64 but non-JSON payload", async () => {
    // toBase64Url("hello") → "aGVsbG8"
    const result = await verifyPreviewToken("aGVsbG8.signature");
    expect(result).toEqual({ valid: false });
  });
});

// ---------------------------------------------------------------------------
// verifyPreviewToken — payload validation
// ---------------------------------------------------------------------------

describe("verifyPreviewToken — payload validation", () => {
  it("returns valid=false when projectId is missing from payload", async () => {
    // Manually construct a token with an empty projectId to avoid the getSecret() call
    // by reusing the real signPreviewToken output shape but with tampered payload
    const token = await signPreviewToken("any");
    const [payload] = token.split(".");
    // payload is base64url JSON — decode, strip projectId, re-encode
    const decoded = JSON.parse(
      Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()
    );
    delete decoded.projectId;
    const tamperedPayload = Buffer.from(JSON.stringify(decoded)).toString("base64url");
    const tamperedToken = `${tamperedPayload}.${token.split(".")[1]}`;
    const result = await verifyPreviewToken(tamperedToken);
    expect(result).toEqual({ valid: false });
  });

  it("returns valid=false when projectId is empty string", async () => {
    const token = await signPreviewToken("any");
    const [payload] = token.split(".");
    const decoded = JSON.parse(
      Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()
    );
    decoded.projectId = "";
    const tamperedPayload = Buffer.from(JSON.stringify(decoded)).toString("base64url");
    const tamperedToken = `${tamperedPayload}.${token.split(".")[1]}`;
    const result = await verifyPreviewToken(tamperedToken);
    expect(result).toEqual({ valid: false });
  });

  it("returns valid=false when exp is missing from payload", async () => {
    const token = await signPreviewToken("any");
    const [payload] = token.split(".");
    const decoded = JSON.parse(
      Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()
    );
    delete decoded.exp;
    const tamperedPayload = Buffer.from(JSON.stringify(decoded)).toString("base64url");
    const tamperedToken = `${tamperedPayload}.${token.split(".")[1]}`;
    const result = await verifyPreviewToken(tamperedToken);
    expect(result).toEqual({ valid: false });
  });

  it("returns valid=false when exp is non-finite", async () => {
    const token = await signPreviewToken("any");
    const [payload] = token.split(".");
    const decoded = JSON.parse(
      Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()
    );
    decoded.exp = Infinity;
    const tamperedPayload = Buffer.from(JSON.stringify(decoded)).toString("base64url");
    const tamperedToken = `${tamperedPayload}.${token.split(".")[1]}`;
    const result = await verifyPreviewToken(tamperedToken);
    expect(result).toEqual({ valid: false });
  });
});

// ---------------------------------------------------------------------------
// verifyPreviewToken — expired tokens
// ---------------------------------------------------------------------------

describe("verifyPreviewToken — expired tokens", () => {
  it("returns valid=false for a token with exp in the past", async () => {
    // Build a token with exp = now - 1 second (already expired)
    const expiredPayload = Buffer.from(
      JSON.stringify({
        projectId: "project-expired",
        exp: Math.floor(Date.now() / 1000) - 1,
      })
    ).toString("base64url");

    // We need a valid signature for this payload to test expiry separately from sig check
    // Import HMAC key using the same secret as signPreviewToken
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(
        process.env.PREVIEW_TOKEN_SECRET ??
          "staging-studio-dev-only-preview-token-secret-do-not-use-in-production"
      ),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signature = await crypto.subtle.sign(
      "HMAC",
      cryptoKey,
      new TextEncoder().encode(expiredPayload.toString())
    );
    const expiredToken = `${expiredPayload}.${Buffer.from(signature).toString("base64url")}`;

    const result = await verifyPreviewToken(expiredToken);
    expect(result).toEqual({ valid: false });
  });

  it("returns valid=false for a token with exp = 0 (epoch, definitely expired)", async () => {
    const expiredPayload = Buffer.from(
      JSON.stringify({ projectId: "project-zero", exp: 0 })
    ).toString("base64url");

    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(
        process.env.PREVIEW_TOKEN_SECRET ??
          "staging-studio-dev-only-preview-token-secret-do-not-use-in-production"
      ),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signature = await crypto.subtle.sign(
      "HMAC",
      cryptoKey,
      new TextEncoder().encode(expiredPayload.toString())
    );
    const expiredToken = `${expiredPayload}.${Buffer.from(signature).toString("base64url")}`;

    const result = await verifyPreviewToken(expiredToken);
    expect(result).toEqual({ valid: false });
  });
});

// ---------------------------------------------------------------------------
// verifyPreviewToken — tampered / wrong signature
// ---------------------------------------------------------------------------

describe("verifyPreviewToken — tampered / wrong signature", () => {
  it("returns valid=false when payload is modified after signing", async () => {
    const token = await signPreviewToken("project-a");
    const [payload, signature] = token.split(".");

    // Change projectId in the payload
    const decoded = JSON.parse(
      Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()
    );
    decoded.projectId = "project-b"; // different project
    const tamperedPayload = Buffer.from(JSON.stringify(decoded)).toString("base64url");

    const result = await verifyPreviewToken(`${tamperedPayload}.${signature}`);
    expect(result).toEqual({ valid: false });
  });

  it("returns valid=false when signature is replaced with random bytes", async () => {
    const token = await signPreviewToken("project-tampered");
    const [payload] = token.split(".");

    // Use a valid-looking but wrong signature (base64url of 32 zero bytes)
    const wrongSig = Buffer.from(new Uint8Array(32)).toString("base64url");

    const result = await verifyPreviewToken(`${payload}.${wrongSig}`);
    expect(result).toEqual({ valid: false });
  });

  it("returns valid=false for a token signed with a different secret", async () => {
    // Sign with a different secret
    const differentSecretKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode("different-secret-key"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const payload = Buffer.from(
      JSON.stringify({
        projectId: "project-wrong-secret",
        exp: Math.floor(Date.now() / 1000) + 300,
      })
    ).toString("base64url");
    const signature = await crypto.subtle.sign(
      "HMAC",
      differentSecretKey,
      new TextEncoder().encode(payload)
    );
    const token = `${payload}.${Buffer.from(signature).toString("base64url")}`;

    const result = await verifyPreviewToken(token);
    expect(result).toEqual({ valid: false });
  });
});

// ---------------------------------------------------------------------------
// Round-trip: sign then verify
// ---------------------------------------------------------------------------

describe("signPreviewToken + verifyPreviewToken round-trip", () => {
  it("verifies a token signed for any valid projectId", async () => {
    const ids = ["proj-1", "room-abc-123", "UPPERCASE-ID", "id-with-dashes"];
    for (const id of ids) {
      const token = await signPreviewToken(id);
      const result = await verifyPreviewToken(token);
      expect(result).toEqual({ valid: true, projectId: id });
    }
  });
});
