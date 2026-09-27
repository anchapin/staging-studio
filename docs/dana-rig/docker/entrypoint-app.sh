#!/bin/bash
# App container entrypoint: install deps (first run only), apply the
# TEMPORARY test-only bypasses, start the Next.js dev server.
# The bypasses are reverted on container stop so the checkout stays clean.
set -euo pipefail
cd /repo

# The /repo mount is the project's worktree. The worktree's `.git`
# file points to a parent-repo gitdir that isn't reachable from inside
# this container, so `git apply --check` exits non-zero with "fatal: not
# a git repository" on a fresh checkout. We tolerate that and fall
# through to the manual sed replacements below so the patches still
# apply. (For local `npm run dev` outside Docker, `git apply` works
# because the parent repo IS reachable from the host filesystem.)
PATCHES_APPLIED=()
for p in mock-fal localhost-allow; do
  if git apply --check "/rig/$p.patch" >/dev/null 2>&1; then
    if git apply "/rig/$p.patch"; then
      echo "[dana-rig] applied $p.patch via git apply"
      PATCHES_APPLIED+=("$p")
    fi
  else
    echo "[dana-rig] git apply unavailable (worktree gitdir unreachable from container); falling back to inline sed for $p.patch"
  fi
done

# Fallback / complement: apply the localhost-allow.patch changes inline
# via a node script so the rig still works even when git is broken in the
# container. Each change is a tiny, surgical file edit; the script is
# idempotent (only fires when the marker isn't already present) so
# re-applying on top of an already-patched /repo doesn't insert
# duplicates. We use node here instead of sed because the mock-pattern
# insertion is structurally tricky (a naive "insert after hostname:
# 127.0.0.1" lands inside that block's closing brace, producing
# invalid TS — verified the hard way).
node -e "
const fs = require('fs');
let s = fs.readFileSync('next.config.ts', 'utf8');
let changed = false;

if (!s.includes('allowedDevOrigins')) {
  s = s.replace(
    'const nextConfig: NextConfig = {',
    'const nextConfig: NextConfig = {\n  allowedDevOrigins: [\"web\", \"127.0.0.1\", \"localhost\"],'
  );
  changed = true;
}

if (!/hostname: \"mock\"/.test(s)) {
  // Anchor on the closing brace of the 127.0.0.1 block — that's the
  // structural gap between 127.0.0.1 and localhost, where the mock
  // entry genuinely belongs.
  s = s.replace(
    /(hostname: \"127\\.0\\.0\\.1\",\n      \},)/,
    '\$1\n      {\n        protocol: \"http\",\n        hostname: \"mock\",\n      },'
  );
  changed = true;
}

if (!s.includes('http://mock:* http://web:*')) {
  s = s.replace(
    'wss://*.supabase.co;',
    'wss://*.supabase.co http://mock:* http://web:* http://127.0.0.1:* ws://mock:* ws://web:* ws://127.0.0.1:*;'
  );
  changed = true;
}

if (!s.includes(\"form-action 'self' http://mock\")) {
  s = s.replace(
    \"form-action 'self'; upgrade-insecure-requests\",
    \"form-action 'self' http://mock:* http://web:* http://127.0.0.1:*; upgrade-insecure-requests\"
  );
  changed = true;
}

if (changed) {
  fs.writeFileSync('next.config.ts', s);
  console.log('[dana-rig] applied next.config.ts patches (idempotent node script)');
} else {
  console.log('[dana-rig] next.config.ts already patched (no changes needed)');
}
" || echo "[dana-rig] WARNING: node idempotent patch script failed"

# Belt and suspenders: if a previous container left /repo in a broken
# state (e.g. partial patch + Next.js cached a syntax-error parse), clear
# .next so the freshly-patched next.config.ts is what Next actually loads.
# `.next` is the docker volume `app-next-data`, so a simple rm may
# fail with "Device or resource busy"; fall through if so and let
# Next rebuild it.
rm -rf .next 2>/dev/null && echo "[dana-rig] cleared .next cache before server start" || echo "[dana-rig] .next is mounted (skipping clear)"

revert() {
  git checkout -- src/app/api/inpaint/route.ts src/lib/ai-route-schemas.ts next.config.ts tsconfig.json 2>/dev/null || true
  echo "[dana-rig] reverted temporary patches"
}

if [ ! -x node_modules/.bin/next ]; then
  echo "[dana-rig] installing dependencies (first run only, a few minutes)..."
  npm ci --no-audit --no-fund
fi
npx prisma generate

# Remove stale dev locks from interrupted container runs
rm -f .next/dev/lock

# Run next directly (not via npm) so SIGTERM reaches the server process.
node_modules/.bin/next dev --port 39901 --hostname 0.0.0.0 &
SERVER_PID=$!
shutdown() {
  kill -TERM "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
  revert
  exit 0
}
trap shutdown TERM INT
wait "$SERVER_PID"
revert
