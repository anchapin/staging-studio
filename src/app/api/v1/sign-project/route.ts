/**
 * v1 Sign Project Route
 *
 * Proxies requests to the existing /api/sign-project endpoint.
 * Demonstrates the versioned API pattern with request forwarding.
 *
 * POST /api/v1/sign-project
 *
 * Version header: API-Version: v1
 */
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SIGN_PROJECT_URL = new URL("/api/sign-project", process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000");

/** POST /api/v1/sign-project – proxy to /api/sign-project */
export async function POST(request: NextRequest) {
  const body = await request.text();

  const headers: HeadersInit = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  const response = await fetch(SIGN_PROJECT_URL, {
    method: "POST",
    headers,
    body,
    redirect: "manual",
  });

  const text = await response.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  return NextResponse.json(data, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("Content-Type") ?? "application/json",
      "API-Version": "v1",
    },
  });
}

/** OPTIONS /api/v1/sign-project – CORS preflight for proxy route */
export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "API-Version": "v1",
    },
  });
}
