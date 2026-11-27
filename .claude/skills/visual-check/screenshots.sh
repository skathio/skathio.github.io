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

# The deploy's site-kit step copies hashira's kit into dist/_kit/; the fixture build does not, so
# copy the same files here from a local hashira clone, at the v3 tag the deploy uses. Without them
# the <site-nav> never renders and the shots would not show the real nav.
hashira="${HASHIRA_DIR:-$root/../hashira}"
# v3 is a moving tag: fetch it (forced, since a moved tag is refused otherwise) so the kit is the
# one the deploy uses now, not whatever the clone last saw.
git -C "$hashira" fetch -q --tags --force origin \
  || { echo "could not fetch hashira's tags into $hashira (set HASHIRA_DIR)" >&2; exit 1; }
mkdir dist/_kit
for f in tokens.css theme.js site-nav.js; do
  git -C "$hashira" show "v3:.github/actions/site-kit/kit/$f" > "dist/_kit/$f" \
    || { echo "no hashira clone with a v3 tag at $hashira (set HASHIRA_DIR)" >&2; exit 1; }
done

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

# The kit sets `ready` on <site-nav> after its first render, so the shots show the real nav.
ready='site-nav[ready]'
for scheme in light dark; do
  npx -y "$pw" screenshot --wait-for-selector "$ready" --color-scheme "$scheme" --viewport-size 390,844 --full-page "$url" "$out/phone-$scheme.png" >/dev/null
  npx -y "$pw" screenshot --wait-for-selector "$ready" --color-scheme "$scheme" --viewport-size 1280,800 --full-page "$url" "$out/desktop-$scheme.png" >/dev/null
done
ls -1 "$out"/*.png
