#!/bin/bash
# Nightly Dana regression run (Docker Compose variant).
#
# One command brings up the whole stack, runs a headless Dana session,
# saves a dated report, and tears everything down (including the database).
#
# Required env:
#   UX_PROTO_REPO    path to your staging-studio checkout
#   DANA_RIG         path to this dana-rig directory
#   DANA_REPORTS     directory for dated reports (created if missing)
#   DANA_PHOTO_NAME  filename of the living-room photo inside DANA_PHOTO_DIR
#
# Optional env:
#   DANA_PHOTO_DIR   default: $DANA_RIG/photos (put the photo there)
#   DANA_PULL=1      git pull --ff-only the repo before the run
#   DANA_RUNNER      headless agent command, prompt passed as one arg
#                    default: opencode run
#   GID              your group id (UID is automatic in bash)
#
# Cron example (2:30am daily, machine must be awake, agent authed, docker on):
#   30 2 * * * UX_PROTO_REPO=$HOME/staging-studio DANA_RIG=$HOME/dana-rig \
#     DANA_REPORTS=$HOME/dana-reports DANA_PHOTO_NAME=living-room.jpg \
#     DANA_PULL=1 GID=$(id -g) \
#     bash $HOME/dana-rig/nightly-compose.sh >> $HOME/dana-reports/cron.log 2>&1
set -euo pipefail

: "${UX_PROTO_REPO:?set UX_PROTO_REPO}"; : "${DANA_RIG:?set DANA_RIG}"
: "${DANA_REPORTS:?set DANA_REPORTS}"; : "${DANA_PHOTO_NAME:?set DANA_PHOTO_NAME}"
export UX_PROTO_REPO DANA_RIG
export DANA_PHOTO_DIR="${DANA_PHOTO_DIR:-$DANA_RIG/photos}"
export GID="${GID:-$(id -g)}"
mkdir -p "$DANA_REPORTS" "$DANA_RIG/docker/shots" "$DANA_PHOTO_DIR"

DATE="$(date +%F)"
REPORT="$DANA_REPORTS/dana-$DATE.md"
LOG="$DANA_REPORTS/dana-$DATE.log"

log() { echo "[nightly-compose $(date +%T)] $*" | tee -a "$LOG"; }
cleanup() {
  log "compose down (including db volume)"
  docker compose -f "$DANA_RIG/docker-compose.yml" down -v >>"$LOG" 2>&1 || true
  cd "$UX_PROTO_REPO"
  if [ -n "$(git status --porcelain)" ]; then
    log "WARNING: repo not clean after run:"; git status --porcelain | tee -a "$LOG"
  else
    log "repo clean"
  fi
}
trap cleanup EXIT

log "=== Dana nightly compose run $DATE ==="
if [ "${DANA_PULL:-0}" = "1" ]; then
  git -C "$UX_PROTO_REPO" pull --ff-only >>"$LOG" 2>&1 || log "git pull failed; testing current checkout"
fi

log "bringing up stack (first run builds images + npm ci; a few minutes)"
docker compose -f "$DANA_RIG/docker-compose.yml" up -d --wait >>"$LOG" 2>&1

log "running headless Dana persona session"
PROMPT_TMP="$(mktemp)"
sed -e "s|__PHOTO__|/photos/${DANA_PHOTO_NAME}|g" \
    -e "s|__REPORT__|${REPORT}|g" \
    -e "s|__RIG__|${DANA_RIG}|g" \
    -e "s|__SCREENSHOT_NOTE__|The driver returns screenshot paths like /shots/shot-001.png (inside its container) — read each screenshot on your machine at ${DANA_RIG}/docker/shots/shot-001.png.|" \
  "$DANA_RIG/dana-prompt.md" > "$PROMPT_TMP"
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
    head -5 "$TRIAGE_OUTPUT" | tee -a "$LOG"
  fi
elif [ -f "$REPORT" ]; then
  log "TYPESAFE_API_KEY not set — skipping triage"
fi

log "=== done ==="
