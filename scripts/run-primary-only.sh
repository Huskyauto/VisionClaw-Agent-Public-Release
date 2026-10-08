#!/usr/bin/env bash
# A Replit remix inherits .replit's run commands but must stay dormant.
set -euo pipefail

PRIMARY_REPL_ID="45b6d1c0-f690-443b-a4f3-d57f5cba126d"
if [ "${REPL_ID:-}" != "$PRIMARY_REPL_ID" ]; then
  echo "[standby] This is not the original project. No app or scheduled audit was started. See docs/standby-remix.md."
  exit 0
fi

if [ "$#" -eq 0 ]; then
  echo "[primary-only] Missing command" >&2
  exit 2
fi

exec "$@"