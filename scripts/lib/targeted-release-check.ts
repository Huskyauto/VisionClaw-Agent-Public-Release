import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { closeSync, openSync, writeSync } from "node:fs";
import { sanitizeSpawnEnv } from "../../server/safety/spawn-env-guard";
import { BWB_VERIFICATION_INPUTS, BWB_VERIFICATION_TESTS, MEDIA_VERIFICATION_INPUTS, MEDIA_VERIFICATION_TESTS } from "./bwb-verification-profile";
import { isReleaseRuntimeArtifact } from "./release-runtime-artifacts";

const KNOWN_RISK_TESTS = [
  "tests/security/tenant-audit-blockers.test.ts",
  "tests/security/tenant-audit-blocker-batch.test.ts",
  "tests/security/residual-tenant-audit.test.ts",
  "tests/security/retained-tenant-audit-scope.test.ts",
  "tests/security/completed-tenant-audit-remediation.test.ts",
  "tests/security/republish-tenant-query-boundaries.test.ts",
];

const AREA_TESTS: Record<string, string[]> = {
  "legion-offload": [
    "tests/providers/spark-relay-alerts.test.ts",
    "tests/providers/spark-relay-contract.test.ts", "tests/providers/spark-relay-fallback.test.ts",
    "tests/providers/spark-relay-api.test.ts", "tests/providers/spark-relay-worker.test.ts",
    "tests/providers/spark-relay-store.test.ts",
    "tests/providers/legion-felix-diagnostics.test.ts",
    "tests/providers/legion-felix-runtime.test.ts",
    "tests/providers/legion-mellum-policy.test.ts",
    "tests/providers/legion-background.test.ts", "tests/providers/legion-nightly.test.ts",
    "tests/providers/local-memory-tasks.test.ts", "tests/providers/local-response-failover.test.ts",
    "tests/providers/surface-routing.test.ts", "tests/lib/compaction-ladder.test.ts",
    "tests/lib/compaction-bookmark.test.ts", "tests/lib/compaction-reconciliation.test.ts",
    "tests/providers/simple-runbook-rule.test.ts", "tests/providers/local-slots.test.ts",
  ],
  auth: [
    "tests/security/tenant-auth-revocation.test.ts",
    "tests/lib/mcp-api-keys.test.ts",
    "tests/security/mcp-credential-storage.test.ts",
    "tests/security/mcp-context-ingress.test.ts",
  ],
  network: [
    "tests/security/tool-fetch-dns-pinning.test.ts",
    "tests/security/structured-extraction-fetch-boundary.test.ts",
    "tests/security/ssrf-fetch-pinned.test.ts",
  ],
  audit: [
    "tests/lib/republish-incremental-readiness.test.ts",
    "tests/lib/tenant-audit-completion.test.ts",
    "tests/lib/tenant-audit-fallback.test.ts",
    "tests/lib/tenant-audit-job-state.test.ts",
    "tests/lib/tenant-audit-runner.test.ts",
    "tests/lib/tenant-audit-recovery-controller.test.ts",
    "tests/security/tenant-audit-provider-policy.test.ts",
    "tests/security/tenant-audit-call-timeout.test.ts",
    "tests/security/tenant-audit-checkpoint-jsonb.test.ts",
    "tests/security/tenant-audit-chunk-size.test.ts",
    "tests/lib/tenant-audit-coordinator.test.ts",
    "tests/lib/tenant-audit-parallel-integration.test.ts",
  ],
  "public-interface": [
    "tests/release-source-surfaces.test.ts",
    "tests/prepublish-surface-sync.test.ts",
    "tests/release-landing-surface.test.ts",
    "tests/release-static-metadata.test.ts",
    "tests/ai-stack-decision-mobile.test.ts",
    "tests/ai-stack-decision-package.test.ts",
    "tests/release-facts-contract.test.ts",
    "tests/security/legal-pages-processor-sync.test.ts",
  ],
  "release-tooling": [
    "tests/lib/targeted-release-check.test.ts", "tests/lib/release-runtime-artifacts.test.ts",
    "tests/lib/remote-release-tree.test.ts", "tests/lib/remote-release-renew.test.ts",
    "tests/lib/republish-incremental-readiness.test.ts", "tests/lib/public-mirror-contract.test.ts",
    "tests/lib/republish-readiness-cli.test.ts",
    "tests/lib/offline-verification.test.ts", "tests/lib/remote-release-worker.test.ts",
    "tests/lib/remote-release-verifier.test.ts", "tests/lib/remote-release-github.test.ts",
    "tests/lib/remote-release-candidate.test.ts", "tests/lib/remote-release-evidence.test.ts",
    "tests/lib/remote-release-operator.test.ts", "tests/lib/remote-release-setup.test.ts",
    "tests/lib/prepublish-remote-gate.test.ts",
  ],
  "harness-benchmark": ["tests/lib/harness-bench-core.test.ts", "tests/unit/felix-outcome-loop-integration.test.ts"],
  "google-workspace": [
    "tests/security/google-workspace-slides-sharing.test.ts",
    "tests/lib/google-connector-ownership.test.ts",
    "tests/lib/gmail-owner-inbox-delivery.test.ts",
    "tests/lib/google-drive-permissions.test.ts",
    "tests/lib/google-drive-multipart-upload.test.ts",
    "tests/security/google-drive-recovery-contract.test.ts",
  ],
  "scheduled-replay": [
    "tests/unit/golden-path-replay-authority.test.ts",
    "tests/unit/golden-path-replay-evidence.test.ts",
    "tests/unit/golden-path-pdf-artifact.test.ts",
    "tests/unit/golden-path-fixture-filter.test.ts",
    "tests/unit/golden-path-two-scene-video.test.ts",
    "tests/unit/golden-path-video-job-columns.test.ts",
    "tests/unit/golden-path-run-summary.test.ts",
    "tests/unit/maintenance-log-retention.test.ts",
    "tests/security/tool-authority-boundary.test.ts",
    "tests/email/owner-delivery-email.test.ts",
  ],
  bwb: [...BWB_VERIFICATION_TESTS],
  "media-verification": [...MEDIA_VERIFICATION_TESTS],
  "run-confirmation": [
    "tests/lib/structured-prompt-profile.test.ts", "tests/lib/harness-ab-sample.test.ts",
    "tests/lib/run-confirmation.test.ts", "tests/lib/plan-run-confirmation.test.ts",
    "tests/lib/project-confirmation.test.ts",
    "tests/security/plan-executor-tool-step-gate.test.ts",
    "tests/security/plan-lobster-policy-gate.test.ts",
    "tests/security/release-plan-access.test.ts",
    "tests/lib/replay-sanitize.test.ts",
    "tests/unit/plan-finalization.test.ts",
    "tests/unit/executable-plan-structure.test.ts",
    "tests/plan-step-resilience.test.ts",
  ],
  documents: ["tests/security/pdf-input-ownership.test.ts", "tests/security/retained-tenant-audit-scope.test.ts"],
  payments: [
    "tests/security/mission-stripe-association.test.ts",
    "tests/lib/revenue-missions-guards.test.ts",
    "tests/lib/service-review-mission-linkage.test.ts",
    "tests/lib/mission-economics.test.ts",
    "tests/unit/subscription-jury-recovery.test.ts",
  ],
  "plan-ownership": ["tests/security/release-plan-access.test.ts"],
  "memory-ownership": ["tests/security/storage-required-tenant-boundaries.test.ts"],
  "model-intelligence": ["tests/lib/research-model-intelligence.test.ts", "tests/unit/research-evidence-instructions.test.ts"],
  "glm54-development-trial": ["tests/lib/glm54-development-trial.test.ts"],
  "daily-insights": ["tests/daily-ai-insights.test.ts", "tests/deployment/daily-insights-capabilities.test.ts",
    "tests/lib/persona-sync-completion.test.ts", "tests/security/persona-tools-doc-order.test.ts"],
  "layout-review": ["tests/unit/glm54-layout-review.test.ts"],
  "company-package-status": ["tests/lib/company-package-cost-summary.test.ts", "tests/lib/company-package-v3-api.test.ts"],
  "idea-decisions": ["tests/lib/ideabrowser-scenario.test.ts", "tests/lib/ideabrowser-scenario-decision.test.ts",
    "tests/revenue-idea-catalog.test.ts"],
  "invoice-pilot": ["tests/lib/invoice-pilot-evaluation.test.ts", "tests/invoice-pilot-cli.test.ts"],
  "report-guard": ["tests/unit/report-regression-guard.test.ts"],
  "provider-routing": ["tests/providers/cheaper-inference.test.ts", "tests/providers/cheaper-inference-automatic.test.ts"],
  "upload-sandbox": ["tests/security/uploads-read-tenant-gate.test.ts", "tests/security/uploads-http-path.test.ts"],
  "watchlist-authority": ["tests/security/watchlist-route-authority.test.ts"],
  "republication-fixes": ["tests/security/republication-finding-fixes.test.ts"],
  "republish-ownership": [
    "tests/security/upload-direct-callsites.test.ts",
    "tests/security/tnr-plumbing-fail-closed.test.ts",
    "tests/security/whatsapp-auth-namespace.test.ts",
    "tests/security/research-intel-tenant-authority.test.ts",
    "tests/security/proposed-skill-global-authority.test.ts",
    "tests/security/generated-social-image-ownership.test.ts",
    "tests/security/republish-orchestration-ownership.test.ts",
    "tests/security/republish-media-file-ownership.test.ts",
    "tests/security/media-verified-reference-staging.test.ts",
    "tests/security/delegation-gate-command-floor.test.ts",
    "tests/security/exec-lobster-owner-gate.test.ts",
    "tests/security/exec-catastrophic-floor.test.ts",
    "tests/tools/migrated-surface-guard.test.ts",
    "tests/tools/dispatcher.test.ts",
  ],
  "verification-harness": ["tests/sandbox/firewall.test.ts", "tests/security/muse-revenue-orchestrator-api.test.ts",
    "tests/security/route-census.test.ts", "tests/unit/report-regression-guard.test.ts"],
  // This integration needs its own bounded development-DB step, not the offline fixture lane.
  "muse-s2-integration": [],
  packaging: [
    "tests/deployment/publish-snapshot.test.cjs",
    "tests/deployment/portable-install.test.cjs",
    "tests/deployment/portable-preflight.test.cjs",
    "tests/deployment/ci-audit-progress.test.cjs",
    "tests/security/private-workspace-publisher-contract.test.ts",
    "tests/security/publish-preflight.test.ts",
    "tests/docker-release-facts-context.test.ts",
  ],
  "working-context": [
    "tests/lib/agent-working-context.test.ts",
    "tests/lib/working-context-service.test.ts",
    "tests/lib/working-context-wiring.test.ts",
    "tests/lib/working-context-preview-comparison.test.ts",
    "tests/storage/agent-working-context-isolation.test.ts",
    "tests/security/app-review-followthrough.test.ts",
    "tests/security/reviewer-bias-guard.test.ts",
  ],
  "finished-not-billed": [
    "tests/unit/finished-not-billed.test.ts",
    "tests/lib/company-package-v3-api.test.ts",
    "tests/lib/company-package-cost-summary.test.ts",
  ],
  "chat-runtime": [
    "tests/tools/schema-discovery-routing.test.ts",
    "tests/copilot-chat.test.ts",
    "tests/client/chat-disconnect-reconciliation.test.ts",
    "tests/client/chat-stream-error-classification.test.ts",
    "tests/client/chat-markdown-normalization.test.ts",
    "tests/unit/chat-context-provenance.test.ts",
    "tests/unit/chat-default-model.test.ts",
    "tests/unit/chat-response-validation.test.ts",
    "tests/unit/chat-tool-call-parser.test.ts",
    "tests/unit/chat-deliverables.test.ts",
    "tests/tools/chat-completion-reserve.test.ts",
    "tests/tools/tool-routing-context.test.ts",
    "tests/tools/chat-engine-tool-budget.test.ts",
    "tests/lib/context-acquisition-policy.test.ts",
    "tests/lib/trusted-project-context.test.ts",
  ],
  "memory-runtime": [
    "tests/memory/safe-triple-error.test.ts",
    "tests/memory/temporal-triple-store.test.ts",
    "tests/memory/temporal-triple-interval.test.ts",
    "tests/memory/temporal-triple-key.test.ts",
    "tests/memory/memory-stats-aggregation.test.ts",
    "tests/memory/forgetting-coordinator.test.ts",
    "tests/memory/tombstone-boundary.test.ts",
    "tests/memory/forgetting-policy.test.ts",
    "tests/lib/memory-deep-gate.test.ts",
    "tests/lib/memory-link-types.test.ts",
    "tests/lib/memory-relationship-wiring.test.ts",
    "tests/lib/memory-relationship-classifier.test.ts",
    "tests/lib/memory-supersede-gate.test.ts",
    "tests/unit/memory-ranking-exploration.test.ts",
  ],
  "backup-safety": [
    "tests/security/backup-confidentiality.test.ts",
    "tests/security/memory-backup-uses-delivery-pipeline.test.ts",
    "tests/unit/memory-backup-bundle.test.ts",
    "tests/unit/memory-backup-runner.test.ts",
    "tests/lib/report-hypothesis-backup.test.ts",
  ],
  "provider-runtime": [
    "tests/providers/gpt-6-2.test.ts",
    "tests/providers/gpt-6-astra-access.test.ts",
    "tests/providers/surface-transport.test.ts",
    "tests/lib/chat-model-identity.test.ts",
    "tests/unit/chat-default-model.test.ts",
    "tests/unit/owner-work-model-policy.test.ts",
  ],
  "owner-operations": [
    "tests/unit/owner-frontier-refresh.test.ts",
    "tests/lib/owner-business-overview.test.ts",
    "tests/lib/owner-weekly-digest.test.ts",
    "tests/integration/owner-only-http.test.ts",
  ],
  "business-operations": [
    "tests/lib/owner-business-overview.test.ts",
    "tests/lib/owner-weekly-digest.test.ts",
    "tests/revenue-idea-catalog.test.ts",
    "tests/lib/company-package-cost-summary.test.ts",
    "tests/unit/finished-not-billed.test.ts",
  ],
  "agent-runtime": [
    "tests/agentic/rejected-plan-dedup.test.ts",
    "tests/minerva-s6-lifecycle-projection.test.ts",
    "tests/minerva-operational-plan-contract.test.ts",
    "tests/lib/moa-pool.test.ts",
    "tests/lib/moa-aggregator-prompt.test.ts",
    "tests/lib/moa-frontier-reserve.test.ts",
    "tests/lib/moa-proposer-sanitization.test.ts",
    "tests/unit/felix-outcome-loop-integration.test.ts",
    "tests/unit/owner-work-model-policy.test.ts",
    "tests/tools/dispatcher.test.ts",
  ],
  "queue-runtime": [
    "tests/queue/spool.test.ts",
    "tests/queue/owner-priority.test.ts",
    "tests/security/operator-job-ownership.test.ts",
  ],
  "proposal-verifier-runtime": [
    "tests/lib/proposal-verifier-process.test.ts",
    "tests/security/proposal-verifier-isolation-routing.test.ts",
  ],
  "billing-runtime": [
    "tests/cost/owner-jury-ceiling.test.ts",
    "tests/unit/subscription-jury-recovery.test.ts",
    "tests/lib/company-package-cost-summary.test.ts",
    "tests/lib/revenue-missions-guards.test.ts",
  ],
};

