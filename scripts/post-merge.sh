#!/bin/bash
# Post-merge reconciliation script.
#
# Runs automatically after the platform merges an isolated task agent's
# branch back into main. Must complete within 20s or the merge is flagged
# as failed.
#
# HARD RULES (replit.md L7+L13) — DO NOT VIOLATE:
#   • NO drizzle-kit
#   • NO npm run db:push
#   • NO npm run db:push --force
#   • NEVER modify shared/schema.ts
#   • Schema changes go through `psql $DATABASE_URL` only, by Bob, manually
#
# Why no schema sync:
#   The previous version of this script ran `npm run db:push`, which is
#   `drizzle-kit push`. drizzle-kit pulls the live schema and prompts
#   INTERACTIVELY for any column drift (e.g. it asked whether the
#   invoices.issued_at column was created or renamed from one of 10 other
#   columns). With no human at the terminal, the script hangs until the
#   20s post-merge timeout kills it — and if it ever did get an answer
#   wrong, it would silently drop production data via ALTER TABLE.
#
# What this script DOES do:
#   1. `npm install` — reconcile node_modules with the merged package.json
#      (the merge commits package.json and package-lock.json, but the
#      isolated task agent's `node_modules/` doesn't follow). Skipped if
#      package-lock.json is unchanged from the previous run, to keep
#      reconciliation under a couple of seconds for code-only merges.
#
# What this script INTENTIONALLY does NOT do:
#   • Schema sync (see HARD RULES above)
#   • Test runs (the merging task agent already ran them; rerunning here
#     would blow past the 20s timeout for every merge)
#   • Build (vite/esbuild are tied to `npm run dev`, which the workflow
#     supervisor handles separately)

set -e

LOCK_HASH_FILE=".local/.last-pkg-lock-hash"
mkdir -p .local

if [ -f package-lock.json ]; then
  CURRENT_HASH=$(sha256sum package-lock.json | awk '{print $1}')
  PREVIOUS_HASH=$(cat "$LOCK_HASH_FILE" 2>/dev/null || echo "")

  if [ "$CURRENT_HASH" != "$PREVIOUS_HASH" ]; then
    echo "[post-merge] package-lock.json changed — running npm install"
    npm install --no-audit --no-fund --prefer-offline
    echo "$CURRENT_HASH" > "$LOCK_HASH_FILE"
  else
    echo "[post-merge] package-lock.json unchanged — skipping npm install"
  fi
else
  echo "[post-merge] no package-lock.json — running npm install"
  npm install --no-audit --no-fund --prefer-offline
fi

echo "[post-merge] schema sync intentionally skipped (replit.md L7+L13)"
echo "[post-merge] done"
