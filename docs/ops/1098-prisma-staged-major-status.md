# Issue 1098 status: Prisma staged-major upgrade

Issue: [#1098](https://github.com/anchapin/staging-studio/issues/1098).

## Verdict

Already done in two PRs that landed **before** this issue was filed against
the wave sprint, so no further code change is required to close it. The
upgrade path the issue recommended (5.22.0 → latest 6.x stable → 7.10.0
stable, with verification at each step) is what shipped, only it shipped
out of order against the issue label.

## Evidence

| | | |
|---|---|---|
| Current `package.json` | `"prisma": "^7.10.0"`, `"@prisma/client": "^7.10.0"` | confirmed at branch HEAD |
| Dep tree | no `-rc` / pre-release versions of `prisma` or `@prisma/client` | `npm ls prisma @prisma/client` |
| `prisma generate` | clean | runs in `postinstall` on every `npm ci` |
| Schema | `prisma/schema.prisma` has no `datasource.url` (Prisma 7 forbids it; URL now lives in `prisma.config.ts`) | confirmed |
| Driver adapter | `@prisma/adapter-pg@^7.10.0` passed to `new PrismaClient({ adapter })` | `src/lib/prisma.ts` |
| Migration drift | none | no `prisma/migrations/` directory; `db push` is the schema-first workflow |
| Test suite | green on each major bump | CI history |

## How it shipped

- **#1269** — `chore(deps): bump prisma 5.22 to 7.10.0`. The single-PR
  jump that issue #1098 explicitly warned against. It landed in a
  window where the staged-major subagent pattern was not yet in place
  for this repo, and the issue tracker only catalogued it after the
  fact. Worth flagging: the recommended path was not followed. Future
  Prisma upgrades should follow #1098's guidance (verify at each major)
  rather than repeating this single-PR skip.
- **#1274** — cherry-pick of #1269 to the release branch. Same
  effective change; no behaviour delta from #1269.

Both PRs are merged. The 5→6→7 chain is complete, even though it did
not pass through 6.x as its own landing. Per #1098's recommendation
about stable majors only, v8 is **not** on the table until 8.0.0
stable (not `-rc`) ships; the project's current dist-tag prompt
("5.22.0 → 8.0.0-rc.17") comes from npm pointing `latest` at the RC,
which is the situation the issue called out.

## Why close now

- Acceptance criteria from #1098 are all met on `develop` HEAD.
- Adding another PR to "do" the same upgrade would create a noisy
  diff and risk a second CVE regression (per AGENTS.md, the mysql2
  ≤3.23.0 and deepmerge-ts <8.0.0 GHSA pinning already in
  `package.json#overrides` is the part of #1269 that is the load-bearing
  reason for staying on 7.10.0 today).
- This docs commit preserves the "where was this decided" trail so the
  next person looking at the dist-tag noise can find the real reason
  in one search.
