#!/usr/bin/env bash
# Syncs the GitHub "About" sidebar (description + homepage + topics) on the
# public mirror repo with the live stats line in README-PUBLIC.md. Idempotent.
#
# Reads counts from the bolded stats line at the top of README-PUBLIC.md so
# the script never drifts from what's actually in the public README.
#
# Required env: GITHUB_PERSONAL_ACCESS_TOKEN_2 (classic PAT, repo scope)
# Optional env: PUBLIC_REPO (default: Huskyauto/VisionClaw-Agent-Public-Release)
#               README_PATH (default: README-PUBLIC.md)
#
# Exit codes: 0 success, 1 missing token, 2 README parse failure, 3 API error.
set -euo pipefail

PUBLIC_REPO="${PUBLIC_REPO:-Huskyauto/VisionClaw-Agent-Public-Release}"
README_PATH="${README_PATH:-README-PUBLIC.md}"
TOKEN="${GITHUB_PERSONAL_ACCESS_TOKEN_2:-}"

if [ -z "$TOKEN" ]; then
  echo "[meta-sync] ERROR: GITHUB_PERSONAL_ACCESS_TOKEN_2 not set" >&2
  exit 1
fi
if [ ! -f "$README_PATH" ]; then
  echo "[meta-sync] ERROR: $README_PATH not found" >&2
  exit 2
fi

# Pull the bold stats line (the one starting with "Roughly NNNk lines")
STATS_LINE=$(grep -m1 -E '^Roughly [0-9]+k lines' "$README_PATH" || true)
if [ -z "$STATS_LINE" ]; then
  echo "[meta-sync] ERROR: could not find stats line in $README_PATH" >&2
  exit 2
fi

extract() { echo "$STATS_LINE" | grep -oE "$1" | head -1 | grep -oE '[0-9]+' || echo ""; }
TOOLS=$(extract '[0-9]+\+? tools')
SKILLS=$(extract '[0-9]+\+? skills')
PERSONAS=$(extract '[0-9]+\+? (active )?personas')
CAPS=$(extract '[0-9]+\+? (active )?capabilities')
INDEXES=$(extract '[0-9]+\+? production indexes')
TABLES=$(extract '[0-9]+\+? tables')
MODELS=$(extract '[0-9]+\+? curated AI models')
OR_MODELS=$(echo "$STATS_LINE" | grep -oE '[0-9]+\+ models on OpenRouter' | grep -oE '[0-9]+\+' | head -1 || echo "1000+")

if [ -z "$TOOLS$SKILLS$PERSONAS$CAPS$TABLES" ]; then
  echo "[meta-sync] ERROR: stats line found but no numbers parsed; line was:" >&2
  echo "$STATS_LINE" >&2
  exit 2
fi

PARTS=("Open-source multi-tenant AI agent workspace")
[ -n "$PERSONAS" ] && PARTS+=("${PERSONAS} personas")
[ -n "$TOOLS" ]    && PARTS+=("${TOOLS} tools")
[ -n "$SKILLS" ]   && PARTS+=("${SKILLS} skills")
[ -n "$TABLES" ]   && PARTS+=("${TABLES} tables")
[ -n "$CAPS" ]     && PARTS+=("${CAPS} active capabilities")
[ -n "$INDEXES" ]  && PARTS+=("${INDEXES} production indexes")
[ -n "$MODELS" ]   && PARTS+=("${MODELS} curated AI models + ${OR_MODELS} OpenRouter catalog")
PARTS+=("self-hosted, BYO-keys")
DESCRIPTION=""
for part in "${PARTS[@]}"; do
  if [ -z "$DESCRIPTION" ]; then DESCRIPTION="$part"; else DESCRIPTION="$DESCRIPTION · $part"; fi
done

PAYLOAD=$(cat <<JSON
{
  "description": $(printf '%s' "$DESCRIPTION" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),
  "homepage": "https://agenticcorporation.net",
  "topics": ["ai-agents","multi-agent","agent-orchestration","ai-workforce","autonomous-agents","ai-platform","llm","openai","anthropic","rag","typescript","react","express","self-hosted","open-source"]
}
JSON
)

echo "[meta-sync] PATCH https://api.github.com/repos/${PUBLIC_REPO}"
echo "[meta-sync] description: ${DESCRIPTION}"

HTTP_CODE=$(curl -sS -o /tmp/meta-sync-response.json -w '%{http_code}' \
  -X PATCH \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/${PUBLIC_REPO}" \
  -d "$PAYLOAD")

if [ "$HTTP_CODE" != "200" ]; then
  echo "[meta-sync] ERROR: GitHub API returned HTTP ${HTTP_CODE}" >&2
  cat /tmp/meta-sync-response.json >&2
  exit 3
fi

echo "[meta-sync] ✓ updated public repo About + topics"
