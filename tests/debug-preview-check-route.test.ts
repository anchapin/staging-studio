import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

import { GET } from "@/app/api/debug-preview-check/route";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { signPreviewToken, verifyPreviewToken } from "@/lib/preview-token";

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: vi.fn(),
}));

vi.mock("@/lib/preview-token", () => ({
  signPreviewToken: vi.fn(),
  verifyPreviewToken: vi.fn(),
}));

const authedUser = getAuthedPrismaUser as unknown as Mock;
const sign = signPreviewToken as unknown as Mock;
const verify = verifyPreviewToken as unknown as Mock;

const USER_ID = "user-1";
const ORIGINAL_SECRET = process.env.PREVIEW_TOKEN_SECRET;

function callDebugRoute(localToken?: string): Promise<Response> {
  const query = localToken ? `?localToken=${encodeURIComponent(localToken)}` : "";
  const request = new NextRequest(`http://localhost/api/debug-preview-check${query}`);
  return GET(request);
}

beforeEach(() => {
  vi.resetAllMocks();
  authedUser.mockResolvedValue({ id: USER_ID });
  process.env.PREVIEW_TOKEN_SECRET = "0123456789abcdef";
  sign.mockResolvedValue("signed-self-token");
  verify.mockImplementation(async (token: string) =>
    token === "signed-self-token"
      ? { valid: true, projectId: "self-test" }
      : token === "known-good-token"
        ? { valid: true, projectId: "project-1" }
        : { valid: false }
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  if (ORIGINAL_SECRET === undefined) delete process.env.PREVIEW_TOKEN_SECRET;
  else process.env.PREVIEW_TOKEN_SECRET = ORIGINAL_SECRET;
});

describe("GET /api/debug-preview-check — production + auth gating (issue #702)", () => {
  it("returns 404 in production before any auth or token work runs", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const response = await callDebugRoute("known-good-token");

    expect(response.status).toBe(404);
    expect(authedUser).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });

  it("returns 401 outside production when there is no valid session", async () => {
    authedUser.mockResolvedValue(null);

    const response = await callDebugRoute("known-good-token");
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
    expect(sign).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });

  it("returns the diagnostic payload for an authed caller outside production", async () => {
    const response = await callDebugRoute("known-good-token");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      hasSecret: true,
      secretLen: 16,
      selfSignVerify: true,
      localTokenVerdict: { valid: true, projectId: "project-1" },
    });
    expect(verify).toHaveBeenCalledWith("known-good-token");
  });

  it("reports an invalid localToken verdict without leaking details", async () => {
    const response = await callDebugRoute("forged-token");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.localTokenVerdict).toEqual({ valid: false });
  });
});
