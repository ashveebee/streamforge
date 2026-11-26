#!/usr/bin/env bash
# Re-creates the README and website screenshots from the demo data. Start the
# demo in one terminal and run this in another, once per demo mode:
#
#   npm run demo                    ./scripts/screenshots.sh         # Jellyfin household
#   DEMO_MAIN=plex npm run demo     ./scripts/screenshots.sh plex    # Plex-only household
#   DEMO_MAIN=emby npm run demo     ./scripts/screenshots.sh emby    # Emby-only household
#   DEMO_SETUP=1 npm run demo       ./scripts/screenshots.sh setup   # first run, step 1
#   DEMO_APPS=1 npm run demo        ./scripts/screenshots.sh apps    # first run, step 2
#
# (setup-plex.jpg and setup-emby.jpg need clicks, so they're captured by hand:
#  DEMO_SETUP=1 DEMO_MAIN=plex, pick Plex and click Sign in with Plex.)
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
MODE="${1:-all}"
curl -s -o /dev/null "$URL/api/auth/server" || { echo "Demo not running at $URL — start it with: npm run demo" >&2; exit 1; }

mkdir -p "$OUT"
PROFILE="$(mktemp -d)"
trap 'rm -rf "$PROFILE"' EXIT

shot() { # name path width,height [scale]
  # shellcheck disable=SC2086
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --user-data-dir="$PROFILE" ${CHROME_FLAGS:-} \
    --window-size="$3" --force-device-scale-factor="${4:-2}" --force-prefers-reduced-motion \
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

echo "Capturing $MODE screenshots from $URL"
case "$MODE" in
  all)
    shot dashboard   /            1440,900
    shot now-playing /now-playing 1440,900
    shot system      /system      1440,1100
    shot stats       /stats       1440,1100
    shot history     /history     1440,1000
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
    shot buffering   /now-playing/buffering 1440,900
    shot title       /media/movie/1000 1440,1300
    shot title-tv    /media/tv/1013    1440,1300
    # Phone-sized, for the website's "in your pocket" section.
    shot phone-dashboard   /                 390,844 3
    shot phone-now-playing /now-playing      390,844 3
    shot phone-title       /media/tv/1013    390,844 3
    ;;
  plex)
    shot plex-only /     1440,900
    shot plex      /plex 1440,900
    ;;
  emby)
    shot emby /emby 1440,900
    ;;
  setup)
    shot setup /login 1440,900
    ;;
  apps)
    shot setup-apps /setup 1440,1500
    ;;
  *) echo "Unknown mode: $MODE (all, plex, emby, setup or apps)" >&2; exit 1 ;;
esac
echo "Saved to $OUT"
