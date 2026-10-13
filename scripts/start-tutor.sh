#!/usr/bin/env bash
# Starts the tutor and shows its output. Logs live in the project's .tutor/ folder, which survives
# Codespace restarts:
#   .tutor/tutor.log   the tutor's output
#   .tutor/start.log   a record of each start-up, for working out problems
#   .tutor/port.log    whether port 3000 was made Public (written by the tutor itself)
#
#   npm run tutor                  restart the tutor and show its output (use this after `git pull`)
#   start-tutor.sh --foreground    run the tutor in the foreground (runs when the Codespace starts;
#                                  a background program started at that point doesn't survive)
#   start-tutor.sh --watch         start the tutor if it isn't running, then show its output
#                                  (runs when you open the Codespace)
#
# Pressing Ctrl+C while watching only stops showing the output; the tutor keeps running.
set -u
cd "$(dirname "$0")/.." || exit 1
DIR="$PWD/.tutor"
mkdir -p "$DIR"
LOG="$DIR/tutor.log"
MODE="${1:-}"

note() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [$MODE] $*" >>"$DIR/start.log"; }
running() { pgrep -f '^node server/index\.js' >/dev/null 2>&1; }

note "start-up step began (user $(id -un), codespace ${CODESPACE_NAME:-unknown}, node $(command -v node || echo missing))"

start_in_background() {
  pkill -f '^node server/index\.js' 2>/dev/null && sleep 1
  : >"$LOG"
  setsid nohup node server/index.js >>"$LOG" 2>&1 </dev/null &
  note "started the tutor in the background (process $!)"
  echo "The tutor is starting in the background."
}

case "$MODE" in
  --foreground)
    pkill -f '^node server/index\.js' 2>/dev/null && sleep 1
    : >"$LOG"
    note "running the tutor in the foreground"
    node server/index.js >>"$LOG" 2>&1 </dev/null
    note "the tutor stopped (exit code $?)"
    exit 0
    ;;
  --watch)
    if running; then
      note "the tutor is already running"
    else
      note "the tutor wasn't running, so starting it"
      start_in_background
    fi
    ;;
  *)
    start_in_background
    ;;
esac

touch "$LOG"
echo "Showing the tutor's output. Press Ctrl+C to stop watching (the tutor keeps running)."
echo
exec tail -n 40 -f "$LOG"