// Shared entry points must select every affected boundary, not whichever
// feature happens to be listed last in the path table.
AREA_TESTS["shared-release-entrypoints"] = [...new Set([
  ...AREA_TESTS["daily-insights"], ...AREA_TESTS["layout-review"],
  ...AREA_TESTS["company-package-status"], ...AREA_TESTS["idea-decisions"],
  ...AREA_TESTS["provider-routing"], ...AREA_TESTS["upload-sandbox"],
  ...AREA_TESTS["verification-harness"], ...AREA_TESTS["public-interface"],
  ...AREA_TESTS["legion-offload"],
  ...AREA_TESTS["auth"], ...AREA_TESTS["network"], ...AREA_TESTS["audit"],
  ...AREA_TESTS["documents"], ...AREA_TESTS["payments"], ...AREA_TESTS["plan-ownership"],
  ...AREA_TESTS["memory-ownership"], ...AREA_TESTS["model-intelligence"],
  ...AREA_TESTS["google-workspace"], ...AREA_TESTS["bwb"], ...AREA_TESTS["media-verification"],
  ...AREA_TESTS["run-confirmation"], ...AREA_TESTS["republish-ownership"],
  ...AREA_TESTS["republication-fixes"], ...AREA_TESTS["packaging"],
  ...AREA_TESTS["working-context"], ...AREA_TESTS["finished-not-billed"],
  ...AREA_TESTS["chat-runtime"], ...AREA_TESTS["memory-runtime"],
  ...AREA_TESTS["backup-safety"], ...AREA_TESTS["provider-runtime"],
  ...AREA_TESTS["owner-operations"], ...AREA_TESTS["business-operations"],
  ...AREA_TESTS["agent-runtime"], ...AREA_TESTS["queue-runtime"], ...AREA_TESTS["billing-runtime"],
  ...AREA_TESTS["proposal-verifier-runtime"],
])];

