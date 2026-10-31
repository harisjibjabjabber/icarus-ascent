#!/usr/bin/env bash
# (Re)start the static server for dist/ and a Cloudflare quick tunnel to it.
# Usage: scripts/serve-public.sh   -> prints the public URL (also in /tmp/icarus-tunnel.url)
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=${PORT:-8080}
pkill -f "http.server $PORT" 2>/dev/null || true
pkill -f "cloudflared tunnel --url" 2>/dev/null || true
[ -d dist ] || npm run build
nohup python3 -m http.server "$PORT" --bind 127.0.0.1 --directory dist > /tmp/icarus-static.log 2>&1 &
sleep 1
nohup "$HOME/bin/cloudflared" tunnel --no-autoupdate --url "http://localhost:$PORT" > /tmp/icarus-tunnel.log 2>&1 &
for i in $(seq 1 40); do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/icarus-tunnel.log | head -1 || true)
  [ -n "$URL" ] && break
  sleep 1
done
echo "${URL:-no-url-yet (see /tmp/icarus-tunnel.log)}" | tee /tmp/icarus-tunnel.url
