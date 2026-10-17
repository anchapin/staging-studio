#!/usr/bin/env bash
# Enable the committed pre-commit hook for this clone (#219, #1095).
#
# Runs from the `prepare` lifecycle script, so a fresh `git clone` +
# `npm install` is protected without anyone having to know a manual git
# config step exists. The guard it activates blocks committing the tsconfig
# `jsx` flip that Next.js forces on every build/dev (#193) — a flip that
# `tsc` accepts either way and that `ci.yml` does not check for, so
# without this it can reach `main` silently.
#
# Design constraints, all of them learned the hard way:
#
# - MUST exit 0 always. `prepare` runs during `npm ci` too, including in
#   Docker builds and CI, where there may be no `.git`, a read-only
#   filesystem, or no working `git config`. An install must never fail
#   because of a convenience side effect.
# - MUST NOT clobber an existing `core.hooksPath`. A user with a global
#   hooksPath (or one pointing somewhere intentional) keeps it; we only
#   fill in the case where the value is simply absent.
# - MUST be idempotent. `npm install` runs repeatedly.
# - MUST NOT depend on its own executable bit, so `prepare` invokes it via
#   `bash scripts/...` rather than executing it directly.

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"

# Not a git checkout (e.g. a published tarball, a Docker layer, a vendored
# copy). Nothing to configure.
if [ -z "$REPO_ROOT" ] || [ ! -e "$REPO_ROOT/.git" ]; then
  exit 0
fi

HOOK_DIR=".githooks"
HOOK="$HOOK_DIR/pre-commit"

# No committed hook to point at (a partial checkout, or the file moved).
if [ ! -f "$REPO_ROOT/$HOOK" ]; then
  exit 0
fi

cd "$REPO_ROOT" || exit 0

# The mode bit is load-bearing: git silently skips a non-executable hook,
# with only a hint. That is exactly how this guard stayed inert for #219.
# Checked on both the already-correct and the just-enabled path, because a
# checkout on a filesystem that does not carry the exec bit (NTFS without
# `core.fileMode` support) can arrive with the path already right and the
# hook still unusable.
warn_if_not_executable() {
  if [ -x "$REPO_ROOT/$HOOK" ]; then
    return 0
  fi
  echo "[hooks] $HOOK is not executable — git will SKIP it, so the guard is inert."
  echo "[hooks] Fix with: chmod +x $HOOK && git add --chmod=+x $HOOK"
}

# Already correct? Succeed quietly, but still check the mode bit.
# Comparison is loose because a global hooksPath may be an absolute path
# to this same directory.
current="$(git config --get core.hooksPath 2>/dev/null || true)"
case "$current" in
  "$HOOK_DIR"|*/"$HOOK_DIR"|./*/".githooks")
    warn_if_not_executable
    exit 0
    ;;
  "")
    : # unset — the case we exist to fix
    ;;
  *)
    # Someone set this deliberately, globally or locally. Respect it.
    echo "[hooks] core.hooksPath is '$current' — leaving it alone."
    echo "[hooks] To use this repo's pre-commit guard instead:"
    echo "[hooks]   git config core.hooksPath $HOOK_DIR"
    exit 0
    ;;
esac

if ! git config core.hooksPath "$HOOK_DIR" 2>/dev/null; then
  # Read-only config, exotic sandbox, etc. Never fail the install.
  echo "[hooks] could not set core.hooksPath (non-fatal)."
  echo "[hooks] enable the guard manually with:"
  echo "[hooks]   git config core.hooksPath $HOOK_DIR"
  exit 0
fi

echo "[hooks] enabled pre-commit guard (core.hooksPath=$HOOK_DIR)."
warn_if_not_executable

exit 0