const PATH_AREAS: Record<string, string> = {
  "shared/schema.ts": "shared-release-entrypoints",
  "server/routes/api-v1.ts": "shared-release-entrypoints",
  "server/tenant-constants.ts": "shared-release-entrypoints",
  "server/tools/lib/tenant-constants.ts": "shared-release-entrypoints",
  "server/health-monitor.ts": "shared-release-entrypoints",
  "server/legion/background-runtime.ts": "legion-offload",
  "server/legion/local-slots.ts": "legion-offload",
  "server/legion/nightly.ts": "legion-offload",
  "server/legion/spark-relay-alert-runtime.ts": "legion-offload",
  "server/legion/spark-relay-alert-store.ts": "legion-offload",
  "server/legion/spark-relay-alerts.ts": "legion-offload",
  "server/lib/proposal-verifier-process.ts": "proposal-verifier-runtime",
  "tests/lib/proposal-verifier-process.test.ts": "proposal-verifier-runtime",
  "tests/security/proposal-verifier-isolation-routing.test.ts": "proposal-verifier-runtime",
  "BRAND.md": "public-interface",
  ".agents/skills/post-edit-code-review/SKILL.md": "release-tooling",
  ".agents/skills/post-edit-pipeline/SKILL.md": "release-tooling",
  "scripts/lib/release-runtime-artifacts.ts": "release-tooling",
  "scripts/lib/remote-release-tree.ts": "release-tooling",
  "scripts/lib/remote-release-renew.ts": "release-tooling",
  "tests/lib/remote-release-renew.test.ts": "release-tooling",
  ".dockerignore": "packaging",
  ".github/workflows/docs.yml": "release-tooling",
  "client/src/App.tsx": "shared-release-entrypoints",
  "client/src/components/business-pilots/health-workbench.tsx": "business-operations",
  "client/src/hooks/use-site-config.ts": "public-interface",
  "client/src/pages/admin-finished-not-billed.tsx": "finished-not-billed",
  "data/feature-contracts/agent-working-context/plan.md": "working-context",
  "data/feature-contracts/agent-working-context/spec.md": "working-context",
  "data/feature-contracts/agent-working-context/verification.md": "working-context",
  "data/feature-contracts/finished-but-not-billed/plan.md": "finished-not-billed",
  "data/feature-contracts/finished-but-not-billed/spec.md": "finished-not-billed",
  "data/feature-contracts/laptop-memory-work/plan.md": "memory-runtime",
  "data/feature-contracts/laptop-memory-work/spec.md": "memory-runtime",
  "data/youtube/brand-style-guide.md": "bwb",
  "data/youtube/scripts/_template.json": "bwb",
  "data/youtube/scripts/video-01-origin-story.json": "bwb",
  "data/youtube/video-01-origin-story-script.md": "bwb",
  "scripts/lib/publish-workspace-boundary.cjs": "packaging",
  "scripts/prepare-publish-snapshot.cjs": "packaging",
  "scripts/surface-local-preflight.ts": "public-interface",
  "scripts/verify-counts.ts": "public-interface",
  "server/agentic/cost-ledger.ts": "billing-runtime",
  "server/auto-consolidation.ts": "memory-runtime",
  "server/chat-engine.ts": "chat-runtime",
  "server/tool-router.ts": "chat-runtime",
  "server/chat-engine/project-context.ts": "chat-runtime",
  "server/context-window-guard.ts": "chat-runtime",
  "server/firecrawl.ts": "network",
  "server/google-drive.ts": "google-workspace",
  "server/insights-engine.ts": "daily-insights",
  "server/job-spool.ts": "queue-runtime",
  "server/lib/agent-working-context.ts": "working-context",
  "server/lib/backup-confidentiality.ts": "backup-safety",
  "server/lib/gpt-6-2.ts": "provider-runtime",
  "server/lib/mcp-api-keys.ts": "auth",
  "server/lib/owner-frontier-refresh.ts": "owner-operations",
  "server/lib/owner-service-offerings.ts": "business-operations",
  "server/lib/stream-create-timeout.ts": "chat-runtime",
  "server/lib/stripe-migration-retry.ts": "payments",
  "server/lib/subscription-jury-recovery.ts": "payments",
  "server/memory-graph.ts": "memory-runtime",
  "server/memory-intelligence.ts": "memory-runtime",
  "server/minerva-planner.ts": "agent-runtime",
  "server/moa.ts": "agent-runtime",
  "server/model-registry.ts": "provider-runtime",
  "server/resource-predictor.ts": "billing-runtime",
  "server/site-config.ts": "public-interface",
  "server/tools/domains/income-opportunities/handlers.ts": "business-operations",
  "server/tools/domains/multiagent/definitions.ts": "agent-runtime",
  "server/tools/domains/web/definitions.ts": "network",
  "server/structured-extraction.ts": "network",
  "server/tools/domains/structured-extraction/definitions.ts": "network",
  "client/src/components/local-maintenance-panel.tsx": "legion-offload",
  "server/working-context-store.ts": "working-context",
  "server/working-context.ts": "working-context",
  "shared/lib/finished-not-billed.ts": "finished-not-billed",
  "tests/deployment/publish-snapshot.test.cjs": "packaging",
  "tests/docker-release-facts-context.test.ts": "public-interface",
  "tests/lib/agent-working-context.test.ts": "working-context",
  "tests/lib/startup-readiness-contract.test.ts": "public-interface",
  "tests/lib/working-context-preview-comparison.test.ts": "working-context",
  "tests/lib/working-context-service.test.ts": "working-context",
  "tests/lib/working-context-wiring.test.ts": "working-context",
  "tests/minerva-s6-lifecycle-projection.test.ts": "agent-runtime",
  "tests/providers/gpt-6-2.test.ts": "provider-runtime",
  "tests/providers/surface-transport.test.ts": "provider-runtime",
  "tests/queue/spool.test.ts": "queue-runtime",
  "tests/security/app-review-followthrough.test.ts": "working-context",
  "tests/security/backup-confidentiality.test.ts": "backup-safety",
  "tests/security/reviewer-bias-guard.test.ts": "agent-runtime",
  "tests/storage/agent-working-context-isolation.test.ts": "working-context",
  "tests/unit/finished-not-billed.test.ts": "finished-not-billed",
  "tests/unit/firecrawl-v2.test.ts": "network",
  "tests/unit/owner-frontier-refresh.test.ts": "owner-operations",
  "data/feature-contracts/legion-mellum-offload/plan.md": "legion-offload",
  "data/feature-contracts/legion-mellum-offload/spec.md": "legion-offload",
  "server/legion/model-policy.ts": "legion-offload",
  "server/legion/felix-diagnostics.ts": "legion-offload",
  "server/legion/felix-diagnostics-runtime.ts": "legion-offload",
  "server/tools/domains/system/definitions.ts": "legion-offload",
  "server/legion/background.ts": "legion-offload",
  "server/legion/local-router.ts": "legion-offload",
  "server/legion/local-provider-runtime.ts": "legion-offload",
  "server/legion/memory-tasks.ts": "legion-offload",
  "server/legion/memory-runtime.ts": "legion-offload",
  "server/legion/runbook.ts": "legion-offload",
  "server/legion/runbook-hosted.ts": "legion-offload",
  "server/legion/simple-runbook-rule.ts": "legion-offload",
  "server/dream-consolidation.ts": "legion-offload",
  "server/legion/nightly-policy.ts": "legion-offload",
  "server/legion/runtime.ts": "legion-offload",
  "server/legion/warmup.ts": "legion-offload",
  "server/legion/routine-contract.ts": "legion-offload",
  "server/legion/routine-offload.ts": "legion-offload",
  "server/legion/routine-runtime.ts": "legion-offload",
  "server/compaction.ts": "legion-offload",
  "server/routes/local-maintenance.ts": "legion-offload",
  ...Object.fromEntries([
    "server/legion/spark-relay-contract.ts", "server/legion/spark-relay-store.ts",
    "server/legion/spark-relay-runtime.ts", "server/legion/spark-relay-fallback.ts",
    "server/legion/spark-relay-schema.ts", "server/routes/spark-legion-relay.ts",
    "scripts/spark-legion-worker.py", "scripts/spark-legion-relay-schema.ts",
    "shared/agent-job-status.ts", "client/src/components/spark-relay-status.tsx",
    "tests/providers/spark-relay-contract.test.ts", "tests/providers/spark-relay-fallback.test.ts",
    "tests/providers/spark-relay-api.test.ts", "tests/providers/spark-relay-worker.test.ts",
    "tests/providers/spark-relay-store.test.ts", "tests/python/test_spark_legion_worker.py",
    "docs/spark-legion-relay-protocol.md", "docs/spark-legion-worker-install.md",
    "docs/spark-legion-relay-review.md", "docs/spark-legion-relay-handoff.md",
    "data/feature-contracts/spark-legion-relay/spec.md", "data/feature-contracts/spark-legion-relay/plan.md",
  ].map(path => [path, "legion-offload"])),
  "scripts/legion-direct-smoke.ts": "legion-offload",
  "scripts/legion-mellum-acceptance.ts": "legion-offload",
  ".agents/agent_assets_metadata.toml": "release-tooling",
  ".agents/skills/visionclaw-config-and-flags/SKILL.md": "shared-release-entrypoints",
  ".env.example": "shared-release-entrypoints",
  ".github/workflows/ci.yml": "report-guard",
  ".github/workflows/security-checks.yml": "audit",
  "scripts/lib/report-regression-cases.ts": "report-guard",
  "scripts/lib/report-regression-guard.ts": "report-guard",
  "client/src/components/company-report-package.tsx": "company-package-status",
  "server/lib/company-package-cost-summary.ts": "company-package-status",
  "server/lib/company-compilation-content.ts": "report-guard",
  "server/routes/company-report-packages.ts": "company-package-status",
  "client/src/components/glm54-layout-review.tsx": "layout-review",
  "client/src/pages/website-audit.tsx": "layout-review",
  "server/lib/glm54-layout-review.ts": "layout-review",
  "server/routes/glm54-layout-review.ts": "layout-review",
  "shared/glm54-layout-contract.ts": "layout-review",
  "data/feature-contracts/glm54-layout-review/spec.md": "layout-review",
  "data/feature-contracts/glm54-layout-review/plan.md": "layout-review",
  "scripts/daily-ai-insights.ts": "daily-insights",
  "scripts/agent-knowledge-refresh.ts": "daily-insights",
  "server/daily-ai-insights/capabilities.ts": "daily-insights",
  "server/daily-ai-insights/core.ts": "daily-insights",
  "server/daily-ai-insights/drive.ts": "daily-insights",
  "server/daily-ai-insights/handoff.ts": "daily-insights",
  "server/daily-ai-insights/intake.ts": "daily-insights",
  "server/daily-ai-insights/review.ts": "daily-insights",
  "server/daily-ai-insights/runner.ts": "daily-insights",
  "server/daily-ai-insights/store.ts": "daily-insights",
  "server/routes/daily-ai-insights.ts": "daily-insights",
  "server/persona-sync.ts": "daily-insights",
  "data/feature-contracts/daily-ai-insights/spec.md": "daily-insights",
  "data/feature-contracts/daily-ai-insights/plan.md": "daily-insights",
  "scripts/ideabrowser-master-scenario.ts": "idea-decisions",
  "scripts/ideabrowser-weekly-scenario.ts": "idea-decisions",
  "server/lib/ideabrowser-scenario.ts": "idea-decisions",
  "server/lib/ideabrowser-scenario-decision.ts": "idea-decisions",
  "server/lib/revenue-idea-catalog.ts": "idea-decisions",
  "scripts/evaluate-invoice-pilot.ts": "invoice-pilot",
  "server/lib/invoice-pilot-evaluation.ts": "invoice-pilot",
  "project-assets/customer-revenue-launchpad/offers/06-hvac-invoice-processing-pilot.md": "invoice-pilot",
  "server/lib/cheaper-inference-automatic.ts": "provider-routing",
  "server/providers.ts": "provider-routing",
  "server/index.ts": "shared-release-entrypoints",
  "server/routes.ts": "shared-release-entrypoints",
  "server/routes/admin.ts": "daily-insights",
  "server/routes/audit.ts": "shared-release-entrypoints",
  "server/capability-registry.ts": "shared-release-entrypoints",
  "server/routes/watchlist.ts": "watchlist-authority",
  "server/routes/heartbeat.ts": "memory-ownership",
  "client/src/components/seo-head.tsx": "public-interface",
  "client/src/pages/about.tsx": "public-interface",
  "client/src/pages/trust.tsx": "public-interface",
  "tests/fixtures/route-census.json": "verification-harness",
  "tests/run.sh": "shared-release-entrypoints",
  "tests/integration/muse-s2-adapter.test.ts": "muse-s2-integration",
  "scripts/evaluate-glm54-development.ts": "glm54-development-trial",
  "scripts/lib/glm54-development-trial.ts": "glm54-development-trial",
  "scripts/lib/glm54-checkout.png": "glm54-development-trial",
  "server/lib/research-model-intelligence.ts": "model-intelligence",
  "server/research-model-source.ts": "model-intelligence",
  "server/research-engine.ts": "model-intelligence",
  "server/research-proposals.ts": "model-intelligence",
  "server/seed-infrastructure.ts": "model-intelligence",
  "server/lib/structured-task-prompt.ts": "run-confirmation",
  "server/lib/run-confirmation.ts": "run-confirmation",
  "server/lib/plan-run-confirmation.ts": "run-confirmation",
  "server/lib/harness-ab-sample.ts": "run-confirmation",
  "server/lib/harness-ab-fixtures.ts": "run-confirmation",
  "server/lib/harness-ab-representative-fixtures.ts": "run-confirmation",
  "server/llm-task.ts": "run-confirmation",
  "server/plan-executor.ts": "run-confirmation",
  "server/routes/agent-insights.ts": "run-confirmation",
  "server/routes/memory.ts": "memory-ownership",
  "server/storage.ts": "memory-ownership",
  "client/src/components/run-confirmation.tsx": "run-confirmation",
  "client/src/pages/workflow-replay.tsx": "run-confirmation",
  "scripts/project-confirmation.ts": "run-confirmation",
  "scripts/lib/project-confirmation.ts": "run-confirmation",
  "scripts/harness-ab-sample.ts": "run-confirmation",
  "scripts/harness-bench-report.ts": "harness-benchmark",
  "server/lib/harness-bench-core.ts": "harness-benchmark",
  "scripts/golden-path-replay.ts": "scheduled-replay",
  "scripts/lib/golden-path-replay-runtime.ts": "scheduled-replay",
  "server/heartbeat.ts": "scheduled-replay",
  "server/heartbeat-seed.ts": "scheduled-replay",
  "server/google-workspace.ts": "google-workspace",
  "server/auth.ts": "auth",
  "server/tools.ts": "republish-ownership",
  "server/lib/social-image-tool.ts": "republish-ownership",
  "server/lib/proposed-skill-tool.ts": "republish-ownership",
  "server/video-editor.ts": "republish-ownership",
  "server/agentic/self-heal.ts": "republish-ownership",
  "server/crews-engine.ts": "republish-ownership",
  "server/whatsapp-auth-store.ts": "republish-ownership",
  "server/tools/domains/files/handlers.ts": "republish-ownership",
  "server/tools/domains/files/definitions.ts": "republish-ownership",
  "server/tools/domains/research-intel/handlers.ts": "republish-ownership",
  "server/tools/lib/safe-fetch.ts": "network",
  "server/pdf-create.ts": "documents",
  "server/lib/pdf-input-ownership.ts": "documents",
  "server/tools/domains/documents/handlers.ts": "documents",
  "server/tools/domains/documents/definitions.ts": "documents",
  "server/ceo-orchestrator.ts": "plan-ownership",
  "server/webhookHandlers.ts": "payments",
  "server/lib/mission-stripe-association.ts": "payments",
  "server/tools/domains/commerce/handlers.ts": "payments",
  "server/job-worker.ts": "audit",
  "server/lib/tenant-audit-job-state.ts": "audit",
  "scripts/lib/tenant-audit-completion.ts": "audit",
  "scripts/lib/tenant-audit-fallback.ts": "audit",
  "scripts/tenant-isolation-audit.ts": "audit",
  "scripts/run-tenant-isolation-audit-resumable.ts": "audit",
  "scripts/lib/tenant-audit-coordinator.ts": "audit",
  "scripts/lib/tenant-audit-evidence-hash.ts": "audit",
  "scripts/targeted-release-check.ts": "release-tooling",
  "scripts/lib/targeted-release-check.ts": "release-tooling",
  "scripts/verify-republish-readiness.ts": "release-tooling",
  "scripts/lib/republish-incremental-readiness.ts": "release-tooling",
  "tests/lib/republish-incremental-readiness.test.ts": "release-tooling",
  "tests/lib/republish-readiness-cli.test.ts": "release-tooling",
  "tests/security/upload-direct-callsites.test.ts": "republish-ownership",
  "tests/agentic/rejected-plan-dedup.test.ts": "agent-runtime",
  "scripts/lib/offline-verification.ts": "release-tooling",
  "scripts/remote-release.ts": "release-tooling",
  "scripts/remote-release-worker.ts": "release-tooling",
  "scripts/remote-release-setup-worker.ts": "release-tooling",
  "scripts/lib/remote-release-setup.ts": "release-tooling",
  "scripts/prepublish.ts": "release-tooling",
  "scripts/lib/prepublish-remote-gate.ts": "release-tooling",
  "scripts/publish-preflight.ts": "release-tooling",
  "tsconfig.publish-preflight.json": "release-tooling",
  "tests/lib/prepublish-remote-gate.test.ts": "release-tooling",
  "scripts/lib/remote-release-contract.ts": "release-tooling",
  "scripts/lib/remote-release-plan.ts": "release-tooling",
  "scripts/lib/remote-release-verifier.ts": "release-tooling",
  "scripts/lib/remote-release-github.ts": "release-tooling",
  "scripts/lib/remote-release-candidate.ts": "release-tooling",
  "scripts/lib/remote-release-evidence.ts": "release-tooling",
  "tests/lib/remote-release-worker.test.ts": "release-tooling",
  "tests/lib/remote-release-verifier.test.ts": "release-tooling",
  "tests/lib/remote-release-github.test.ts": "release-tooling",
  "tests/lib/remote-release-candidate.test.ts": "release-tooling",
  "tests/lib/remote-release-evidence.test.ts": "release-tooling",
  "tests/lib/remote-release-operator.test.ts": "release-tooling",
  "tests/lib/remote-release-setup.test.ts": "release-tooling",
  "docs/github-release-checks.md": "release-tooling",
  "scripts/lib/bwb-verification-profile.ts": "bwb",
  ".agents/skills/bwb-weekly-recap/SKILL.md": "bwb",
  ".replitignore": "release-tooling",
  "scripts/build-public-mirror.sh": "release-tooling",
  "scripts/build.ts": "release-tooling",
  "scripts/lib/build-data-policy.ts": "release-tooling",
  "package.json": "release-tooling",
  "docs/release-facts.json": "public-interface",
  "docs/release-facts-input.json": "public-interface",
  "client/index.html": "public-interface",
  "client/public/manifest.json": "public-interface",
  "client/src/components/app-sidebar.tsx": "public-interface",
  "client/src/components/prepublication-notice.tsx": "public-interface",
  "client/src/components/recent-platform-updates.tsx": "public-interface",
  "client/src/data/updates.json": "public-interface",
  "client/src/pages/admin-ai-stack-decision-review.tsx": "public-interface",
  "client/src/pages/landing.tsx": "public-interface",
};
for (const file of BWB_VERIFICATION_INPUTS) PATH_AREAS[file] = "bwb";
for (const file of MEDIA_VERIFICATION_INPUTS) PATH_AREAS[file] = "media-verification";
for (const [area, tests] of Object.entries(AREA_TESTS)) {
  for (const file of tests) PATH_AREAS[file] = area;
}
for (const file of KNOWN_RISK_TESTS) PATH_AREAS[file] = "known-problems";

