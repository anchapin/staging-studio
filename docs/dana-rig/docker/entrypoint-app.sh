#!/bin/bash
# App container entrypoint: install deps (first run only), apply the
# TEMPORARY test-only bypasses, start the Next.js dev server.
# The bypasses are reverted on container stop so the checkout stays clean.
set -euo pipefail
cd /repo

for p in mock-fal localhost-allow; do
  if git apply --check "/rig/$p.patch" >/dev/null 2>&1; then
    git apply "/rig/$p.patch"
    echo "[dana-rig] applied $p.patch (temporary, will revert on stop)"
  fi
done
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
