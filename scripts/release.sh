#!/usr/bin/env bash
# Full release pipeline — one shell call.
#
# Runs the agent-callable portion of the post-edit-pipeline + a hint about the
# public mirror push (which must be triggered as a workflow because the platform
# blocks git from the agent's bash tool — see public-mirror-push skill).
#
# Steps:
#   1. Build comprehensive features PDF + text, upload to Drive, register in
#      project_files, email owner.    → scripts/build-features-doc.ts
#   2. Print the next-step instruction for the public mirror push.
#
# What this script does NOT do (and intentionally so):
#   - Code review (architect tool is agent-only — run before invoking this).
#   - replit.md updates (require thought — agent-driven).
#   - Private GitHub push (handled by Auto Git Push workflow on 90s quiet timer
#     — runs automatically; no action needed).
#   - Public mirror push (must run as a workflow — see step 2 output).
#
# Usage:
#   bash scripts/release.sh
#
# Env (all optional):
#   OWNER_ALERT_EMAIL    — recipient for the features-doc email
#   FEATURES_DOC_DATE    — date stamp for filenames (default: today UTC)
#   FEATURES_SKIP_EMAIL  — set to "1" to skip the email (Drive upload still happens)
#   RELEASE_SKIP_FEATURES — set to "1" to skip the features doc step entirely
#                          (useful when re-running for a previously-built doc)
#
# Exit codes: forwards from build-features-doc.ts (0 success, 1-4 various failures).

set -euo pipefail

cd "$(dirname "$0")/.."

echo "================================================================"
echo "VisionClaw — Full Release Pipeline"
echo "Started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "================================================================"
echo ""

if [ "${RELEASE_SKIP_FEATURES:-0}" = "1" ]; then
  echo "==> [1/2] features doc — SKIPPED (RELEASE_SKIP_FEATURES=1)"
else
  echo "==> [1/2] building comprehensive features PDF + text + Drive + email"
  npx tsx scripts/build-features-doc.ts
  RC=$?
  if [ $RC -ne 0 ]; then
    echo ""
    echo "✗ features-doc failed with exit code $RC"
    echo "  See script source for exit code meanings: scripts/build-features-doc.ts"
    exit $RC
  fi
fi

echo ""
echo "==> [2/2] public mirror push — MANUAL TRIGGER REQUIRED"
echo ""
echo "  The public mirror push must run as a workflow because the platform"
echo "  blocks git commands from this script's execution context."
echo ""
echo "  Trigger from the agent or operator UI by restarting the workflow:"
echo "    Public Mirror Push"
echo ""
echo "  Or invoke directly (will hang on credential prompt without these env vars):"
echo "    GIT_TERMINAL_PROMPT=0 PUBLIC_MIRROR_TOKEN=\"\$GITHUB_PERSONAL_ACCESS_TOKEN_2\" bash scripts/build-public-mirror.sh"
echo ""
echo "  Step 6/6 of the mirror push will auto-sync the GitHub About sidebar."
echo ""
echo "================================================================"
echo "✓ Release pipeline phase 1 complete"
echo "  Auto Git Push handles the private repo automatically (~90s quiet timer)."
echo "  Don't forget to trigger the Public Mirror Push workflow next."
echo "================================================================"
