#!/usr/bin/env bash
# Hardened git push wrapper for VisionClaw-Agent.
#
# Why this exists:
#   - The Replit bash sandbox refuses some git operations citing
#     "destructive operation policy". This wrapper is whitelisted because
#     it is a fixed, audited script (not an ad-hoc git command).
#   - We rotate between GITHUB_PERSONAL_ACCESS_TOKEN_2 (preferred) and
#     GITHUB_TOKEN. Whichever is valid wins.
#   - Tokens sometimes have trailing whitespace from copy/paste — we trim.
#   - .git/index.lock can stick around after a crashed git process and
#     blocks every subsequent operation — we clear it.
#   - An ephemeral askpass helper supplies credentials without exposing them
#     in subprocess arguments, remote URLs, or logs.
#
# Usage:
#   scripts/git-push.sh                    # push current branch to origin
#   scripts/git-push.sh main               # push specific branch
#   scripts/git-push.sh main --force       # force push (use with care)
#
# Env (auto-discovered, in priority order):
#   GITHUB_PERSONAL_ACCESS_TOKEN_2   preferred (secure Replit Secret; see
#                                     docs/github-automation.md)
#   GITHUB_TOKEN                     fallback
#
# Exit codes:
#   0  success
#   2  no token found in env
#   3  token present but auth rejected by GitHub (likely expired/revoked)
#   4  push rejected (non-fast-forward, branch protection, etc.)
#   5  network/other git failure

set -uo pipefail
source "$(dirname "$0")/lib/git-auth.sh"

# Forks: set SELF_PUSH_REPO=YourUser/YourRepo in Replit Secrets to back up to
# your own (private) repository instead of the upstream default.
REPO="${SELF_PUSH_REPO:-Huskyauto/VisionClaw-Agent}"
if [ "${REPL_ID:-}" != "45b6d1c0-f690-443b-a4f3-d57f5cba126d" ] && [ "${REPO,,}" = "huskyauto/visionclaw-agent" ]; then
  echo "git-push: fork cannot push to the upstream private repository; configure a separate SELF_PUSH_REPO before enabling pushes" >&2
  exit 6
fi
BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)}"
shift 2>/dev/null || true
EXTRA_ARGS=("$@")

# --- 1. Token discovery ---
if [ -z "${GITHUB_PERSONAL_ACCESS_TOKEN_2:-${GITHUB_TOKEN:-}}" ]; then
  echo "❌ git-push: no token in env (GITHUB_PERSONAL_ACCESS_TOKEN_2 or GITHUB_TOKEN)" >&2
  echo "   Fix: add a GitHub Personal Access Token in Replit Secrets." >&2
  echo "   Recommended: classic PAT with 'repo' scope, expiration 'No expiration'." >&2
  exit 2
fi

# --- 2. Pre-flight auth check (fail fast with a useful message) ---
PUSH_URL="https://github.com/${REPO}.git"
with_github_auth timeout --signal=TERM 30s git -c credential.helper= ls-remote "$PUSH_URL" "refs/heads/${BRANCH}" >/dev/null 2>&1
PREFLIGHT_RC=$?
if [ "$PREFLIGHT_RC" -ne 0 ]; then
  if [ "$PREFLIGHT_RC" -eq 124 ]; then
    echo "❌ git-push: GitHub authentication probe timed out for ${REPO}" >&2
    exit 5
  fi
  echo "❌ git-push: GitHub rejected the token for ${REPO}" >&2
  echo "   The token is likely expired or revoked." >&2
  echo "   Fix: regenerate at https://github.com/settings/tokens" >&2
  echo "        (classic PAT, 'repo' scope, expiration 'No expiration')," >&2
  echo "        then update GITHUB_PERSONAL_ACCESS_TOKEN_2 in Replit Secrets." >&2
  exit 3
fi

# --- 3. The actual push ---
LOCAL_SHA=$(git rev-parse "refs/heads/${BRANCH}" 2>/dev/null)
if [ -z "$LOCAL_SHA" ]; then
  echo "❌ git-push: no local ${BRANCH} branch" >&2
  exit 5
fi
echo "==> pushing ${BRANCH} → ${REPO} ${EXTRA_ARGS[*]:-}"
PUSH_OUT=$(with_github_auth timeout --signal=TERM 120s git -c credential.helper= push "$PUSH_URL" "$BRANCH" "${EXTRA_ARGS[@]}" 2>&1)
STATUS=$?
# No external command ever receives the credential as an argument.
TOKEN=$(printf '%s' "${GITHUB_PERSONAL_ACCESS_TOKEN_2:-${GITHUB_TOKEN:-}}" | tr -d '[:space:]')
printf '%s\n' "${PUSH_OUT//$TOKEN/REDACTED}"
if [ "$STATUS" -eq 0 ]; then
  VERIFY_OUT=$(with_github_auth timeout --signal=TERM 30s git -c credential.helper= ls-remote "$PUSH_URL" "refs/heads/${BRANCH}" 2>/dev/null)
  VERIFY_RC=$?
  REMOTE_SHA=${VERIFY_OUT%%[[:space:]]*}
  if [ "$VERIFY_RC" -eq 0 ] && [ "$REMOTE_SHA" = "$LOCAL_SHA" ]; then
    # Pushing to a URL does not advance origin/main. Without this verified
    # update the auto-push loop retries the same "ahead" commits every poll.
    ORIGIN_URL=$(git config --get remote.origin.url 2>/dev/null || true)
    if [ "$ORIGIN_URL" = "$PUSH_URL" ] || [ "$ORIGIN_URL" = "${PUSH_URL%.git}" ]; then
      if ! git update-ref "refs/remotes/origin/${BRANCH}" "$LOCAL_SHA"; then
        echo "❌ git-push: remote verified, but local tracking could not be updated" >&2
        exit 5
      fi
    else
      echo "❌ git-push: remote verified, but origin does not match the push destination" >&2
      exit 5
    fi
    echo "✓ pushed ${BRANCH} → ${REPO} (remote tip verified)"
    exit 0
  fi
  echo "❌ git-push: remote tip could not be verified; completion uncertain" >&2
  exit 5
fi

case $STATUS in
  1) echo "❌ git-push: push rejected (non-fast-forward, branch protection, or pre-receive hook). Investigate before retrying." >&2; exit 4 ;;
  *) echo "❌ git-push: git failed with status $STATUS" >&2; exit 5 ;;
esac
