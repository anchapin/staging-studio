---
type: web
actors: [client]
entryPoints:
  - web-app: /preview/[id]
---

# Print surface

`/preview/[id]` — the printable Lookbook page. It is modelled as its own
interface because it is reached **without cookies** and is gated by the
preview token; **the preview-token rules anchor here**.

## Reachability

Two independent, intentional paths grant access:

1. **Signed preview token** — the cookie-less Browserless PDF-export flow
   mints a token scoped to one `projectId` and appends it to the preview
   URL. This path is fully cookie-independent: the cloud browser holds no
   session.
2. **Authenticated session** — the human "Preview Lookbook" button links to
   `/preview/[id]` with no token; access is granted when the request
   carries a valid Supabase session whose `User` owns the project.

Everything else is denied. Denied access always yields a `404` (never
`403`), so the route never leaks a project's existence. Middleware does
not run this logic — `/preview/*` passes through and the page self-guards.

## Governing rules (anchored here)

- [BR-06 Short-lived preview token — 30 minutes](../business-rules/br-06-preview-token-ttl.md)
- [BR-07 Preview token scoped to one project, matching the URL's project](../business-rules/br-07-preview-token-scoping.md)
- [BR-13 Every action mutating a lookbook-rendered field must revalidate `/preview/{projectId}`](../business-rules/br-13-preview-revalidation.md)

## Related capabilities

- [Client sign-off](../capabilities/client-sign-off/capability.md) — the
  signature form is rendered here and posted token-first.
- [PDF export](../capabilities/pdf-export/capability.md) — the export
  service hands this surface a signed URL for the cloud browser to render.

## Notes

- PDF capture mode (`capture=pdf`, which toggles a print-CSS class on
  `<html>`) is a rendering detail of this surface, not a variation.
- The surface renders the same Lookbook projection the web app edits; the
  two can diverge only if a mutating action forgets to revalidate — which
  is exactly what [BR-13](../business-rules/br-13-preview-revalidation.md)
  prevents.
