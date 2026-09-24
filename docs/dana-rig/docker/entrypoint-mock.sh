#!/bin/bash
set -euo pipefail
# Forward the mock (127.0.0.1:39911 inside this container) to 0.0.0.0:39912
# so the app and browser-driver containers can reach it.
socat TCP-LISTEN:39912,bind=0.0.0.0,fork,reuseaddr TCP:127.0.0.1:39911 &
exec tsx /rig/run-mock.ts
