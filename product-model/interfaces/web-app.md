---
type: web
actors: [user]
entryPoints:
  - web: /
---

# Web app

The interactive surface a firm's user drives the whole journey from.

## Surfaces

| Route | Purpose |
| --- | --- |
| `/login` | Password or magic-link sign-in. |
| `/auth/callback` | Auth code exchange. |
| `/setup` | First-run firm branding (name, logo). |
| `/dashboard` | Protected landing; redirects to `/projects`. |
| `/projects` | Project list. |
| `/projects/new` | Project intake form. |
| `/projects/[id]` | Staging workspace. |
| `/projects/[id]/rooms` | Per-room staging studio. |
| `/projects/[id]/refine` | Staged-result refinement (`?room=`-scoped). |
| `/projects/[id]/lookbook` | Interactive Lookbook editor + ROI metrics. |
| `/projects/[id]/report` | Client-facing consultation report with comparison slider. |

## Credential and access

- The session (a Supabase session cookie) is the credential for every write. Route protection for
  `/dashboard`, `/projects` and `/settings` lives in the root
  `middleware.ts`.
- Every mutation is ownership-checked against the session's `User`
  ([BR-01](../business-rules/br-01-ownership-checked-writes.md)).
- An authenticated visitor with no `User` row is routed to `/setup`
  ([firm setup capability](../capabilities/firm-setup/capability.md)); the
  setup flow is IP rate-limited
  ([BR-05](../business-rules/br-05-setup-rate-limit.md)).

## Related

- The [print surface](./print-surface.md) is a **separate**
  interface: it is cookie-less and preview-token-gated.
- The Lookbook the web app assembles is a projection of
  [Project](../entities/project.md), not a separate record.
