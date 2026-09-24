#!/usr/bin/env bash
# Dev tunnel helper — exposes the local dev server through a public URL so
# Browserless.io's cloud Chrome can fetch the lookbook preview page for PDF
# export (docs/DEPLOYMENT.md § "The one thing to get right"). Without it,
# api/export-pdf builds a http://localhost:3000 preview URL that Browserless
# rejects with 403 "Navigation to ... is not allowed" (private-URL blocklist).
#
# Usage:
#   scripts/dev-tunnel.sh                  # auto-detect: cloudflared, else ngrok
#   scripts/dev-tunnel.sh --tool ngrok     # force a specific tool
#   scripts/dev-tunnel.sh --port 3000      # local port (default 3000; auto-verified
#                                           # to be a Next.js app — e.g. pass --port 3001
#                                           # when Grafana or similar holds 3000)
#   scripts/dev-tunnel.sh reset            # restore NEXT_PUBLIC_APP_URL=http://localhost:3000
#
# Prerequisites: cloudflared (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
# or ngrok (https://ngrok.com/download; free account + `ngrok config add-authtoken ...`).
# After this script rewrites .env.local you MUST restart `npm run dev` —
# NEXT_PUBLIC_* variables are read at server boot (and inlined at build time).

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env.local"
ENV_KEY="NEXT_PUBLIC_APP_URL"
LOCAL_DEFAULT="http://localhost:3000"

TOOL="auto"
PORT="3000"

usage() {
  sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --tool)  [ $# -ge 2 ] || usage; TOOL="$2"; shift 2 ;;
    --port)  [ $# -ge 2 ] || usage; PORT="$2"; shift 2 ;;
    reset)   shift; [ $# -eq 0 ] || usage; do_reset=1; break ;;
    -h|--help) usage ;;
    *)       printf 'Unknown argument: %s\n\n' "$1" >&2; usage ;;
  esac
done

fail() { printf '[FAIL] %s\n' "$1" >&2; exit 1; }
info() { printf '  %s\n' "$1"; }

# --- reset mode: put the env var back to the plain dev default -------------
if [ "${do_reset:-0}" -eq 1 ]; then
  [ -f "$ENV_FILE" ] || fail "$ENV_FILE not found — nothing to reset."
  if grep -q "^${ENV_KEY}=" "$ENV_FILE"; then
    sed -i "s|^${ENV_KEY}=.*|${ENV_KEY}='${LOCAL_DEFAULT}'|" "$ENV_FILE"
    info "Reset ${ENV_KEY} to '${LOCAL_DEFAULT}' in .env.local"
    info 'Restart "npm run dev" if it is running (env is read at boot).'
  else
    fail "No ${ENV_KEY} line in $ENV_FILE — nothing to reset."
  fi
  exit 0
fi

# --- preflight --------------------------------------------------------------
[ -f "$ENV_FILE" ] || fail ".env.local not found. Copy .env.example first (see README § Getting Started)."

if [ "$TOOL" = "auto" ]; then
  if command -v cloudflared > /dev/null 2>&1; then TOOL="cloudflared"
  elif command -v ngrok > /dev/null 2>&1; then TOOL="ngrok"
  else
    fail 'Neither cloudflared nor ngrok found. Install one of:
  cloudflared:  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
  ngrok:        https://ngrok.com/download (free account, then: ngrok config add-authtoken <token>)'
  fi
else
  command -v "$TOOL" > /dev/null 2>&1 || fail "--tool $TOOL requested but not installed."
fi

# --- the tunnel must point at THIS app, not whatever grabbed port 3000 -----
# Grafana (and other dashboards) default to port 3000, and `next dev` silently
# falls back to 3001 when 3000 is taken — a tunnel into the wrong service
# exports that service's login page as the "lookbook" PDF.
port_owner() {
  curl -sI --max-time 3 "http://localhost:$1/" 2>/dev/null | tr -d '\r' | grep -i '^x-powered-by:' || true
}
is_next() {
  case "$(port_owner "$1")" in *[Nn]ext*) return 0 ;; *) return 1 ;; esac
}

