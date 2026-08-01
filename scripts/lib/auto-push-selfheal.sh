#!/usr/bin/env bash
# scripts/lib/auto-push-selfheal.sh — diverged-remote self-heal for the
# auto-push loop (R125+52.x), extracted into a sourceable function so the
# branch logic is testable (tests/unit/auto-push-selfheal.test.ts) without
# running the infinite loop.
#
# Contract (caller = scripts/git-auto-push.sh):
#   auto_push_selfheal "$PUSH_OUT" "$BRANCH"
#
#   Reads/writes the caller's HEAL_ATTEMPTS global (bash dynamic scoping).
#   Env:
#     GITHUB_PERSONAL_ACCESS_TOKEN_2 / GITHUB_TOKEN — auth for the fetch URL
#     SELFHEAL_URL_OVERRIDE — TEST-ONLY: a local repo path/URL to fetch from
#       instead of the tokenized GitHub URL (lets tests exercise the branch
#       logic against throwaway local repos; never set in production).
#
# Behavior (unchanged from the inline version):
#   - only acts when the push output shows a non-fast-forward rejection
#   - caps at 3 attempts without a successful push (caller resets on success)
#   - skips when the working tree is dirty
#   - fetches via tokenized URL (no tty prompt possible)
#   - rebases ONLY on true divergence (remote actually ahead); aborts on
#     conflict and leaves everything untouched. Never force-pushes.

auto_push_selfheal() {
  local PUSH_OUT="$1"
  local BRANCH="$2"

  if ! printf '%s' "$PUSH_OUT" | grep -q "non-fast-forward"; then
    return 0
  fi

  if [ "${HEAL_ATTEMPTS:-0}" -ge 3 ]; then
    echo "[auto-push] self-heal skipped: ${HEAL_ATTEMPTS} attempts without a successful push — persistent reject, manual reconcile needed" >&2
    return 0
  fi

  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    echo "[auto-push] self-heal skipped: working tree dirty (will retry after commit)" >&2
    return 0
  fi

  local HEAL_URL HEAL_TOKEN
  # Override only honored under explicit test mode — an accidentally-set
  # SELFHEAL_URL_OVERRIDE in prod env must never redirect the fetch (architect
  # hardening suggestion).
  if [ "${SELFHEAL_TEST_MODE:-}" = "1" ] && [ -n "${SELFHEAL_URL_OVERRIDE:-}" ]; then
    HEAL_URL="$SELFHEAL_URL_OVERRIDE"
    HEAL_TOKEN="__none__"
  else
    HEAL_TOKEN=$(printf '%s' "${GITHUB_PERSONAL_ACCESS_TOKEN_2:-${GITHUB_TOKEN:-}}" | tr -d '[:space:]')
    if [ -z "$HEAL_TOKEN" ]; then
      echo "[auto-push] self-heal skipped: no GitHub token in env" >&2
      return 0
    fi
    HEAL_URL="https://x-access-token:${HEAL_TOKEN}@github.com/Huskyauto/VisionClaw-Agent.git"
  fi

  HEAL_ATTEMPTS=$(( ${HEAL_ATTEMPTS:-0} + 1 ))
  echo "[auto-push] $(date -Iseconds) self-heal attempt ${HEAL_ATTEMPTS}/3: fetching to check for true divergence..."
  if GIT_TERMINAL_PROMPT=0 git fetch "$HEAL_URL" "$BRANCH" 2>&1 | sed -E "s|${HEAL_TOKEN}|REDACTED|g"; then
    # True divergence check: only rebase if the remote actually has commits we
    # don't. If FETCH_HEAD is already an ancestor of HEAD, the reject was
    # caused by something else (branch protection, pre-receive hook) and a
    # rebase would be pointless churn.
    if git merge-base --is-ancestor FETCH_HEAD HEAD 2>/dev/null; then
      echo "[auto-push] self-heal: remote is NOT ahead — reject cause is not divergence (branch protection / hook?), skipping rebase" >&2
    elif GIT_TERMINAL_PROMPT=0 git rebase FETCH_HEAD 2>&1 | sed -E "s|${HEAL_TOKEN}|REDACTED|g"; then
      echo "[auto-push] self-heal: rebase ok — next cycle will push"
    else
      echo "[auto-push] self-heal: rebase CONFLICT — aborting rebase, manual reconcile needed" >&2
      git rebase --abort 2>/dev/null || true
    fi
  else
    echo "[auto-push] self-heal: fetch failed — will retry next cycle" >&2
  fi
  return 0
}
