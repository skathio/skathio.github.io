#!/usr/bin/env bash
# Builds the homepage from the offline fixture, serves dist/ on a free local port, and takes
# full-page screenshots at phone and desktop widths in light and dark mode.
# Usage: .claude/skills/visual-check/screenshots.sh <output-dir>
set -euo pipefail

out="${1:?usage: screenshots.sh <output-dir>}"
root="$(git rev-parse --show-toplevel)"
# Pinned so every run uses the same browser build. Not a repo dependency: npx fetches it on demand.
pw="playwright@1.61.1"

mkdir -p "$out"
cd "$root"
npm run --silent build:fixture

# A free port, so another server already on a common port is never screenshotted by mistake.
port="$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')"
python3 -m http.server "$port" --bind 127.0.0.1 -d dist >"$out/server.log" 2>&1 &
server=$!
trap 'kill "$server" 2>/dev/null || true' EXIT

url="http://127.0.0.1:$port/"
for _ in $(seq 40); do
  if curl -sf "$url" | grep -q '<title>skathio</title>'; then break; fi
  python3 -c 'import time; time.sleep(0.25)'
done
# Fail closed: refuse to screenshot anything that is not this site.
curl -sf "$url" | grep -q '<title>skathio</title>' || { echo "the homepage is not being served at $url" >&2; exit 1; }

for scheme in light dark; do
  npx -y "$pw" screenshot --color-scheme "$scheme" --viewport-size 390,844 --full-page "$url" "$out/phone-$scheme.png" >/dev/null
  npx -y "$pw" screenshot --color-scheme "$scheme" --viewport-size 1440,900 --full-page "$url" "$out/desktop-$scheme.png" >/dev/null
done
ls -1 "$out"/*.png