export function validReleasePath(file: string): boolean {
  return !!file && !file.startsWith("/") && !/[\u0000-\u001f\u007f\\]/.test(file) &&
    !file.split("/").some(part => !part || part === "." || part === "..");
}

function releaseDocument(file: string): boolean {
  return ["README.md", "README.md", "ROADMAP.md", "replit.md",
    "docs/CURRENT_PLATFORM_TOTALS.md"].includes(file) ||
    /^docs\/platform-update-\d{4}-\d{2}-\d{2}\.md$/.test(file);
}

function mutableAuditEvidence(file: string): boolean {
  // These are policy inputs, not mutable report output.
  if (["data/tenant-isolation-audit/suppressions.json", "data/tenant-isolation-audit/deferrals.json"].includes(file))
    return false;
  return /^data\/tenant-isolation-audit\/[^/]+\.(json|md)$/.test(file) ||
    /^docs\/tenant-isolation-audit-report(?:-[a-z0-9-]+)?\.md$/.test(file);
}

function informational(file: string): boolean {
  return (
    file === "project-assets/customer-revenue-launchpad/verified-referral-candidates-2026-11-26.md" ||
    (/\.md$/.test(file) && (
      !file.includes("/") || file.startsWith("docs/") || file.startsWith(".agents/memory/")
    )) ||
    /^data\/tenant-isolation-audit\/[^/]+\.(json|md)$/.test(file) ||
    ["docs/release-facts.json", "docs/release-facts-input.json", "docs/schema-snapshot.sql"].includes(file)
  );
}

