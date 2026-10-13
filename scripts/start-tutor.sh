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

# Port 3000 goes back to Private whenever the Codespace restarts, which hides the tutor from the
# public web page. This sets it to Public again, retrying while the Codespace finishes starting.
# Changing port visibility needs a key with the "codespace" scope, stored as the GH_PORTS_TOKEN
# Codespaces secret (see README, "Wake-up button"); without it, the Codespace's own key is tried.
make_port_public() {
  local attempts="${PORT_RETRIES:-18}" output=""
  for _ in $(seq 1 "$attempts"); do
    sleep "${PORT_RETRY_SECONDS:-10}"
    if output=$(GH_TOKEN="${GH_PORTS_TOKEN:-${GH_TOKEN:-}}" gh codespace ports visibility 3000:public -c "$CODESPACE_NAME" 2>&1); then
      echo "[start-up] Port 3000 is Public, so the web page can reach the tutor." >>"$LOG"
      return 0
    fi
  done
  {
    echo "[start-up] Couldn't make port 3000 Public automatically: ${output:-no details}"
    echo "[start-up] To fix: add the GH_PORTS_TOKEN Codespaces secret (see README, \"Wake-up button\"),"
    echo "[start-up] or set it by hand: PORTS tab, right-click port 3000, Port Visibility, Public."
  } >>"$LOG"
  return 1
}

if [ "$MODE" != "--watch" ]; then
  pkill -f '^node server/index\.js' 2>/dev/null && sleep 1
  : >"$LOG"
  setsid nohup node server/index.js >>"$LOG" 2>&1 </dev/null &
  echo "The tutor is starting in the background."

  if [ -n "${CODESPACE_NAME:-}" ] && command -v gh >/dev/null 2>&1; then
    export -f make_port_public
    export LOG
    setsid nohup bash -c make_port_public </dev/null >/dev/null 2>&1 &
  fi
fi

[ "$MODE" = "--background" ] && exit 0

touch "$LOG"
echo "Showing the tutor's output. Press Ctrl+C to stop watching (the tutor keeps running)."
echo
exec tail -n 40 -f "$LOG"
