#!/usr/bin/env bash
# tests/helpers/auto-push-selfheal-harness.sh — exercises the extracted
# auto_push_selfheal function against throwaway local repos. Invoked by
# tests/unit/auto-push-selfheal.test.ts with a scenario name; prints
# RESULT:<key>=<value> lines the node test asserts on. Exits non-zero on
# harness (not scenario) failure.
set -euo pipefail

SCENARIO="${1:?usage: harness.sh <diverged|not-ahead|dirty|capped|conflict>}"
LIB="$(cd "$(dirname "$0")/../.." && pwd)/scripts/lib/auto-push-selfheal.sh"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"

G() { git -c user.email=t@t -c user.name=t -c commit.gpgsign=false "$@"; }

# origin bare repo + seed clone with one shared commit
G init -q --bare origin.git
G clone -q origin.git seed
# branch -M main: don't depend on the environment's init.defaultBranch
( cd seed && echo base > f.txt && G add -A && G commit -qm base && G branch -M main && G push -q origin main )

# local clone (the "workspace")
G clone -q origin.git local
cd local
G checkout -q main

case "$SCENARIO" in
  diverged|conflict|capped)
    # remote gains a commit local doesn't have
    ( cd "$WORK/seed" && if [ "$SCENARIO" = "conflict" ]; then echo remote-line > f.txt; else echo remote > remote.txt; fi && G add -A && G commit -qm remote-ahead && G push -q origin main )
    # local gains its own commit → true divergence
    if [ "$SCENARIO" = "conflict" ]; then echo local-line > f.txt; else echo local > local.txt; fi
    G add -A && G commit -qm local-ahead
    ;;
  not-ahead)
    # local strictly ahead; remote NOT ahead (reject would be hook/protection)
    echo local > local.txt && G add -A && G commit -qm local-ahead
    ;;
  dirty)
    ( cd "$WORK/seed" && echo remote > remote.txt && G add -A && G commit -qm remote-ahead && G push -q origin main )
    echo local > local.txt && G add -A && G commit -qm local-ahead
    echo uncommitted > dirty.txt   # dirty tree
    ;;
esac

BEFORE_HEAD=$(G rev-parse HEAD)

# The lib calls plain `git` (rebase needs a committer identity); don't depend
# on ambient global config.
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

# shellcheck disable=SC1090
source "$LIB"
export SELFHEAL_TEST_MODE=1
export SELFHEAL_URL_OVERRIDE="$WORK/origin.git"
HEAL_ATTEMPTS=0
[ "$SCENARIO" = "capped" ] && HEAL_ATTEMPTS=3

# NOTE: no command substitution here — $(...) would run the function in a
# subshell and silently discard its HEAL_ATTEMPTS mutation. Redirect to a file.
set +e
auto_push_selfheal "push failed: ! [rejected] main -> main (non-fast-forward)" "main" >"$WORK/heal.out" 2>&1
RC=$?
set -e
OUT=$(cat "$WORK/heal.out")

AFTER_HEAD=$(G rev-parse HEAD)
REMOTE_TIP=$(G --git-dir="$WORK/origin.git" rev-parse main)
CONTAINS_REMOTE=no
G merge-base --is-ancestor "$REMOTE_TIP" "$AFTER_HEAD" 2>/dev/null && CONTAINS_REMOTE=yes
REBASE_IN_PROGRESS=no
[ -d .git/rebase-merge ] || [ -d .git/rebase-apply ] && REBASE_IN_PROGRESS=yes

echo "RESULT:rc=$RC"
echo "RESULT:attempts=$HEAL_ATTEMPTS"
echo "RESULT:head_moved=$([ "$BEFORE_HEAD" = "$AFTER_HEAD" ] && echo no || echo yes)"
echo "RESULT:contains_remote=$CONTAINS_REMOTE"
echo "RESULT:rebase_in_progress=$REBASE_IN_PROGRESS"
echo "RESULT:out<<EOF"
echo "$OUT"
echo "EOF"
