#!/usr/bin/env bash
# Bounded offline report-package gate: explicit injected/static tests only.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
mapfile -t files < tests/report-package-release-files.txt
if (( ${#files[@]} == 0 )); then
  echo "Report release test inventory is empty" >&2
  exit 1
fi
for file in "${files[@]}"; do
  if [[ ! "$file" =~ ^tests/(lib|unit|client|providers)/[a-z0-9-]+\.test\.ts$ || ! -f "$file" ]]; then
    echo "Invalid report release test inventory entry" >&2
    exit 1
  fi
done
exec timeout 240 node --import tsx --test --test-concurrency=1 --test-force-exit "${files[@]}"
