# develop Freeze Policy

## Overview

**Status:** FROZEN
**Effective:** Thu Sep 24 evening (after final push)
**Until:** Post-demo (Sep 26–27)

The `develop` branch is frozen and will remain untouched until after the demo is complete. All further work branches from `develop`, not directly to it.

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

The freeze will be lifted after the demo (Sep 26–27). After that, normal development workflow resumes on `develop`.
