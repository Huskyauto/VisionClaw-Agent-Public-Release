---
description: Stage and commit all current changes with a single message. Auto Git Push will pick up and push to origin within 30s.
timeoutMs: 30000
argsRequired: ["message"]
---

set -euo pipefail
if [ -z "${ARG_MESSAGE:-}" ]; then
  echo "[commit-all] ERROR: missing required arg 'message'" >&2
  exit 2
fi
node -e "require('child_process').spawnSync('git',['add','-A'],{stdio:'inherit'}); require('child_process').spawnSync('git',['commit','-m',process.env.ARG_MESSAGE],{stdio:'inherit'})"
echo "[commit-all] committed; Auto Git Push workflow will push within 30s"
