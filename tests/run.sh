#!/usr/bin/env bash
# VisionClaw security & tenant-isolation test runner.
# Each test file runs in its own node process so a heavy module-load in one
# file can't poison the others. Hard-fails on the first failure.
set -euo pipefail

FILES=(
  "tests/cost/cost-ledger.test.ts"
  "tests/queue/reclaim-boundary.test.ts"
  "tests/queue/spool.test.ts"
  "tests/safety/danger-rails.test.ts"
  "tests/safety/no-silent-catch.test.ts"
  "tests/security/admin-gate.test.ts"
  "tests/security/ahb-regression.test.ts"
  "tests/security/anonymous-checkout-isolation.test.ts"
  "tests/security/checkout-client-idempotency-token.test.ts"
  "tests/security/storefront-checkout-double-click.test.ts"
  "tests/security/storefront-checkout-rate-limit.test.ts"
  "tests/security/tenant-checkout-isolation.test.ts"
  "tests/security/recipe-atomic-write.test.ts"
  "tests/security/recipe-validator.test.ts"
  "tests/security/ssrf.test.ts"
  "tests/security/tnr-snapshot.test.ts"
  "tests/observability/agent-trace.test.ts"
  "tests/concurrency/admission-control.test.ts"
  "tests/security/trigger-rate-limit.test.ts"
  "tests/security/webhook-auth.test.ts"
  "tests/storage/conversation-idor.test.ts"
  "tests/storage/tenant-context-propagation.test.ts"
  "tests/storage/tenant-context.test.ts"
  "tests/storage/tenant-isolation.test.ts"
  "tests/storage/tenant-scope.test.ts"
  "tests/tools/dispatch.test.ts"
  "tests/video/r99-services.test.ts"
  "tests/video/r99-1-refs.test.ts"
  "tests/lib/stuck-task-sweep.test.ts"
  "tests/lib/output-skills.test.ts"
  "tests/lib/scheduled-post-runner.test.ts"
  "tests/lib/mcp-api-keys.test.ts"
)

PASS=0
FAIL=0

for f in "${FILES[@]}"; do
  echo "=== $f ==="
  if timeout 60 node --import tsx --test "$f"; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    echo "FAIL: $f"
  fi
done

echo ""
echo "==============================="
echo "  Node suites passed: $PASS"
echo "  Node suites failed: $FAIL"
echo "==============================="

# ---------------------------------------------------------------------------
# Playwright e2e suite (real-browser regressions). Currently only the
# storefront Buy button per-mount idempotency token check
# (tests/e2e/store-buy-idempotency.spec.ts), which complements the
# server-side double-click test by verifying the BROWSER actually
# emits the same per-mount token across two clicks. Requires the dev
# server reachable at STORE_E2E_BASE_URL (default http://127.0.0.1:5000)
# and Chromium installed via `npx playwright install chromium`.
#
# Skip cleanly with RUN_E2E=0 when the environment can't run a browser
# (e.g. minimal CI containers without the chromium system libs).
# ---------------------------------------------------------------------------
if [ "${RUN_E2E:-1}" != "0" ]; then
  echo ""
  echo "=== Playwright e2e: tests/e2e/ ==="
  if timeout 120 npx playwright test --config tests/e2e/playwright.config.ts; then
    echo "Playwright e2e: PASS"
  else
    FAIL=$((FAIL + 1))
    echo "FAIL: Playwright e2e suite"
  fi
else
  echo ""
  echo "Skipping Playwright e2e suite (RUN_E2E=0)"
fi

if [ "$FAIL" -gt 0 ]; then exit 1; fi
exit 0
