#!/usr/bin/env bash
# Starts (or restarts) the tutor in the background, so it keeps running even when nobody has the
# Codespace open (for example after the "Wake the tutor" button starts it), then shows its output.
#
#   npm run tutor                  restart the tutor and show its output (use this after `git pull`)
#   start-tutor.sh --background    restart without showing output (runs when the Codespace starts)
#   start-tutor.sh --watch         just show the output (runs when you open the Codespace)
#
# Pressing Ctrl+C only stops showing the output; the tutor keeps running.
set -u
cd "$(dirname "$0")/.." || exit 1
LOG=/tmp/tutor.log
MODE="${1:-}"

if [ "$MODE" != "--watch" ]; then
  pkill -f '^node server/index\.js' 2>/dev/null && sleep 1
  setsid nohup node server/index.js >"$LOG" 2>&1 </dev/null &
  echo "The tutor is starting in the background."

  # Make port 3000 reachable from the public web page (best effort; see README if it isn't).
  if [ -n "${CODESPACE_NAME:-}" ] && command -v gh >/dev/null 2>&1; then
    (sleep 20; gh codespace ports visibility 3000:public -c "$CODESPACE_NAME" >/dev/null 2>&1) </dev/null >/dev/null 2>&1 &
  fi
fi

[ "$MODE" = "--background" ] && exit 0

touch "$LOG"
echo "Showing the tutor's output. Press Ctrl+C to stop watching (the tutor keeps running)."
echo
exec tail -n 40 -f "$LOG"
