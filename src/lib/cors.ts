/**
 * Shared CORS policy utility for all API routes.
 *
 * Single-tenant: only the application's own origin(s) are allowed.
 * Reads the allowed origin from `NEXT_PUBLIC_APP_URL`; falls back to
 * `http://localhost:3000` in development when that env var is unset.
 */

import { NextResponse, NextRequest } from "next/server";

/**
 * Returns the allowed origin for CORS.
 * Falls back to http://localhost:3000 when NEXT_PUBLIC_APP_URL is not set.
 */
function getAllowedOrigin(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl && appUrl.trim() !== "") {
    return appUrl.trim();
  }
  // Development fallback
  return "http://localhost:3000";
}

/**
 * Returns the set of CORS headers for a response.
 */
export function getCorsHeaders(): Record<string, string> {
  const origin = getAllowedOrigin();
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
  };
}

/**
 * Creates a preflight (OPTIONS) response with CORS headers.
 */
export function createPreflightResponse(): NextResponse {
  return NextResponse.json(
    { ok: true },
    { status: 200, headers: getCorsHeaders() }
  );
}

/**
 * Adds CORS headers to any NextResponse and returns it.
 * Use this to wrap every response returned by an API route.
 */
export function withCors(response: NextResponse): NextResponse {
  const headers = getCorsHeaders();
  response.headers.set("Access-Control-Allow-Origin", headers["Access-Control-Allow-Origin"]);
  response.headers.set("Access-Control-Allow-Methods", headers["Access-Control-Allow-Methods"]);
  response.headers.set("Access-Control-Allow-Headers", headers["Access-Control-Allow-Headers"]);
  response.headers.set("Access-Control-Allow-Credentials", headers["Access-Control-Allow-Credentials"]);
  return response;
}

/**
 * Checks if the incoming request is a preflight (OPTIONS) request.
 */
export function isPreflightRequest(request: NextRequest): boolean {
  return request.method === "OPTIONS";
}