export function classifyReleaseScope(paths: string[]) {
  const areas = new Set<string>(["known-problems", "release-tooling"]);
  const unknown: string[] = [], info: string[] = [];
  for (const file of [...new Set(paths)].sort()) {
    if (!validReleasePath(file)) unknown.push(file);
    else if (PATH_AREAS[file]) areas.add(PATH_AREAS[file]);
    else if (releaseDocument(file)) areas.add("public-interface");
    else if (informational(file)) info.push(file);
    else unknown.push(file);
  }
  const tests = new Set([...KNOWN_RISK_TESTS, ...AREA_TESTS["release-tooling"]]);
  for (const area of areas) for (const test of AREA_TESTS[area] ?? []) tests.add(test);
  return { areas: [...areas].sort(), tests: [...tests].sort(), unknown, informational: info };
}

export function digestReleaseInputs(inputs: { path: string; content: string | null }[]): string {
  const hash = createHash("sha256");
  for (const input of [...inputs].sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(JSON.stringify([input.path, input.content]));
    hash.update("\n");
  }
  return hash.digest("hex");
}

export function releaseInputPaths(tracked: string[], changed: string[]): string[] {
  // Bind all repository-visible inputs by default. Prefix allowlists silently
  // omitted deployment files, migrations, public assets and CI configuration.
  // Mutable audit evidence is checked separately by the readiness gate; private
  // verification output is deliberately outside the release source identity.
  return [...new Set([...tracked, ...changed])].filter(file =>
    !mutableAuditEvidence(file) &&
    !isReleaseRuntimeArtifact(file) &&
    !/^(?:\.local|\.git|node_modules|generated-artifacts)\//.test(file)).sort();
}

export function sameReleaseMembership(before: string[], after: string[]): boolean {
  return JSON.stringify([...new Set(before)].sort()) === JSON.stringify([...new Set(after)].sort());
}

export async function runBoundedReleaseCommand(command: string, args: string[], options: {
  logFile: string; timeoutMs: number; env?: NodeJS.ProcessEnv;
  maxLogBytes?: number;
  onSpawn?: (kill: (() => void) | undefined) => void;
}) {
  const maxLogBytes = options.maxLogBytes ?? 8 * 1024 * 1024;
  if (!Number.isSafeInteger(maxLogBytes) || maxLogBytes < 1 || maxLogBytes > 8 * 1024 * 1024)
    throw new Error("Invalid bounded log limit");
  const started = Date.now(), fd = openSync(options.logFile, "wx", 0o600);
  return await new Promise<{ passed: boolean; code: number | null; timedOut: boolean; outputLimitExceeded: boolean; elapsedMs: number }>(done => {
    let timedOut = false, settled = false, outputLimitExceeded = false, written = 0;
    const child = spawn(command, args, {
      detached: true, stdio: ["ignore", "pipe", "pipe"], env: options.env ?? sanitizeSpawnEnv(process.env),
    });
    const kill = () => {
      if (child.pid) try { process.kill(-child.pid, "SIGKILL"); } catch { /* already exited */ }
    };
    options.onSpawn?.(kill);
    const timer = setTimeout(() => { timedOut = true; kill(); }, options.timeoutMs);
    const capture = (chunk: Buffer) => {
      if (settled || outputLimitExceeded) return;
      const remaining = maxLogBytes - written;
      const bytes = chunk.subarray(0, Math.max(0, remaining));
      try {
        if (bytes.length) { writeSync(fd, bytes); written += bytes.length; }
      } catch {
        outputLimitExceeded = true; kill(); return;
      }
      if (chunk.length > remaining) { outputLimitExceeded = true; kill(); }
    };
    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true; clearTimeout(timer); kill(); closeSync(fd);
      options.onSpawn?.(undefined);
      done({ passed: code === 0 && !timedOut && !outputLimitExceeded, code, timedOut, outputLimitExceeded, elapsedMs: Date.now() - started });
    };
    child.once("error", () => finish(null));
    child.once("close", finish);
  });
}
