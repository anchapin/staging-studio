---
appliesTo:
  - type: context
    context:
      place: print-surface
references:
  - kind: code
    role: implementation
    target: src/lib/preview-token.ts
---

# The cookie-less print page requires a preview token that lives 30 minutes

Access to /preview/{projectId} without a session is granted only by an
HMAC-signed preview token whose TTL is 30 minutes. Expired, forged or
malformed tokens are rejected, and denial is reported as 404.

**Grant.** The cookie-less [print surface](../interfaces/print-surface.md)
is reachable only with a live, correctly signed preview token.

**Enforcing code.** `src/lib/preview-token.ts` — `signPreviewToken` mints
an HMAC-SHA256 signature over the payload text (which embeds the project
id and an `exp`), and `verifyPreviewToken` rejects expired tokens and
never throws on malformed input. The TTL is
`PREVIEW_TOKEN_TTL_SECONDS = 30 * 60` (30 minutes; raised from 5 to
handle slow Browserless queueing). The token travels in the `token` query
param (`PREVIEW_TOKEN_QUERY_PARAM`). Signing and verification use the Web
Crypto API, so the module behaves identically in the Edge runtime, the
Node server runtime and the vitest environment.

The token's secret is `PREVIEW_TOKEN_SECRET`; when unset, a fixed
**dev-only** fallback is used so local development and CI keep working.
That fallback is public by design and is not a secret — production
deployments must set the variable.

**Effect on the model.** The preview token is the credential for the
client sign-off flow
([client sign-off capability](../capabilities/client-sign-off/capability.md))
and for the PDF export's Browserless fetch
([PDF export capability](../capabilities/pdf-export/capability.md)).
