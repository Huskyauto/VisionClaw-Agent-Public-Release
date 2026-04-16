#!/bin/bash
set -euo pipefail

echo "=== Clean-for-Release Script ==="
echo ""
echo "This script prepares a fork-ready copy of the repository."
echo "It does NOT modify the current repo — it creates a clean copy."
echo ""

CLEAN_DIR="${1:-platform-clean}"

if [ -d "$CLEAN_DIR" ]; then
  echo "ERROR: Directory '$CLEAN_DIR' already exists. Remove it first or choose a different name."
  exit 1
fi

echo "[1/7] Creating clean copy..."
mkdir -p "$CLEAN_DIR"
git archive HEAD | tar -x -C "$CLEAN_DIR"

echo "[2/7] Removing private deliverables and data files..."
rm -rf "$CLEAN_DIR/deliverables/"
rm -rf "$CLEAN_DIR/data/"
rm -rf "$CLEAN_DIR/project-transcripts/"
rm -rf "$CLEAN_DIR/docs/"
rm -rf "$CLEAN_DIR/attached_assets/"
rm -rf "$CLEAN_DIR/dist/"
rm -f "$CLEAN_DIR"/*.txt
rm -f "$CLEAN_DIR"/*.html
rm -f "$CLEAN_DIR"/*.pdf
rm -f "$CLEAN_DIR"/*.png
rm -f "$CLEAN_DIR"/sedubinI2
rm -f "$CLEAN_DIR"/VC-Demo-Playbook*.md
rm -f "$CLEAN_DIR"/VisionClaw*.md
rm -f "$CLEAN_DIR"/Felix-*.md
rm -f "$CLEAN_DIR"/Felix-*.pdf
rm -f "$CLEAN_DIR"/SETUP.md

echo "[3/7] Removing Replit-specific config (optional for non-Replit hosts)..."
rm -rf "$CLEAN_DIR/.local/"
rm -rf "$CLEAN_DIR/.agents/"

echo "[4/7] Replacing private README/SETUP with public versions..."
if [ -f "$CLEAN_DIR/README-PUBLIC.md" ]; then
  mv "$CLEAN_DIR/README-PUBLIC.md" "$CLEAN_DIR/README.md"
  echo "  Replaced README.md with README-PUBLIC.md"
fi
if [ -f "$CLEAN_DIR/SETUP.md" ]; then
  rm -f "$CLEAN_DIR/SETUP.md"
  echo "  Removed private SETUP.md (FORK-SETUP.md is the public guide)"
fi
rm -f "$CLEAN_DIR/replit.md"
echo "  Removed replit.md (contains private workflow instructions)"

echo "[5/7] Scanning for potential secrets/PII leaks..."
echo "  Add your own PII patterns to PATTERNS below before running."
PATTERNS="${PII_SCAN_PATTERNS:-REPLACE_WITH_YOUR_OWN_PII_PATTERNS}"
if [ "$PATTERNS" = "REPLACE_WITH_YOUR_OWN_PII_PATTERNS" ]; then
  echo "  SKIPPED — Set PII_SCAN_PATTERNS env var with pipe-separated regex patterns to scan."
  echo "  Example: PII_SCAN_PATTERNS='myemail@example.com|My Full Name|555-123-4567' bash scripts/clean-for-release.sh"
else
  echo "  Scanning source files for PII patterns..."
  FOUND=$(grep -rl -E "$PATTERNS" "$CLEAN_DIR" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.json" --include="*.html" --include="*.md" --include="*.sh" 2>/dev/null || true)
  if [ -n "$FOUND" ]; then
    echo "  WARNING: The following files still contain PII patterns:"
    echo "$FOUND" | sed 's/^/    /'
    echo ""
    echo "  Details:"
    for f in $FOUND; do
      echo "    --- $f ---"
      grep -n -E "$PATTERNS" "$f" 2>/dev/null | head -5 | sed 's/^/      /'
    done
    echo ""
    echo "  Review these files before publishing."
  else
    echo "  OK — No PII patterns found in source files."
  fi
fi

echo "[6/7] Scanning for API keys / secrets in source..."
SECRET_PATTERNS="sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|AIza[a-zA-Z0-9_-]{35}|AKIA[A-Z0-9]{16}|whsec_[a-zA-Z0-9]{32,}|am_us_pod_[a-f0-9]{64}"
SECRET_FOUND=$(grep -rl -E "$SECRET_PATTERNS" "$CLEAN_DIR" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.env" 2>/dev/null || true)
if [ -n "$SECRET_FOUND" ]; then
  echo "  WARNING: Possible API keys found in:"
  echo "$SECRET_FOUND" | sed 's/^/    /'
else
  echo "  OK — No API key patterns found."
fi

echo "[7/7] Summary"
echo ""
echo "  Clean copy created at: $CLEAN_DIR/"
echo "  Next steps:"
echo "    1. Review any warnings above"
echo "    2. Initialize a new git repo: cd $CLEAN_DIR && git init && git add -A && git commit -m 'Initial release'"
echo "    3. Push to your public repository"
echo ""
echo "Done."
