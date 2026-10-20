# Issue #598 Investigation

> **Historical investigation snapshot — not current guidance.** This records the
> state of the codebase at the time #598 was investigated and is kept for
> provenance, in the same category as `issue-220-sam-latency-measurement.md` and
> `segment-timing-measurement.md` (see `AGENTS.md`, *Layout*). Verify against
> `prisma/schema.prisma` before relying on anything below.
>
> *Checked 2026-10-20: the `InpaintVersion` model and the `prisma.inpaintVersion`
> accessor still exist and are in active use (`src/app/actions/inpaint-versions.ts`),
> so the original conclusion still holds. Only the framing is stale, not the finding.*

**Finding: No code changes required.**

The TS2339 error described in issue #598 does not exist in the current codebase.

- `prisma.inpaintVersion` (singular) — correct Prisma model accessor
- `inpaintVersions` (plural) — schema relation field name

These are distinct: the model accessor is singular by Prisma convention regardless of the relation field name.

**Resolution:** `npm run typecheck` passes with zero errors. The issue description appears to have been based on a stale diagnosis (possibly a missing `prisma generate` after model creation).

No code changes were made.
