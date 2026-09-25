# API Versioning Strategy

**Issue:** [#940](https://github.com/anomalyco/staging-studio/issues/940)
**Status:** Established
**Version:** v1

---

## Overview

StagingStudio uses **URL-based API versioning** for its public API endpoints. This document describes the versioning strategy, conventions, and migration path for API consumers.

## Versioning Model

### URL Structure

```
/api/v1/<resource>   → Versioned (v1, current)
/api/<resource>      → Unversioned (deprecated, backward compatible)
```

All new AI endpoints **must** be implemented under `/api/v1/`. Existing endpoints at `/api/` remain functional but emit deprecation headers.

### Response Headers

Every API response includes a version header:

| Header | Value | Notes |
|--------|-------|-------|
| `API-Version` | `v1` or `unversioned` | Identifies the API version |
| `Deprecation` | `true; rel="deprecation"` | Present on deprecated (unversioned) endpoints |
| `Sunset` | RFC 7231 date | When the endpoint will be removed |
| `Link` | `</api/v1>; rel="successor-version"` | Migration path on deprecated endpoints |

### Example: v1 Response Headers

```
API-Version: v1
Content-Type: application/json
```

### Example: Deprecated Response Headers

```
API-Version: unversioned
Deprecation: true; rel="deprecation"
Sunset: Sat, 24 Mar 2027 00:00:00 GMT
Link: </api/v1>; rel="successor-version"
Content-Type: application/json
```

## Versioned Endpoints

The following endpoints have v1 implementations:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/inpaint` | POST | Submit an inpainting request (FLUX.1 Fill) |
| `/api/v1/inpaint/[requestId]` | GET | Poll inpainting status |
| `/api/v1/generate-copy` | POST | Generate room staging copy (GPT-4o-mini) |
| `/api/v1/segment` | POST | SAM 3.1 segmentation (single click) |
| `/api/v1/segment/furnishings` | POST | SAM 3.1 bulk furnishing detection |
| `/api/v1/export-pdf` | POST | Generate lookbook PDF (Browserless) |

## Deprecation Lifecycle

1. **New endpoint** lands at `/api/v1/<resource>` — no deprecation headers
2. **Old endpoint** at `/api/<resource>` receives `Deprecation` + `Sunset` + `Link` headers
3. **Client migrates** during the sunset window (typically 6 months)
4. **Old endpoint removed** after the sunset date

## Client Migration Guide

### Detecting Deprecation

Check for the `Deprecation` response header:

```javascript
const isDeprecated = response.headers.get('Deprecation') !== null;
```

### Migrating to v1

Replace the path prefix in your requests:

```javascript
// Before (deprecated)
const res = await fetch('/api/inpaint', { method: 'POST', ... });

// After (v1)
const res = await fetch('/api/v1/inpaint', { method: 'POST', ... });
```

### Version Enforcement (426 Upgrade Required)

When a client without a versioned path calls a v1-required endpoint:

```http
HTTP/1.1 426 Upgrade Required
Content-Type: application/json
API-Version: unversioned
Deprecation: true; rel="deprecation"
Sunset: Sat, 24 Mar 2027 00:00:00 GMT
Link: </api/v1>; rel="successor-version"

{
  "error": "Upgrade Required",
  "message": "This endpoint requires API version v1. Please use /api/v1/ prefix.",
  "code": "api-version-required"
}
```

## Version Detection Utility

The `src/lib/api-version.ts` module provides utilities for working with API versions:

```typescript
import {
  CURRENT_API_VERSION,
  parseApiVersion,
  buildVersionHeaders,
  buildDeprecationHeaders,
  enforceMinVersion,
} from '@/lib/api-version';

// Parse version from request
const info = parseApiVersion(request);
// → { version: "v1", isDeprecated: false, sunsetDate: null }

// Build response headers for a v1 response
const headers = buildVersionHeaders("v1");
// → { "API-Version": "v1" }

// Enforce minimum version (returns 426 on failure)
const result = enforceMinVersion(request, "v1");
if (!result.ok) return result.response;
```

## Adding a New AI Endpoint

When adding a new AI-powered endpoint:

1. **Create the v1 route** at `src/app/api/v1/<resource>/route.ts`
2. **Import** `buildVersionHeaders` from `@/lib/api-version`
3. **Add version headers** to all responses
4. **Add deprecation headers** to the existing (unversioned) route
5. **Update this document** with the new endpoint

### Template

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { buildVersionHeaders } from "@/lib/api-version";
// ... other imports

export async function POST(request: NextRequest) {
  const user = await getAuthedPrismaUser();
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: buildVersionHeaders("v1") }
    );
  }

  // ... handler logic ...

  return NextResponse.json(data, {
    status: 200,
    headers: buildVersionHeaders("v1"),
  });
}
```

## Shared Handler Pattern

For endpoints implemented in both `/api/` and `/api/v1/`, extract shared handler logic to `src/lib/api-handlers/`:

```
src/
  lib/
    api-handlers/
      inpaint-handler.ts   # Shared submit/status logic
      segment-handler.ts   # Shared segment logic
```

Both route versions import from the shared handler, reducing duplication:

```typescript
// /api/inpaint/route.ts (deprecated — keeps working)
import { submitInpaint } from "@/lib/api-handlers/inpaint-handler";

// /api/v1/inpaint/route.ts (canonical)
import { submitInpaint } from "@/lib/api-handlers/inpaint-handler";
```

The v1 route wraps responses with `buildVersionHeaders("v1")`; the deprecated route wraps with `buildDeprecationHeaders()`.

## Environment Variables

No new environment variables are required for versioning. Existing variables continue to work.

## Notes

- **No Content-Type versioning** — This strategy uses URL paths rather than `Accept` header content negotiation. URL-based versioning is simpler for clients and aligns with how Vercel and Next.js API routes work naturally.
- **Backward compatibility** — Existing `/api/` routes remain functional. No client will break immediately. Deprecation headers give clients a migration window.
- **Single-tenant scope** — This strategy applies to the StagingStudio single-tenant deployment. Multi-tenant API key versioning is out of scope.
- **Edge runtime** — HMAC signing for preview tokens uses `crypto.subtle` (Edge-compatible). Do not use `node:crypto` in middleware-path code.

## References

- [MDN: Deprecation HTTP Header](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Deprecation)
- [RFC 8594 — Sunset HTTP Header](https://datatracker.ietf.org/doc/html/rfc8594)
- [GitHub API Versioning](https://docs.github.com/en/rest/overview/api-versions)
