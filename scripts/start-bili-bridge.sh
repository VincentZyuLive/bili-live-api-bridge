#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
PORT=61611
HOST=127.0.0.1
OPEN_BROWSER=1

args=("$@")
for ((i = 0; i < ${#args[@]}; i += 1)); do
  case "${args[i]}" in
    --port)
      if ((i + 1 < ${#args[@]})); then
        PORT="${args[i + 1]}"
        i=$((i + 1))
      fi
      ;;
    --port=*)
      PORT="${args[i]#--port=}"
      ;;
    --host)
      if ((i + 1 < ${#args[@]})); then
        HOST="${args[i + 1]}"
        i=$((i + 1))
      fi
      ;;
    --host=*)
      HOST="${args[i]#--host=}"
      ;;
    --no-open)
      OPEN_BROWSER=0
      ;;
  esac
done

WEB_HOST="$HOST"
case "$WEB_HOST" in
  0.0.0.0)
    WEB_HOST=127.0.0.1
    ;;
  ::|\[::\])
    WEB_HOST='[::1]'
    ;;
esac
WEB_URL="http://${WEB_HOST}:${PORT}"
HEALTH_URL="${WEB_URL}/api/health"

cd "$ROOT_DIR"

open_webui() {
  if command -v xdg-open >/dev/null 2>&1 && xdg-open "$WEB_URL" >/dev/null 2>&1; then
    return
  fi
  if command -v gio >/dev/null 2>&1 && gio open "$WEB_URL" >/dev/null 2>&1; then
    return
  fi
  if command -v open >/dev/null 2>&1 && open "$WEB_URL" >/dev/null 2>&1; then
    return
  fi
  printf 'Open in browser: %s\n' "$WEB_URL"
}

is_running() {
  if command -v curl >/dev/null 2>&1; then
    curl --fail --silent --show-error --max-time 2 "$HEALTH_URL" >/dev/null 2>&1
    return
  fi
  if command -v wget >/dev/null 2>&1; then
    wget --quiet --timeout=2 --output-document=/dev/null "$HEALTH_URL" >/dev/null 2>&1
    return
  fi
  return 1
}

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js was not found in PATH." >&2
  echo "Install Node.js 20 or newer: https://nodejs.org/" >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "[ERROR] npm was not found in PATH." >&2
  echo "Reinstall Node.js and make sure npm is included." >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "[ERROR] Node.js 20 or newer is required. Current major version: $NODE_MAJOR" >&2
  exit 1
fi

if [ ! -d "node_modules/tsx" ]; then
  echo "Installing dependencies with npm ci..."
  npm ci
fi

if is_running; then
  echo "Bili Live Bridge is already running."
  if [ "$OPEN_BROWSER" -eq 1 ]; then
    open_webui
  else
    printf 'WebUI URL: %s\n' "$WEB_URL"
  fi
  exit 0
fi

echo "Starting Bili Live Bridge on $WEB_URL"
exec npm start -- "$@"
