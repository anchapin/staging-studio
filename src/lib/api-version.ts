/**
 * API Versioning Utility
 *
 * Strategy: URL-based versioning (/api/v1/... for new endpoints).
 * Existing routes at /api/... remain functional (backward compatible).
 * All new AI endpoints MUST use the /api/v1/ prefix.
 *
 * Version detection:
 *   - Primary: URL path prefix (/api/v1/...)
 *   - Fallback: Accept header (application/vnd.stagingstudio.v1+json)
 *
 * Deprecation lifecycle:
 *   1. New endpoint lands at /api/v1/resource
 *   2. Old endpoint at /api/resource gets Deprecation + Sunset headers
 *   3. Client has ~6 months to migrate before old endpoint is removed
 */

export const CURRENT_API_VERSION = "v1" as const;
export const VERSION_HEADER = "X-Supabase-API-Version" as const;
export const DEPRECATION_HEADER = "Deprecation" as const;
export const SUNSET_HEADER = "Sunset" as const;

export type ApiVersion = "v1" | "unversioned";

export interface VersionInfo {
  version: ApiVersion;
  isDeprecated: boolean;
  sunsetDate: string | null;
}

function getSunsetDate(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 6);
  return d.toUTCString();
}

export function parseApiVersion(req: Request): VersionInfo {
  const rawUrl = req.url ?? "";
  const accept = req.headers.get("Accept") ?? "";
  const url = rawUrl.startsWith("http") ? new URL(rawUrl).pathname : rawUrl;

  if (url.includes("/api/v1/") || accept.includes("application/vnd.stagingstudio.v1")) {
    return { version: "v1", isDeprecated: false, sunsetDate: null };
  }

  if (url.startsWith("/api/")) {
    return { version: "unversioned", isDeprecated: true, sunsetDate: getSunsetDate() };
  }

  return { version: "unversioned", isDeprecated: false, sunsetDate: null };
}

export function buildDeprecationHeaders(): Record<string, string> {
  return {
    [DEPRECATION_HEADER]: `true; rel="deprecation"`,
    [SUNSET_HEADER]: getSunsetDate(),
    [VERSION_HEADER]: "deprecated",
    Link: "</api/v1>; rel=\"successor-version\"",
  };
}

export function buildVersionHeaders(version: ApiVersion = CURRENT_API_VERSION): Record<string, string> {
  return { [VERSION_HEADER]: version };
}
