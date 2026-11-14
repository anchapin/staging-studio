---
kind: person
acts: internal
relations:
  - entity: project
    verb: owns
    cardinality: one-to-many
references:
  - kind: code
    role: implementation
    target: prisma/schema.prisma
---

# User

The single firm's operator record. In a single-tenant deployment there is
one `User` row per firm (Circle G Designs); the row carries the firm's
branding and the editable page templates the Lookbook renders. Persisted
as the Prisma model `User` (`prisma/schema.prisma`).

## Information kept

- **Firm name** — `firmName`: the firm's name, rendered on the Lookbook cover
- **Owner name** — `ownerName`: the firm's owner ("Lauren Chapin")
- **Firm logo** — `logoUrl`: the firm's logo, printed on the Hero Artifact
- **Email** — `email`: unique; matches the Supabase Auth session email used to resolve this row (`src/lib/api-auth.ts`)
- **Psychology page content** — `psychologyPageContent`: template text for the Lookbook's buyer-psychology page
- **Sign-off page content** — `signoffContent`: template text for the Lookbook's final sign-off page
- **Dark mode** — `darkMode`: the operator's display preference

## Why it exists

- First-run firm setup writes it (`/setup`, `src/app/api/setup/route.ts`).
- Its absence is what routes an authenticated visitor to `/setup` instead
  of the dashboard.
- It is the owner of every `Project` (`Project.userId` → `User.id`,
  `onDelete: Cascade`).

## Notes

- `User` is the firm's operator, not a "Client". The sign-off actor is
  "the client (via preview token)" — the [Client](./client.md), an Entity
  that acts and keeps nothing; it has no record of its own.
- `DailyApiUsage` and `SetupRateLimit` are **not** modelled as entities;
  they appear only as rules ([BR-04](../business-rules/br-04-daily-caps.md),
  [BR-05](../business-rules/br-05-setup-rate-limit.md)).
