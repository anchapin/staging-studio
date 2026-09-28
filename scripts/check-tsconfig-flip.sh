#!/usr/bin/env sh
# Guard for issue #219 (root cause #193): fails when the ONLY tsconfig.json change
# (staged or pending) is the flip Next.js applies on every build/dev
# ("jsx": "preserve" -> "react-jsx" plus generated .next include entries).
# Passes when tsconfig.json is unchanged or has any other (legitimate) change.
# Read-only: never modifies tsconfig.json. See AGENTS.md "Toolchain quirks".
set -eu

if ! git rev-parse --verify HEAD >/dev/null 2>&1; then
  exit 0
fi

diff_output=$(git diff HEAD -- tsconfig.json || true)

if [ -z "$diff_output" ]; then
  exit 0
fi

remaining=$(
  printf '%s\n' "$diff_output" | awk '
    /^diff |^index |^---|^\+\+\+|^@@/ { next }
    /^[+-]/ {
      line = substr($0, 2)
      gsub(/^[ \t]+/, "", line)
      gsub(/[ \t,]+$/, "", line)
      # documented jsx flip
      if (line ~ /^"jsx": "(preserve|react-jsx)"$/) next
      # generated include entries Next manages (.next/types, .next/dev/types)
      if (line ~ /^"\.next\/.*\.ts"$/) next
      print
    }
  '
)

if [ -z "$remaining" ]; then
  {
    echo "check-tsconfig-flip: FAIL — the only tsconfig.json change is the Next.js build flip"
    echo '  ("jsx": "preserve" -> "react-jsx" and/or .next include entries).'
    echo "  This is generated on every next build/next dev and must NOT be committed."
    echo "  Revert it before committing:  git checkout -- tsconfig.json"
    echo "  See AGENTS.md \"Toolchain quirks\" (root cause #193, guard #219)."
  } >&2
  exit 1
fi

exit 0
