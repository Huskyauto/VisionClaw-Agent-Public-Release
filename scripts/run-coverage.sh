#!/usr/bin/env bash
# Code-coverage report for the canonical node:test suite.
#
# Reuses the FILES list in tests/run.sh (single source of truth) but runs all
# suites in ONE node process with --experimental-test-coverage so coverage
# aggregates across the whole suite. Informational, NOT a gate: a module-load
# failure in one file can poison others in single-process mode, so pass/fail
# authority stays with tests/run.sh (per-file isolation).
#
# Usage: bash scripts/run-coverage.sh            # summary to stdout
#        COVERAGE_OUT=coverage.txt bash scripts/run-coverage.sh
set -uo pipefail

FILES=$(grep -oE '"tests/[^"]+\.test\.ts"' tests/run.sh | tr -d '"')
if [ -z "$FILES" ]; then
  echo "[coverage] could not extract FILES from tests/run.sh" >&2
  exit 2
fi

COUNT=$(echo "$FILES" | wc -l | tr -d ' ')
echo "[coverage] running $COUNT test files in one process with coverage..."

# shellcheck disable=SC2086
if [ -n "${COVERAGE_OUT:-}" ]; then
  timeout 600 node --import tsx --test --experimental-test-coverage $FILES 2>&1 | tee "$COVERAGE_OUT" | grep -E "^# (all files|start of coverage|end of coverage)|tests [0-9]+|pass [0-9]+|fail [0-9]+" || true
  echo "[coverage] full report written to $COVERAGE_OUT"
else
  timeout 600 node --import tsx --test --experimental-test-coverage $FILES
fi
