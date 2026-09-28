#!/usr/bin/env bash
# Release guard: fail if BASE carries non-merge commits that HEAD lacks.
#
#   scripts/check-develop-catchup.sh [BASE] [HEAD]     (defaults: origin/main origin/develop)
#
# Why this exists
# ---------------
# `main` is the Production branch; `develop` is where work is done. Nothing
# in the normal flow forces a commit that reaches `main` to also reach
# `develop`, so a hotfix merged straight to `main` leaves `develop` behind.
#
# The failure is not that the hotfix is LOST -- merging develop into main
# preserves main's commits. The failure is that `develop` becomes a
# self-consistent but STALE branch: its code and its tests agree with each
# other, and both disagree with what actually ships. That surfaces as test
# failures at release-merge time, when the two sides are combined and the
# older expectations are measured against newer code.
#
# That is not hypothetical. Before the #1097 release, `main` held four
# production hotfixes (#1043, #1044, #1045, #1018) that `develop` had never
# seen. #1018 renamed a response header, so the merge surfaced three failing
# e2e tests: develop's spec asserted the old header name, and main's code no
# longer emitted it. The fixes were in the release; the stale expectations
# were the problem.
#
# Merge commits are excluded deliberately. Every develop->main release makes
# `main` gain a merge commit that `develop` can never have, so including them
# would make this check fail immediately after every successful release.
# Hotfixes land as ordinary commits, which is exactly what must be caught.
#
# Fix when this fails: back-merge main into develop (open a PR from main to
# develop, or merge main into your develop branch) so develop absorbs the
# hotfixes, THEN cut the release.

set -euo pipefail

BASE="${1:-origin/main}"
HEAD="${2:-origin/develop}"

if ! git rev-parse --verify --quiet "$BASE" >/dev/null; then
  echo "check-develop-catchup: ref '$BASE' not found — run 'git fetch origin' first." >&2
  exit 2
fi
if ! git rev-parse --verify --quiet "$HEAD" >/dev/null; then
  echo "check-develop-catchup: ref '$HEAD' not found — run 'git fetch origin' first." >&2
  exit 2
fi

missing="$(git log --oneline --no-merges "$HEAD".."$BASE")"

if [ -z "$missing" ]; then
  echo "check-develop-catchup: OK — $HEAD contains every non-merge commit on $BASE."
  exit 0
fi

count="$(printf '%s\n' "$missing" | wc -l | tr -d ' ')"
{
  echo "check-develop-catchup: FAILED — $BASE has $count non-merge commit(s) that $HEAD lacks:"
  echo
  printf '%s\n' "$missing" | sed 's/^/    /'
  echo
  echo "Releasing from $HEAD right now would combine newer code on $BASE with"
  echo "expectations written against older code, which is how the #1097 release"
  echo "surfaced three failing e2e tests."
  echo
  echo "Fix: back-merge $BASE into $HEAD first (PR from $BASE to $HEAD, or"
  echo "'git merge $BASE' on a $HEAD-based branch), then cut the release."
} >&2

exit 1
