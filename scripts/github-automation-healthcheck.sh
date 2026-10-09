#!/usr/bin/env bash
# Read-only health check for the GitHub source-backup and CI self-healer paths.
#
# This intentionally mirrors the existing authentication policy:
#   GITHUB_PERSONAL_ACCESS_TOKEN_2 (preferred), then GITHUB_TOKEN.
# It never writes to GitHub, prints a credential, or changes the working tree.

set -euo pipefail

REPO="${GITHUB_REPO:-Huskyauto/VisionClaw-Agent}"
BRANCH="${BRANCH:-main}"
RAW_TOKEN="${GITHUB_PERSONAL_ACCESS_TOKEN_2:-${GITHUB_TOKEN:-}}"
TOKEN="$(printf '%s' "$RAW_TOKEN" | tr -d '[:space:]')"

if [ -z "$TOKEN" ]; then
  echo "[github-health] FAIL: no GitHub token in GITHUB_PERSONAL_ACCESS_TOKEN_2 or GITHUB_TOKEN" >&2
  exit 2
fi

if [[ ! "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  echo "[github-health] FAIL: invalid GITHUB_REPO format" >&2
  exit 2
fi

if [[ ! "$BRANCH" =~ ^[A-Za-z0-9._/-]+$ || "$BRANCH" == *".."* ]]; then
  echo "[github-health] FAIL: invalid BRANCH format" >&2
  exit 2
fi

if ! command -v git >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1 ||
  ! command -v node >/dev/null 2>&1 || ! command -v timeout >/dev/null 2>&1 ||
  ! command -v base64 >/dev/null 2>&1; then
  echo "[github-health] FAIL: git, curl, node, timeout, and base64 are required" >&2
  exit 2
fi

# Match scripts/git-push.sh's read-only repository probe, but do not put the
# token in a URL or command argument. Git receives an Authorization header via
# its environment-backed config; the value is not present in child argv.
BASIC_AUTH="$(printf 'x-access-token:%s' "$TOKEN" | base64 | tr -d '\n')"
REPO_URL="https://github.com/${REPO}.git"
if ! \
  GIT_TERMINAL_PROMPT=0 \
  GIT_CONFIG_COUNT=1 \
  GIT_CONFIG_KEY_0=http.extraHeader \
  GIT_CONFIG_VALUE_0="Authorization: Basic ${BASIC_AUTH}" \
  timeout --signal=TERM 20s git ls-remote "$REPO_URL" "refs/heads/${BRANCH}" >/dev/null 2>&1; then
  echo "[github-health] FAIL: repository authentication/read failed (repo=${REPO}, branch=${BRANCH})" >&2
  exit 3
fi

NETRC_FILE="$(mktemp)"
RESPONSE_FILE="$(mktemp)"
chmod 600 "$NETRC_FILE" "$RESPONSE_FILE"
trap 'rm -f "$NETRC_FILE" "$RESPONSE_FILE"' EXIT
printf 'machine api.github.com\nlogin x-access-token\npassword %s\n' "$TOKEN" > "$NETRC_FILE"

if ! HTTP_STATUS="$(
  curl --silent --show-error --location \
    --connect-timeout 10 --max-time 30 \
    --netrc \
    --netrc-file "$NETRC_FILE" \
    --output "$RESPONSE_FILE" \
    --write-out '%{http_code}' \
    --header 'Accept: application/vnd.github+json' \
    --get \
    --data-urlencode "branch=${BRANCH}" \
    --data-urlencode 'per_page=1' \
    "https://api.github.com/repos/${REPO}/actions/runs"
)"; then
  echo "[github-health] FAIL: Actions API request timed out or could not connect (repo=${REPO})" >&2
  exit 4
fi

if [ "$HTTP_STATUS" != "200" ]; then
  echo "[github-health] FAIL: Actions API returned HTTP ${HTTP_STATUS} (repo=${REPO})" >&2
  exit 4
fi

if ! RUN_SUMMARY="$(node - "$RESPONSE_FILE" 2>/dev/null <<'NODE'
const fs = require("node:fs");
const response = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const run = response.workflow_runs?.[0];
if (!run) {
  process.stdout.write("latest_actions_run=none");
} else {
  process.stdout.write(
    `latest_actions_run=${run.id} status=${run.status ?? "unknown"} conclusion=${run.conclusion ?? "unknown"}`,
  );
}
NODE
)"; then
  echo "[github-health] FAIL: Actions API returned malformed JSON (repo=${REPO})" >&2
  exit 5
fi

echo "[github-health] PASS: repo=${REPO} branch=${BRANCH} ${RUN_SUMMARY}"