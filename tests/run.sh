#!/usr/bin/env bash
# VisionClaw security & tenant-isolation test runner.
# Each test file runs in its own node process so a heavy module-load in one
# file can't poison the others. Hard-fails on the first failure.
set -euo pipefail

# Preflight: domain-boundary gate for the tools-layer split. Cross-domain
# imports between server/tools/domains/<A> and <B> fail the suite immediately.
echo "=== preflight: domain boundaries ==="
if ! timeout 60 npx tsx scripts/preflight-domain-boundaries.ts; then
  echo "FAIL: domain-boundary preflight"
  exit 1
fi

FILES=(
  "tests/cost/cost-ledger.test.ts"
  "tests/cost/model-pricing-drift.test.ts"
  "tests/cost/anthropic-ceiling.test.ts"
  "tests/cost/owner-jury-ceiling.test.ts"
  "tests/venture-discovery/venture-guards.test.ts"
  "tests/queue/reclaim-boundary.test.ts"
  "tests/queue/spool.test.ts"
  "tests/queue/failure-taxonomy.test.ts"
  "tests/agentic/failure-contract.test.ts"
  "tests/orchestration/capability-review.test.ts"
  "tests/lib/bineval.test.ts"
  "tests/lib/tool-mispick.test.ts"
  "tests/lib/wake-scheduler-tenant.test.ts"
  "tests/lib/revenue-missions-guards.test.ts"
  "tests/lib/gap-tenant.test.ts"
  "tests/lib/ruler-rank.test.ts"
  "tests/lib/triage-verdict-match.test.ts"
  "tests/lib/deliverable-verifier-branches.test.ts"
  "tests/safety/danger-rails.test.ts"
  "tests/safety/no-silent-catch.test.ts"
  "tests/security/admin-gate.test.ts"
  "tests/security/ahb-regression.test.ts"
  "tests/security/route-census.test.ts"
  "tests/security/injection-scanner-patterns.test.ts"
  "tests/security/external-content-verbalization.test.ts"
  "tests/security/sandbox-escape.test.ts"
  "tests/sandbox/firewall.test.ts"
  "tests/sandbox/replay.test.ts"
  "tests/sandbox/promote-race.test.ts"
  "tests/security/redact-args.test.ts"
  "tests/security/anonymous-checkout-isolation.test.ts"
  "tests/security/checkout-client-idempotency-token.test.ts"
  "tests/security/storefront-checkout-double-click.test.ts"
  "tests/security/storefront-checkout-rate-limit.test.ts"
  "tests/security/tenant-checkout-isolation.test.ts"
  "tests/security/recipe-atomic-write.test.ts"
  "tests/security/recipe-validator.test.ts"
  "tests/security/ssrf.test.ts"
  "tests/security/briefings-geolocation-transport.test.ts"
  "tests/security/ssrf-ip-classifier.test.ts"
  "tests/security/tnr-snapshot.test.ts"
  "tests/security/metrics-endpoint-contract.test.ts"
  "tests/security/reserved-knowledge-category-guard.test.ts"
  "tests/security/agent-knowledge-redaction-guard.test.ts"
  "tests/security/browser-ssrf-request-guard.test.ts"
  "tests/security/recursive-llm-sandbox-escape.test.ts"
  "tests/security/sql-raw-callsite-allowlist.test.ts"
  "tests/security/uploads-read-tenant-gate.test.ts"
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
  "tests/tools/tool-cap.test.ts"
  "tests/lib/agui-events.test.ts"
  "tests/security/agui-scope-parity.test.ts"
  "tests/tools/dispatcher.test.ts"
  "tests/tools/migrated-surface-guard.test.ts"
  "tests/tools/migrated-research.test.ts"
  "tests/tools/legacy-switch-deletion-gate.test.ts"
  "tests/tools/source-union-parity.test.ts"
  "tests/tools/registry-invariants.test.ts"
  "tests/tools/public-api-tools.test.ts"
  "tests/tools/design-doc-tool.test.ts"
  "tests/tools/middleware-tracing.test.ts"
  "tests/tools/middleware-rate-limit.test.ts"
  "tests/tools/middleware-autonomy-gate.test.ts"
  "tests/tools/middleware-performance-ledger.test.ts"
  "tests/tools/middleware-step-ledger-record.test.ts"
  "tests/tools/middleware-product-verification.test.ts"
  "tests/tools/middleware-instant-play.test.ts"
  "tests/tools/middleware-action-ledger.test.ts"
  "tests/video/r99-services.test.ts"
  "tests/video/r99-1-refs.test.ts"
  "tests/lib/logger-correlation.test.ts"
  "tests/lib/offline-eval-core.test.ts"
  "tests/lib/memory-maintenance-eval-core.test.ts"
  "tests/lib/tool-smoke-core.test.ts"
  "tests/lib/autotts-discovery.test.ts"
  "tests/lib/split-system-for-cache.test.ts"
  "tests/unit/relevance-window-budget.test.ts"
  "tests/unit/claude-model-mapping.test.ts"
  "tests/unit/claude-bridge-parsing.test.ts"
  "tests/lib/autotts-knob-readiness.test.ts"
  "tests/lib/stuck-task-sweep.test.ts"
  "tests/lib/output-skills.test.ts"
  "tests/lib/orchestration-efficiency.test.ts"
  "tests/lib/jury-concordance-health.test.ts"
  "tests/lib/prompt-refiner.test.ts"
  "tests/reasoning-front-door.test.ts"
  "tests/security/adaptive-route-cost-exempt-scope.test.ts"
  "tests/lib/self-improvement-metrics.test.ts"
  "tests/lib/feedback-loop-accountability.test.ts"
  "tests/lib/scheduled-post-runner.test.ts"
  "tests/lib/mcp-api-keys.test.ts"
  "tests/lib/render-farm-cap.test.ts"
  "tests/lib/model-tier-eval.test.ts"
  "tests/lib/model-tier-external.test.ts"
  "tests/lib/model-ranking-autoadd.test.ts"
  "tests/lib/skill-optimizer.test.ts"
  "tests/lib/skill-optimizer-run.test.ts"
  "tests/unit/jury-skill-build.test.ts"
  "tests/unit/skill-activation-test.test.ts"
  "tests/lib/upload-signing-applink.test.ts"
  "tests/unit/self-health.test.ts"
  "tests/unit/code-sandbox-patterns.test.ts"
  "tests/unit/param-adaptation.test.ts"
  "tests/unit/resilient-output-failover.test.ts"
  "tests/unit/last-resort-model.test.ts"
  "tests/unit/repair-incident-classifier.test.ts"
  "tests/unit/repo-surgeon-audit-relax.test.ts"
  "tests/unit/jury-queue-integrity.test.ts"
  "tests/unit/escalation-resolver.test.ts"
  "tests/unit/autonomous-budget.test.ts"
  "tests/unit/prefer-oauth-subscriptions.test.ts"
  "tests/integration/repair-incident-capture.test.ts"
  "tests/agentic/autonomous-closer.test.ts"
  "tests/agentic/critic-coach.test.ts"
  "tests/agentic/stuck-detector.test.ts"
  "tests/agentic/ideabrowser-autobuild.test.ts"
  "tests/agentic/completion-evaluator.test.ts"
  "tests/agentic/completion-fraud-fixtures.test.ts"
  "tests/agentic/step-reward.test.ts"
  "tests/agentic/heal-revert-set.test.ts"
  "tests/lib/action-ledger.test.ts"
  "tests/lib/stripe-ledger-idempotency.test.ts"
  "tests/lib/action-ledger-retry.test.ts"
  "tests/lib/delivery-funnel.test.ts"
  "tests/unit/jury-queue-drain.test.ts"
  "tests/unit/climb-tracker.test.ts"
  "tests/unit/relevance-window.test.ts"
  "tests/unit/deterministic-picker.test.ts"
  "tests/unit/harness-adaptation.test.ts"
  "tests/lib/compaction-ladder.test.ts"
  "tests/security/step-executor-policy-guard.test.ts"
  "tests/security/plan-executor-tool-step-gate.test.ts"
  "tests/unit/grade-decision.test.ts"
  "tests/unit/revise-loop-tracker.test.ts"
  "tests/lib/deliverable-failure-modes.test.ts"
  "tests/lib/claim-verdict.test.ts"
  "tests/lib/moa-pool.test.ts"
  "tests/lib/moa-proposer-sanitization.test.ts"
  "tests/unit/proof-level.test.ts"
  "tests/unit/chronicle-precision.test.ts"
  "tests/regression/medium-fix-pins.test.ts"
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
