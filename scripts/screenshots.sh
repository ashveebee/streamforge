#!/usr/bin/env bash
# Re-creates the README screenshots from the demo data.
#
#   npm run demo                 # in one terminal
#   ./scripts/screenshots.sh     # in another
#
# Needs Google Chrome (or set CHROME=/path/to/chrome), plus sips (macOS) or
# ImageMagick to compress. Images are written to docs/screenshots as 2x JPEGs.
# Extra Chrome flags go in CHROME_FLAGS (e.g. --no-sandbox when running as root).
set -euo pipefail

URL="${DEMO_URL:-http://localhost:5173}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/docs/screenshots"
CHROME="${CHROME:-}"
if [[ -z "$CHROME" ]]; then
  for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" google-chrome google-chrome-stable chromium chromium-browser; do
    if command -v "$c" >/dev/null 2>&1 || [[ -x "$c" ]]; then CHROME="$c"; break; fi
  done
fi
[[ -n "$CHROME" ]] || { echo "Chrome not found; set CHROME=/path/to/chrome" >&2; exit 1; }
curl -sf "$URL/api/auth/me" >/dev/null || { echo "Demo not running at $URL — start it with: npm run demo" >&2; exit 1; }

mkdir -p "$OUT"
PROFILE="$(mktemp -d)"
trap 'rm -rf "$PROFILE"' EXIT

shot() { # name path width,height
  # shellcheck disable=SC2086
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --user-data-dir="$PROFILE" ${CHROME_FLAGS:-} \
    --window-size="$3" --force-device-scale-factor=2 --force-prefers-reduced-motion \
    --virtual-time-budget=20000 --screenshot="$PROFILE/$1.png" "$URL$2" >/dev/null 2>&1
  if command -v sips >/dev/null; then
    sips -s format jpeg -s formatOptions 82 "$PROFILE/$1.png" --out "$OUT/$1.jpg" >/dev/null
  elif command -v magick >/dev/null; then
    magick "$PROFILE/$1.png" -quality 82 "$OUT/$1.jpg"
  else
    convert "$PROFILE/$1.png" -quality 82 "$OUT/$1.jpg"
  fi
  echo "  ✓ $1.jpg"
}

echo "Capturing screenshots from $URL"
shot dashboard   /            1440,900
shot now-playing /now-playing 1440,900
shot system      /system      1440,1100
shot stats       /stats       1440,1100
shot library     /library     1440,900
shot jellyfin    /jellyfin    1440,900
shot sonarr      /sonarr      1440,1700
shot seerr       /seerr       1440,900
shot infinidisk  /infinidisk  1440,900
shot settings    /settings    1440,1000
shot downloads   /downloads   1440,1100
shot me          /me          1440,1600
shot digest      /digest      1440,1100
shot rules       /rules       1440,900
shot audit       /audit       1440,900
shot bazarr      /bazarr      1440,1100
echo "Saved to $OUT"
