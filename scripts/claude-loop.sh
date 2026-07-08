#!/usr/bin/env bash
# Predictable start/stop/status for pragyan's Claude workflows.
# Each pass is one headless `claude -p "/<skill>"` run in this repo (fresh
# session; the skills re-orient themselves via MCP, so passes are stateless).
#
#   scripts/claude-loop.sh start  [skill] [interval-minutes]   # default: pragyan-tick 30
#   scripts/claude-loop.sh stop   [skill]
#   scripts/claude-loop.sh status [skill]
#   scripts/claude-loop.sh once   [skill]                      # single foreground pass
#   scripts/claude-loop.sh logs   [skill]                      # tail -f the pass log
#
# Requires: `claude` CLI (logged in) and the pragyan API (`npm start`) running.
# Model defaults to sonnet; override with CLAUDE_LOOP_MODEL=opus etc.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$REPO/.claude/run"
mkdir -p "$RUN_DIR"

CMD="${1:-status}"
SKILL="${2:-pragyan-tick}"
INTERVAL_MIN="${3:-60}"
MODEL="${CLAUDE_LOOP_MODEL:-sonnet}"
API="${XFEED_API_BASE:-http://127.0.0.1:8787}"

PIDFILE="$RUN_DIR/$SKILL.pid"
LOGFILE="$RUN_DIR/$SKILL.log"
STATEFILE="$RUN_DIR/$SKILL.state"

alive() { [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; }

require_api() {
  curl -sf -m 3 "$API/health" > /dev/null ||
    { echo "pragyan API not reachable at $API — run \`npm start\` first"; exit 1; }
}

run_pass() {
  echo "── $(date -Is) · /$SKILL pass start (model $MODEL)" >> "$LOGFILE"
  if (cd "$REPO" && claude -p "/$SKILL" --model "$MODEL") >> "$LOGFILE" 2>&1; then
    echo "── $(date -Is) · pass ok" >> "$LOGFILE"
  else
    echo "── $(date -Is) · pass FAILED (exit $?)" >> "$LOGFILE"
  fi
}

case "$CMD" in
  start)
    command -v claude > /dev/null || { echo "claude CLI not found on PATH"; exit 1; }
    require_api
    if alive; then
      echo "/$SKILL loop already running (pid $(cat "$PIDFILE"))"
      exit 0
    fi
    rm -f "$PIDFILE"
    (
      trap 'rm -f "$PIDFILE" "$STATEFILE"; exit 0' TERM INT
      while true; do
        run_pass
        date -Is -d "+${INTERVAL_MIN} minutes" > "$STATEFILE"
        sleep $((INTERVAL_MIN * 60)) &
        wait $!
      done
    ) &
    echo $! > "$PIDFILE"
    disown
    echo "/$SKILL loop started: every ${INTERVAL_MIN}m, pid $(cat "$PIDFILE"), log $LOGFILE"
    ;;

  stop)
    if alive; then
      kill "$(cat "$PIDFILE")"
      echo "/$SKILL loop stopped"
    else
      rm -f "$PIDFILE" "$STATEFILE"
      echo "/$SKILL loop not running"
    fi
    ;;

  status)
    if alive; then
      echo "/$SKILL loop RUNNING (pid $(cat "$PIDFILE"))"
      [[ -f "$STATEFILE" ]] && echo "next pass ≈ $(cat "$STATEFILE")"
    else
      echo "/$SKILL loop STOPPED"
    fi
    if [[ -f "$LOGFILE" ]]; then
      echo "last activity:"
      grep "^──" "$LOGFILE" | tail -3 | sed 's/^/  /'
    fi
    curl -sf -m 3 "$API/health" > /dev/null &&
      echo "pragyan API: up ($API)" || echo "pragyan API: DOWN ($API)"
    ;;

  once)
    require_api
    run_pass
    tail -n 20 "$LOGFILE"
    ;;

  logs)
    exec tail -f "$LOGFILE"
    ;;

  *)
    echo "usage: $0 {start|stop|status|once|logs} [skill] [interval-minutes]"
    exit 1
    ;;
esac
