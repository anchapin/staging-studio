#!/bin/bash
# Nightly Dana regression run for StagingStudio.
#
# Brings up the hermetic stack, applies the TEMPORARY test-only bypasses,
# runs one headless Dana persona session via `opencode run`, saves a dated
# report, then tears everything down and reverts the bypasses.
#
# Required env:
#   UX_PROTO_REPO   path to your staging-studio checkout
#   DANA_RIG        path to this dana-rig directory
#   DANA_PHOTO      path to a living-room JPEG for Dana to upload
#   DANA_REPORTS    directory for dated reports (created if missing)
#
# Optional env:
#   DANA_PULL=1            git pull --ff-only the repo before the run
#   DATABASE_URL           default: postgresql://uxproto:uxproto@127.0.0.1:5432/staging_studio_ux
#   UX_PROTO_CHROME_PATH   override for the Playwright Chromium fallback
#
# Cron example (2:30am daily, machine must be awake, opencode authed):
#   30 2 * * * UX_PROTO_REPO=$HOME/staging-studio DANA_RIG=$HOME/dana-rig \
#     DANA_PHOTO=$HOME/dana-rig/living-room.jpg DANA_REPORTS=$HOME/dana-reports \
#     DANA_PULL=1 bash $HOME/dana-rig/nightly.sh >> $HOME/dana-reports/cron.log 2>&1
set -euo pipefail

: "${UX_PROTO_REPO:?set UX_PROTO_REPO}"; : "${DANA_RIG:?set DANA_RIG}"
: "${DANA_PHOTO:?set DANA_PHOTO}"; : "${DANA_REPORTS:?set DANA_REPORTS}"
export UX_PROTO_REPO DANA_RIG
export DATABASE_URL="${DATABASE_URL:-postgresql://uxproto:uxproto@127.0.0.1:5432/staging_studio_ux}"
mkdir -p "$DANA_REPORTS"

DATE="$(date +%F)"
REPORT="$DANA_REPORTS/dana-$DATE.md"
LOG="$DANA_REPORTS/dana-$DATE.log"
PIDS=()

log() { echo "[nightly $(date +%T)] $*" | tee -a "$LOG"; }
cleanup() {
  log "tearing down"
  for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done
  pkill -f "dana-rig/driver.js" 2>/dev/null || true
  cd "$UX_PROTO_REPO"
  git checkout -- src/app/api/inpaint/route.ts src/lib/ai-route-schemas.ts next.config.ts 2>/dev/null || true
  git checkout -- tsconfig.json 2>/dev/null || true
  if [ -n "$(git status --porcelain)" ]; then
    log "WARNING: repo not clean after revert:"; git status --porcelain | tee -a "$LOG"
  else
    log "repo clean"
  fi
}
trap cleanup EXIT

wait_for() { # url, tries
  for _ in $(seq 1 "$2"); do curl -sf -o /dev/null "$1" && return 0; sleep 5; done
  return 1
}

log "=== Dana nightly run $DATE ==="
cd "$UX_PROTO_REPO"
if [ "${DANA_PULL:-0}" = "1" ]; then
  git pull --ff-only 2>&1 | tee -a "$LOG" || log "git pull failed; testing current checkout"
fi

log "applying temporary test-only bypasses"
git apply "$DANA_RIG/mock-fal.patch"
git apply "$DANA_RIG/localhost-allow.patch"

log "starting setup (postgres schema + seed + mock supabase)"
UX_PROTO_REPO="$UX_PROTO_REPO" npx tsx "$DANA_RIG/setup.ts" >>"$LOG" 2>&1 &
PIDS+=($!)
wait_for "http://127.0.0.1:39911/" 24 || { log "mock supabase never came up"; exit 1; }

log "starting next.js dev server"
UX_PROTO_REPO="$UX_PROTO_REPO" bash "$DANA_RIG/start-app.sh" >>"$LOG" 2>&1 &
PIDS+=($!)
wait_for "http://127.0.0.1:39901/login" 36 || { log "app never came up"; exit 1; }

log "starting browser driver relay"
cd "$UX_PROTO_REPO" && node "$DANA_RIG/driver.js" >>"$LOG" 2>&1 &
PIDS+=($!)
sleep 6
if ! kill -0 "${PIDS[-1]}" 2>/dev/null; then log "driver relay died on start"; exit 1; fi

log "running headless Dana persona session"
PROMPT_TMP="$(mktemp)"
sed -e "s|__PHOTO__|${DANA_PHOTO}|g" -e "s|__REPORT__|${REPORT}|g" \
    -e "s|__RIG__|${DANA_RIG}|g" \
    -e "s|__SCREENSHOT_NOTE__|Screenshots the driver saves are returned as /tmp/uxshots/shot-NNN.png — read them at that path on your machine.|" \
  "$DANA_RIG/dana-prompt.md" > "$PROMPT_TMP"
# DANA_RUNNER: how to invoke your headless agent, prompt passed as one arg.
# Default assumes `opencode run "<prompt>"`. Override if yours differs.
# shellcheck disable=SC2086
${DANA_RUNNER:-opencode run} "$(cat "$PROMPT_TMP")" >>"$LOG" 2>&1 || {
  log "persona session exited nonzero (report may still exist)"
}
rm -f "$PROMPT_TMP"

if [ -f "$REPORT" ]; then
  log "report written: $REPORT"
else
  log "WARNING: no report at $REPORT"
fi

# ── Finding triage ──────────────────────────────────────────────────────────
# Classify findings + cross-run dedup against the stored baseline.
# TYPESAFE_API_KEY must be set in the environment or .env.
if [ -f "$REPORT" ] && [ -n "${TYPESAFE_API_KEY:-}" ]; then
  log "running finding triage..."
  TRIAGE_OUTPUT="${REPORT%.md}-triage.md"
  TRIAGE_LOG="${REPORT%.md}-triage.log"
  node "$DANA_RIG/triage.js" "$REPORT" \
    --store-baseline \
    --output "$TRIAGE_OUTPUT" \
    >>"$TRIAGE_LOG" 2>&1 || {
    log "triage failed (see $TRIAGE_LOG)"
  }
  if [ -f "$TRIAGE_OUTPUT" ]; then
    log "triage summary: $TRIAGE_OUTPUT"
    # Print concise summary line to main log
    head -5 "$TRIAGE_OUTPUT" | tee -a "$LOG"
  fi
elif [ -f "$REPORT" ]; then
  log "TYPESAFE_API_KEY not set — skipping triage"
fi

log "=== done ==="
