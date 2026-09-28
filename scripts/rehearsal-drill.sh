#!/usr/bin/env bash
# Rehearsal drill helper — issue #163 (docs/demo/rehearsal-runbook.md §6)
# Runs the assertions that CAN be automated. Physical checks (paper, mouse,
# bookmarks, screen lock) stay human. Required failures exit non-zero;
# warnings never fail the run.

set -u

PROD_URL="${PROD_URL:-https://staging-studio-kappa.vercel.app}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEMO_ASSETS_DIR="${DEMO_ASSETS_DIR:-}"
if [ -z "$DEMO_ASSETS_DIR" ]; then
  dir="$REPO_ROOT"
  for _ in 1 2 3 4; do
    if [ -d "${dir%/}/demo-assets" ]; then DEMO_ASSETS_DIR="${dir%/}/demo-assets"; break; fi
    dir="${dir%/*}"
  done
fi
DEMO_ASSETS_DIR="${DEMO_ASSETS_DIR:-$REPO_ROOT/demo-assets}"
FALLBACK_PDF="${DEMO_ASSETS_DIR%/}/fallback-lookbook.pdf"

failures=0
pass() { printf '  [PASS] %s\n' "$1"; }
fail() { printf '  [FAIL] %s\n' "$1"; failures=$((failures + 1)); }
warn() { printf '  [WARN] %s\n' "$1"; }

echo "Rehearsal drill assertions"
echo "PROD_URL:   $PROD_URL"
echo "Fallback:   $FALLBACK_PDF"
echo

echo "1. Production URL reachable"
code="$(curl -sS -L -o /dev/null -w '%{http_code}' --max-time 20 "$PROD_URL" 2>/dev/null)"
if [ -n "$code" ] && [ "$code" -ge 200 ] 2>/dev/null && [ "$code" -lt 400 ] 2>/dev/null; then
  pass "root responds HTTP $code"
else
  fail "root unreachable or bad status (got: ${code:-none})"
fi

code="$(curl -sS -L -o /dev/null -w '%{http_code}' --max-time 20 "$PROD_URL/login" 2>/dev/null)"
if [ -n "$code" ] && [ "$code" -ge 200 ] 2>/dev/null && [ "$code" -lt 400 ] 2>/dev/null; then
  pass "/login responds HTTP $code"
else
  fail "/login unreachable or bad status (got: ${code:-none})"
fi

echo "2. Pre-exported fallback PDF"
if [ -f "$FALLBACK_PDF" ]; then
  pass "exists on disk"
  magic="$(head -c 4 "$FALLBACK_PDF" 2>/dev/null)"
  if [ "$magic" = "%PDF" ]; then
    pass "starts with %PDF magic bytes"
  else
    fail "not a PDF (first bytes: ${magic:-none})"
  fi
  size="$(wc -c < "$FALLBACK_PDF" 2>/dev/null | tr -d ' ')"
  if [ -n "$size" ] && [ "$size" -gt 10000 ] 2>/dev/null; then
    pass "non-trivial size ($size bytes)"
  else
    warn "suspiciously small ($size bytes) — re-export per runbook §5"
  fi
else
  fail "missing — export it per runbook §5"
fi

echo "3. Laptop battery (warn-only)"
found_bat=0
for bat in /sys/class/power_supply/BAT*; do
  [ -d "$bat" ] || continue
  found_bat=1
  status="$(cat "$bat/status" 2>/dev/null)"
  capacity="$(cat "$bat/capacity" 2>/dev/null)"
  if [ "$status" = "Charging" ] || [ "$status" = "Full" ] || [ "$status" = "Not charging" ]; then
    pass "power source OK ($status, ${capacity:-?}%)"
  elif [ -n "$capacity" ] && [ "$capacity" -ge 90 ] 2>/dev/null; then
    pass "discharging but ≥90% ($capacity%)"
  else
    warn "$status at ${capacity:-?}% — plug in before the run"
  fi
done
[ "$found_bat" -eq 0 ] && warn "no battery detected (desktop?) — verify power manually"

echo "4. Printer via CUPS (warn-only)"
if command -v lpstat > /dev/null 2>&1; then
  printers="$(lpstat -p -d 2>/dev/null)"
  if [ -n "$printers" ]; then
    pass "CUPS reports printers:"
    printf '%s\n' "$printers" | sed 's/^/         /'
  else
    warn "CUPS present but no printers detected — verify manually"
  fi
else
  warn "lpstat not found — verify printer manually (runbook §1)"
fi

echo
if [ "$failures" -eq 0 ]; then
  echo "RESULT: PASS — required checks green; clear warnings before the run."
  exit 0
else
  echo "RESULT: FAIL — $failures required check(s) failed. Fix before rehearsing."
  exit 1
fi