if ! is_next "$PORT"; then
  owner="$(port_owner "$PORT")"
  alt=""
  for p in 3000 3001 3002 3003 3004 3005; do
    [ "$p" = "$PORT" ] && continue
    if is_next "$p"; then alt="$p"; break; fi
  done
  if [ -n "$alt" ]; then
    fail "localhost:$PORT is not your Next.js dev server (answered: ${owner:-not Next.js}). The dev server appears to be on port $alt instead — re-run: scripts/dev-tunnel.sh --port $alt"
  elif [ -n "$owner" ]; then
    fail "localhost:$PORT answered (${owner}) but is not a Next.js app — refusing to tunnel the wrong service. Find your dev server's port and pass --port N."
  else
    printf '  [WARN] nothing Next-like is listening on http://localhost:%s yet — start "npm run dev" (the tunnel will 502 until then).\n' "$PORT"
  fi
fi

# --- start the tunnel and discover its public URL ---------------------------
LOG="$(mktemp)"
TUNNEL_PID=""

cleanup() {
  if [ -n "$TUNNEL_PID" ]; then
    kill "$TUNNEL_PID" 2> /dev/null || true
    printf '\n  Tunnel stopped. %s still points at the (now dead) tunnel URL in .env.local.\n' "$ENV_KEY"
    printf '  Run "scripts/dev-tunnel.sh reset" to restore %s, or re-run this script for a fresh URL.\n' "'$LOCAL_DEFAULT'"
  fi
  rm -f "$LOG"
}
trap cleanup EXIT
trap 'exit 1' INT TERM

printf 'Starting %s tunnel for http://localhost:%s ...\n' "$TOOL" "$PORT"

url=""
if [ "$TOOL" = "cloudflared" ]; then
  cloudflared tunnel --url "http://localhost:$PORT" --no-autoupdate > "$LOG" 2>&1 &
  TUNNEL_PID=$!
  for _ in $(seq 1 30); do
    url="$(grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' "$LOG" 2>/dev/null | head -n1 || true)"
    [ -n "$url" ] && break
    kill -0 "$TUNNEL_PID" 2> /dev/null || fail "cloudflared exited early:\n$(tail -n 15 "$LOG")"
    sleep 1
  done
elif [ "$TOOL" = "ngrok" ]; then
  ngrok http "$PORT" --log stdout > "$LOG" 2>&1 &
  TUNNEL_PID=$!
  for _ in $(seq 1 30); do
    body="$(curl -s --max-time 2 http://127.0.0.1:4040/api/tunnels 2>/dev/null || true)"
    url="$(printf '%s' "$body" | grep -oE '"public_url":"https://[^"]+"' | head -n1 | sed 's/^"public_url":"//; s/"$//' || true)"
    [ -n "$url" ] && break
    kill -0 "$TUNNEL_PID" 2> /dev/null || fail "ngrok exited early (auth token set?):\n$(tail -n 15 "$LOG")"
    sleep 1
  done
fi
[ -n "$url" ] || fail "could not discover the tunnel URL within 30s:\n$(tail -n 15 "$LOG")"

# --- point the app at it -----------------------------------------------------
if grep -q "^${ENV_KEY}=" "$ENV_FILE"; then
  sed -i "s|^${ENV_KEY}=.*|${ENV_KEY}='${url}'|" "$ENV_FILE"
else
  printf "\n%s='%s'\n" "$ENV_KEY" "$url" >> "$ENV_FILE"
fi

printf 'Tunnel URL: %s\n' "$url"
info "Updated ${ENV_KEY} in .env.local"
info 'RESTART "npm run dev" now — the var is read at server boot.'
info "Sanity check (expect HTTP 200): curl -s -o /dev/null -w '%{http_code}\\n' ${url}/login"
info "Keep this terminal open; Ctrl+C stops the tunnel."
info "The URL rotates on every run — after a restart, re-run this script."

wait "$TUNNEL_PID"
