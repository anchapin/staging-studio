#!/bin/bash
# Starts the staging-studio dev server for the UX prototype.
# Set UX_PROTO_REPO to your staging-studio checkout (defaults below).
# Run after setup.ts is up (mock supabase + seeded db).
set -euo pipefail
cd "${UX_PROTO_REPO:-/home/hatch/workspace/staging-studio}"

export DATABASE_URL="${DATABASE_URL:-postgresql://uxproto:uxproto@127.0.0.1:5432/staging_studio_ux}"
export NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:39911"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="uxproto-anon-key"
export OPENAI_API_KEY="uxproto-dummy"
export FAL_KEY="uxproto-dummy"
export BROWSERLESS_API_KEY="uxproto-dummy"
export NEXT_PUBLIC_APP_URL="http://127.0.0.1:39901"
export PREVIEW_TOKEN_SECRET="uxproto-dev-secret-not-real"
export UX_PROTO_MOCK_FAL="1"
export UX_PROTO_MOCK_RESULT_URL="http://127.0.0.1:39911/storage/v1/object/public/staged-results/e2e-staged.png"

exec npm run dev -- --port 39901 --hostname 127.0.0.1
