# develop Freeze Policy

> **Status (see #1175):** The original Sep 26–27 demo date is stale. Code blockers 2-5 on the demo gate are now closed; remaining items on #1175 are external to this repo (demo date confirmation, fallback PDF regenerated from production on the demo laptop, and a rehearsal-runbook §7 re-run). The freeze will be re-imposed when the next demo date is fixed — until then, normal `develop` workflow applies. This doc is kept as the standing template.

## Overview

**Status:** NOT FROZEN — re-impose when next demo date is confirmed (see #1175)
**Effective (next freeze):** TBD
**Until (next demo):** TBD

Until the next freeze takes effect, normal development workflow applies on `develop`. When the next freeze is announced, the rules below apply for the duration.

## What "Frozen" Means

- No direct commits to `develop`
- No merging into `develop` until the freeze is lifted
- All new work happens on feature branches branched from `develop`

## How to Branch

```bash
# Create a new feature branch from develop
git checkout -b feature/my-feature develop

# Push your branch
git push -u origin feature/my-feature
```

When the freeze lifts, you can merge your branch via PR or direct merge.

## Why This Policy

This freeze ensures the `develop` branch remains in a clean, demo-ready state. The final SHA was deployed to Vercel and verified green before the freeze took effect.

## Lifting the Freeze

The freeze lifts after each demo. Lift by PR or direct merge into `develop`, then resume normal workflow.
