import test from "node:test";
import assert from "node:assert/strict";

test("Spark alerts and shared identity/schema paths retain broad release coverage", () => {
  const scope = classifyReleaseScope([
    "server/health-monitor.ts", "server/routes/api-v1.ts", "shared/schema.ts",
    "server/tenant-constants.ts", "server/tools/lib/tenant-constants.ts",
    "server/legion/background-runtime.ts", "server/legion/local-slots.ts",
    "server/legion/nightly.ts", "server/legion/spark-relay-alert-runtime.ts",
    "server/legion/spark-relay-alert-store.ts", "server/legion/spark-relay-alerts.ts",
    "tests/providers/spark-relay-alerts.test.ts",
  ]);
  assert.deepEqual(scope.unknown, []);
  for (const file of [
    "tests/providers/spark-relay-alerts.test.ts",
    "tests/providers/spark-relay-api.test.ts",
    "tests/lib/mcp-api-keys.test.ts",
    "tests/security/tenant-auth-revocation.test.ts",
    "tests/security/structured-extraction-fetch-boundary.test.ts",
    "tests/security/tnr-plumbing-fail-closed.test.ts",
    "tests/security/backup-confidentiality.test.ts",
  ]) assert.ok(scope.tests.includes(file), `missing shared-boundary check ${file}`);
});

test("landing release cards select the full source-surface regression set", () => {
  const scope = classifyReleaseScope(["client/src/components/recent-platform-updates.tsx"]);
  assert.deepEqual(scope.unknown, []);
  for (const path of ["tests/release-source-surfaces.test.ts", "tests/prepublish-surface-sync.test.ts",
    "tests/release-landing-surface.test.ts", "tests/release-static-metadata.test.ts"]) {
    assert.ok(scope.tests.includes(path), `missing release regression: ${path}`);
  }
});
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyReleaseScope, digestReleaseInputs, releaseInputPaths, sameReleaseMembership, runBoundedReleaseCommand } from "../../scripts/lib/targeted-release-check";
import { buildDataPolicy } from "../../scripts/lib/build-data-policy";
import { isReleaseRuntimeArtifact } from "../../scripts/lib/release-runtime-artifacts";

test("Felix diagnostics classify their exact source and menu changes and select both probe regressions", () => {
  const scope = classifyReleaseScope([
    "server/legion/felix-diagnostics.ts", "server/legion/felix-diagnostics-runtime.ts",
    "server/tool-router.ts", "server/tools/domains/system/definitions.ts",
    "tests/providers/legion-felix-diagnostics.test.ts", "tests/providers/legion-felix-runtime.test.ts",
    "tests/tools/schema-discovery-routing.test.ts",
  ]);
  assert.deepEqual(scope.unknown, []);
  for (const path of ["tests/providers/legion-felix-diagnostics.test.ts",
    "tests/providers/legion-felix-runtime.test.ts", "tests/tools/schema-discovery-routing.test.ts"])
    assert.ok(scope.tests.includes(path), `missing Felix diagnostic regression ${path}`);
});

test("the pending full-app source delta has explicit bounded feature and deployment mappings", () => {
  const pendingCodePaths = [
    ".agents/skills/post-edit-code-review/SKILL.md", ".agents/skills/post-edit-pipeline/SKILL.md",
    ".dockerignore", ".github/workflows/docs.yml", "client/src/App.tsx",
    "client/src/components/business-pilots/health-workbench.tsx", "client/src/hooks/use-site-config.ts",
    "client/src/pages/admin-finished-not-billed.tsx",
    "data/feature-contracts/agent-working-context/plan.md",
    "data/feature-contracts/agent-working-context/spec.md",
    "data/feature-contracts/agent-working-context/verification.md",
    "data/feature-contracts/finished-but-not-billed/plan.md",
    "data/feature-contracts/finished-but-not-billed/spec.md",
    "data/feature-contracts/laptop-memory-work/plan.md",
    "data/feature-contracts/laptop-memory-work/spec.md",
    "scripts/lib/release-runtime-artifacts.ts", "tests/lib/release-runtime-artifacts.test.ts",
    "scripts/lib/remote-release-tree.ts",
    "tests/lib/remote-release-tree.test.ts",
    "scripts/lib/publish-workspace-boundary.cjs", "scripts/prepare-publish-snapshot.cjs",
    "scripts/surface-local-preflight.ts", "scripts/verify-counts.ts",
    "server/agentic/cost-ledger.ts", "server/auto-consolidation.ts", "server/chat-engine.ts",
    "server/chat-engine/project-context.ts", "server/context-window-guard.ts", "server/firecrawl.ts",
    "server/google-drive.ts", "server/insights-engine.ts", "server/job-spool.ts",
    "server/lib/agent-working-context.ts", "server/lib/backup-confidentiality.ts",
    "server/lib/gpt-6-2.ts", "server/lib/mcp-api-keys.ts", "server/lib/owner-frontier-refresh.ts",
    "server/lib/owner-service-offerings.ts", "server/lib/stream-create-timeout.ts",
    "server/lib/stripe-migration-retry.ts", "server/lib/subscription-jury-recovery.ts",
    "server/memory-graph.ts", "server/memory-intelligence.ts", "server/minerva-planner.ts",
    "server/moa.ts", "server/model-registry.ts", "server/resource-predictor.ts", "server/site-config.ts",
    "server/tools/domains/income-opportunities/handlers.ts",
    "server/tools/domains/multiagent/definitions.ts", "server/tools/domains/web/definitions.ts",
    "server/working-context-store.ts", "server/working-context.ts", "shared/lib/finished-not-billed.ts",
    "tests/deployment/publish-snapshot.test.cjs", "tests/docker-release-facts-context.test.ts",
    "tests/lib/agent-working-context.test.ts", "tests/lib/startup-readiness-contract.test.ts",
    "tests/lib/working-context-preview-comparison.test.ts", "tests/lib/working-context-service.test.ts",
    "tests/lib/working-context-wiring.test.ts", "tests/minerva-s6-lifecycle-projection.test.ts",
    "tests/providers/gpt-6-2.test.ts", "tests/providers/surface-transport.test.ts",
    "tests/queue/spool.test.ts", "tests/security/app-review-followthrough.test.ts",
    "tests/security/backup-confidentiality.test.ts", "tests/security/reviewer-bias-guard.test.ts",
    "tests/storage/agent-working-context-isolation.test.ts", "tests/unit/finished-not-billed.test.ts",
    "tests/unit/firecrawl-v2.test.ts", "tests/unit/owner-frontier-refresh.test.ts",
  ];
  const scope = classifyReleaseScope(pendingCodePaths);
  assert.deepEqual(scope.unknown, []);
  for (const area of ["packaging", "working-context", "finished-not-billed", "chat-runtime",
    "memory-runtime", "backup-safety", "provider-runtime", "agent-runtime", "queue-runtime",
    "billing-runtime", "business-operations", "owner-operations"]) {
    assert.ok(scope.areas.includes(area), `missing pending-code area ${area}`);
  }
  for (const testPath of [
    "tests/deployment/publish-snapshot.test.cjs",
    "tests/lib/working-context-service.test.ts",
    "tests/storage/agent-working-context-isolation.test.ts",
    "tests/unit/finished-not-billed.test.ts",
    "tests/unit/chat-context-provenance.test.ts",
    "tests/memory/temporal-triple-store.test.ts",
    "tests/security/backup-confidentiality.test.ts",
    "tests/providers/gpt-6-2.test.ts",
    "tests/lib/mcp-api-keys.test.ts",
    "tests/lib/google-drive-permissions.test.ts",
    "tests/security/publish-preflight.test.ts",
    "tests/unit/subscription-jury-recovery.test.ts",
    "tests/minerva-s6-lifecycle-projection.test.ts",
    "tests/queue/spool.test.ts",
  ]) assert.ok(scope.tests.includes(testPath), `missing pending-code regression ${testPath}`);
  for (const testPath of [
    "tests/security/tenant-audit-blockers.test.ts",
    "tests/security/tenant-audit-blocker-batch.test.ts",
    "tests/security/residual-tenant-audit.test.ts",
  ]) assert.ok(scope.tests.includes(testPath), `missing combined known-risk boundary ${testPath}`);
  assert.deepEqual(classifyReleaseScope([
    ".agents/skills/post-edit-code-review/SKILL.md",
    ".agents/skills/post-edit-pipeline/SKILL.md",
    ".github/workflows/docs.yml",
  ]).areas, ["known-problems", "release-tooling"]);
  assert.ok(classifyReleaseScope([".dockerignore"]).areas.includes("packaging"));
});

test("application shared entrypoints select unions, while unknown future paths still fail closed", () => {
  for (const entrypoint of ["client/src/App.tsx", "server/index.ts", "server/routes.ts"]) {
    const scope = classifyReleaseScope([entrypoint]);
    assert.deepEqual(scope.unknown, [], entrypoint);
    for (const testPath of [
      "tests/unit/finished-not-billed.test.ts",
      "tests/lib/working-context-service.test.ts",
      "tests/unit/chat-context-provenance.test.ts",
      "tests/security/backup-confidentiality.test.ts",
      "tests/providers/gpt-6-2.test.ts",
      "tests/lib/mcp-api-keys.test.ts",
      "tests/lib/google-drive-permissions.test.ts",
      "tests/deployment/publish-snapshot.test.cjs",
      "tests/security/uploads-read-tenant-gate.test.ts",
    ]) assert.ok(scope.tests.includes(testPath), `${entrypoint}: missing union member ${testPath}`);
  }
  assert.deepEqual(classifyReleaseScope(["server/working-context/new-boundary.ts"]).unknown,
    ["server/working-context/new-boundary.ts"]);
  assert.deepEqual(classifyReleaseScope([".agents/skills/post-edit-future/SKILL.md"]).unknown,
    [".agents/skills/post-edit-future/SKILL.md"]);
});

test("Lenovo feature contracts select local inference checks without admitting unknown contracts", () => {
  const scope = classifyReleaseScope([
    "data/feature-contracts/legion-mellum-offload/plan.md",
    "data/feature-contracts/legion-mellum-offload/spec.md",
    "data/feature-contracts/unreviewed-feature/spec.md",
  ]);
  assert.deepEqual(scope.unknown, ["data/feature-contracts/unreviewed-feature/spec.md"]);
  assert.ok(scope.tests.includes("tests/providers/legion-mellum-policy.test.ts"));
});

test("benchmark and scheduled replay changes select their own regressions without relaxing unknown paths", () => {
  const scope = classifyReleaseScope([
    "scripts/harness-bench-report.ts", "server/lib/harness-bench-core.ts",
    "tests/lib/harness-bench-core.test.ts", "tests/unit/felix-outcome-loop-integration.test.ts",
    "scripts/golden-path-replay.ts", "scripts/lib/golden-path-replay-runtime.ts",
    "server/heartbeat.ts", "server/heartbeat-seed.ts", "scripts/unreviewed-replay.ts",
  ]);
  assert.deepEqual(scope.unknown, ["scripts/unreviewed-replay.ts"]);
  for (const path of [
    "tests/lib/harness-bench-core.test.ts", "tests/unit/felix-outcome-loop-integration.test.ts",
    "tests/unit/golden-path-replay-authority.test.ts", "tests/unit/golden-path-replay-evidence.test.ts",
    "tests/security/tool-authority-boundary.test.ts",
  ]) assert.ok(scope.tests.includes(path), path);
});

test("current sensitive changes select explicit boundaries and regressions", () => {
  const scope = classifyReleaseScope(["server/auth.ts", "server/tools/lib/safe-fetch.ts", "server/job-worker.ts"]);
  assert.deepEqual(scope.unknown, []);
  assert.ok(scope.areas.includes("auth"));
  assert.ok(scope.areas.includes("network"));
  assert.ok(scope.areas.includes("audit"));
  assert.ok(scope.tests.includes("tests/security/tenant-auth-revocation.test.ts"));
  assert.ok(scope.tests.includes("tests/security/tool-fetch-dns-pinning.test.ts"));
});

test("republish ownership sources always select the complete new boundary regression set", () => {
  for (const file of ["server/tools.ts", "server/lib/social-image-tool.ts",
    "server/lib/proposed-skill-tool.ts", "server/video-editor.ts", "server/crews-engine.ts",
    "server/agentic/self-heal.ts", "server/tools/domains/files/handlers.ts",
    "server/tools/domains/research-intel/handlers.ts"]) {
    const scope = classifyReleaseScope([file]);
    assert.deepEqual(scope.unknown, [], file);
    for (const regression of ["research-intel-tenant-authority", "proposed-skill-global-authority",
      "generated-social-image-ownership", "republish-orchestration-ownership",
      "republish-media-file-ownership", "media-verified-reference-staging",
      "delegation-gate-command-floor"]) {
      assert.ok(scope.tests.includes(`tests/security/${regression}.test.ts`), `${file}: ${regression}`);
    }
  }
});

test("PDF ownership changes select document boundary regressions", () => {
  const scope = classifyReleaseScope(["server/lib/pdf-input-ownership.ts", "server/pdf-create.ts", "server/tools/domains/documents/handlers.ts"]);
  assert.deepEqual(scope.unknown, []);
  assert.ok(scope.areas.includes("documents"));
  assert.ok(scope.tests.includes("tests/security/pdf-input-ownership.test.ts"));
});

test("memory ownership changes select the storage boundary regressions", () => {
  for (const file of ["server/routes/memory.ts", "server/storage.ts"]) {
    const scope = classifyReleaseScope([file]);
    assert.deepEqual(scope.unknown, []);
    assert.ok(scope.tests.includes("tests/security/storage-required-tenant-boundaries.test.ts"));
  }
});

test("payment and plan ownership changes select their actual boundary regressions", () => {
  const scope = classifyReleaseScope(["server/webhookHandlers.ts", "server/lib/mission-stripe-association.ts", "server/ceo-orchestrator.ts"]);
  assert.deepEqual(scope.unknown, []);
  assert.ok(scope.tests.includes("tests/security/mission-stripe-association.test.ts"));
  assert.ok(scope.tests.includes("tests/security/release-plan-access.test.ts"));
  const runner = readFileSync("scripts/targeted-release-check.ts", "utf8");
  assert.match(runner, /scope\.areas\.includes\("payments"\)/);
  assert.match(runner, /tests\/integration\/mission-golden-path\.test\.ts/);
});

test("unknown production and configuration changes never default to reviewed", () => {
  const scope = classifyReleaseScope(["server/routes/new-payment.ts", "data/new-runtime-flag.json", "scripts/unreviewed.ts", ".replit"]);
  assert.equal(scope.unknown.length, 4);
});

test("republish follow-through selects feature checks and combined entry-point boundaries", () => {
  const expected: Record<string, string[]> = {
    "server/daily-ai-insights/runner.ts": ["tests/daily-ai-insights.test.ts", "tests/deployment/daily-insights-capabilities.test.ts"],
    "server/providers.ts": ["tests/providers/cheaper-inference.test.ts", "tests/providers/cheaper-inference-automatic.test.ts"],
    "server/routes.ts": ["tests/security/uploads-read-tenant-gate.test.ts"],
    "server/routes/admin.ts": ["tests/daily-ai-insights.test.ts"],
    "server/index.ts": ["tests/unit/glm54-layout-review.test.ts"],
    "server/routes/audit.ts": ["tests/unit/glm54-layout-review.test.ts", "tests/lib/company-package-v3-api.test.ts"],
    "server/routes/watchlist.ts": ["tests/security/watchlist-route-authority.test.ts"],
    "client/src/components/company-report-package.tsx": ["tests/lib/company-package-cost-summary.test.ts"],
    "scripts/ideabrowser-weekly-scenario.ts": ["tests/lib/ideabrowser-scenario-decision.test.ts"],
    ".github/workflows/ci.yml": ["tests/unit/report-regression-guard.test.ts"],
    "scripts/evaluate-invoice-pilot.ts": ["tests/invoice-pilot-cli.test.ts"],
  };
  for (const [file, tests] of Object.entries(expected)) {
    const scope = classifyReleaseScope([file]);
    assert.deepEqual(scope.unknown, [], file);
    for (const target of tests) assert.ok(scope.tests.includes(target), `${file}: missing ${target}`);
  }
  for (const file of ["server/daily-ai-insights/unreviewed.ts", "server/routes/new-admin.ts",
    ".agents/skills/unreviewed/SKILL.md", ".env.production"]) {
    assert.deepEqual(classifyReleaseScope([file]).unknown, [file]);
  }
});

test("known problem regressions run even when only public copy changed", () => {
  const scope = classifyReleaseScope(["client/src/pages/landing.tsx"]);
  assert.ok(scope.tests.includes("tests/security/tenant-audit-blockers.test.ts"));
  assert.ok(scope.tests.includes("tests/security/republish-tenant-query-boundaries.test.ts"));
  assert.ok(scope.areas.includes("public-interface"));
});

test("progress reports and research are distinct from runtime changes", () => {
  const scope = classifyReleaseScope(["data/tenant-isolation-audit/checkpoint.json", ".agents/memory/akv-cache-engineering-verdict.md", "docs/targeted-release-checks.md"]);
  assert.equal(scope.informational.length, 3);
  assert.deepEqual(scope.unknown, []);
  assert.ok(scope.tests.length > 0);
  const referral = "project-assets/customer-revenue-launchpad/verified-referral-candidates-2026-11-26.md";
  assert.deepEqual(classifyReleaseScope([referral]).informational, [referral]);
  assert.deepEqual(classifyReleaseScope(["project-assets/customer-revenue-launchpad/unreviewed.ts"]).unknown,
    ["project-assets/customer-revenue-launchpad/unreviewed.ts"]);
});

test("path confusion, arbitrary tests and unrecognized executable surfaces block", () => {
  const scope = classifyReleaseScope(["../server/auth.ts", "/server/auth.ts", "server\\auth.ts", "tests/run-paid-job.test.ts", ".agents/skills/unreviewed/SKILL.md", "docs/run.sh", "server/auth.ts/extra"]);
  assert.equal(scope.unknown.length, 7);
});

test("selection is deduplicated and deterministic", () => {
  assert.deepEqual(classifyReleaseScope(["server/auth.ts", "server/auth.ts"]), classifyReleaseScope(["server/auth.ts"]));
});

test("weekly-video implementation changes select the full reviewed fixture coverage", () => {
  const scope = classifyReleaseScope(["scripts/build-bwb-weekly.ts", "scripts/bwb-render-github.ts"]);
  assert.deepEqual(scope.unknown, []);
  for (const file of [
    "tests/video/bwb-all-daily-clips.test.ts", "tests/video/bwb-weekly-coverage.test.ts",
    "tests/video/bwb-voice-lock.test.ts", "tests/unit/bwb-weekly-weight-guard.test.ts",
    "tests/video/bwb-delivery-verification-flow.test.ts", "tests/unit/media-output-verification.test.ts",
  ]) assert.ok(scope.tests.includes(file), file);
});

test("shared media changes select measured validation and delivery retry checks", () => {
  const scope = classifyReleaseScope(["server/lib/video-output-snapshot.ts", "server/video-job-runner.ts"]);
  assert.deepEqual(scope.unknown, []);
  for (const file of ["tests/unit/media-output-verification.test.ts",
    "tests/unit/video-finalize-gate.test.ts"]) assert.ok(scope.tests.includes(file), file);
  assert.ok(classifyReleaseScope(["scripts/lib/bwb-verification-profile.ts"]).areas.includes("bwb"));
  const runner = readFileSync("scripts/targeted-release-check.ts", "utf8");
  assert.match(runner, /name === "regressions"/);
  assert.match(runner, /buildOfflineVerificationEnv\(process\.env, home\)/);
});

test("source identity is ordered by path and binds exact bytes and deletions", () => {
  const a = [{ path: "server/a.ts", content: "a" }, { path: "server/b.ts", content: "b" }];
  assert.equal(digestReleaseInputs(a), digestReleaseInputs([...a].reverse()));
  assert.notEqual(digestReleaseInputs(a), digestReleaseInputs([{ path: "server/a.ts", content: "a " }, a[1]]));
  assert.notEqual(digestReleaseInputs(a), digestReleaseInputs([{ path: "server/a.ts", content: null }, a[1]]));
  assert.notEqual(digestReleaseInputs([{ path: "a", content: "bc" }]), digestReleaseInputs([{ path: "ab", content: "c" }]));
});

test("release metadata imported by the UI is hashed even when unchanged in the diff", () => {
  const paths = releaseInputPaths(["server/auth.ts", "docs/release-facts.json", "docs/release-facts-input.json", "data/tenant-isolation-audit/checkpoint.json"], []);
  assert.ok(paths.includes("docs/release-facts.json"));
  assert.ok(paths.includes("docs/release-facts-input.json"));
  assert.ok(!paths.includes("data/tenant-isolation-audit/checkpoint.json"));
  const before = paths.map(path => ({ path, content: path.includes("release-facts") ? "old" : "same" }));
  const after = before.map(item => item.path === "docs/release-facts.json" ? { ...item, content: "new" } : item);
  assert.notEqual(digestReleaseInputs(before), digestReleaseInputs(after));
  assert.ok(classifyReleaseScope(["docs/release-facts.json"]).areas.includes("public-interface"));
});

test("only generated weekly-video job outputs leave source identity; brand, fixtures and deployment inputs remain bound", () => {
  const outputs = [
    "data/youtube/scripts/weekly-2026-11-22-src-99ad7170051ff75a.json",
    "data/youtube/scripts/weekly-2026-11-22-src-99ad7170051ff75a.result.json",
    "data/youtube/weekly-2026-11-22-src-99ad7170051ff75a-thumbnail.png",
  ];
  assert.ok(outputs.every(isReleaseRuntimeArtifact));
  const bound = [
    "BRAND.md",
    "data/youtube/brand-style-guide.md",
    "data/youtube/scripts/video-01-origin-story.json",
    "data/youtube/scripts/weekly-2026-11-22.json",
    "data/youtube/video-01-origin-story-v2.mp4",
    "data/youtube/video-01-thumbnail.png",
    "Dockerfile",
    ".dockerignore",
    "migrations/0103_plans_publish_required_status.sql",
    "project-assets/brand.png",
    ".github/workflows/ci.yml",
  ];
  const inputs = releaseInputPaths([...outputs, ...bound], []);
  for (const output of outputs) assert.ok(!inputs.includes(output), `runtime output was hashed: ${output}`);
  for (const input of bound) assert.ok(inputs.includes(input), `source input was masked: ${input}`);

  const initial = [...outputs, ...bound].map(path => ({ path, content: `initial:${path}` }));
  const runtimeChanged = initial.map(item =>
    outputs.includes(item.path) ? { ...item, content: `rotated:${item.path}` } : item);
  assert.equal(
    digestReleaseInputs(releaseInputPaths(initial.map(item => item.path), []).map(path =>
      runtimeChanged.find(item => item.path === path)!)),
    digestReleaseInputs(releaseInputPaths(initial.map(item => item.path), []).map(path =>
      initial.find(item => item.path === path)!)),
    "generated runtime output changes must not invalidate the release source identity",
  );
  const brandChanged = initial.map(item =>
    item.path === "BRAND.md" ? { ...item, content: "reviewed brand policy change" } : item);
  const sourcePaths = releaseInputPaths(initial.map(item => item.path), []);
  assert.notEqual(
    digestReleaseInputs(sourcePaths.map(path => brandChanged.find(item => item.path === path)!)),
    digestReleaseInputs(sourcePaths.map(path => initial.find(item => item.path === path)!)),
    "brand policy changes remain source-bound",
  );
  assert.deepEqual(classifyReleaseScope([outputs[0]]).unknown, [outputs[0]],
    "unfiltered runtime-output paths must not become an implicit classifier allowlist");
});

test("reviewed release documents select surface tests and bind exact bytes, including new files", () => {
  const docs = ["README.md", "README.md", "ROADMAP.md", "replit.md",
    "docs/CURRENT_PLATFORM_TOTALS.md", "docs/platform-update-2026-11-04.md"];
  const paths = releaseInputPaths(docs.slice(0, -1), [docs.at(-1)!]);
  for (const path of docs) {
    assert.ok(paths.includes(path), `unbound document: ${path}`);
    const scope = classifyReleaseScope([path]);
    assert.ok(scope.areas.includes("public-interface"));
    assert.ok(scope.tests.includes("tests/release-source-surfaces.test.ts"));
    const before = paths.map(path => ({ path, content: "original" }));
    const after = before.map(item => item.path === path ? { ...item, content: "edited" } : item);
    assert.notEqual(digestReleaseInputs(before), digestReleaseInputs(after), path);
  }
});

test("mutable audit reports are not build inputs, but audit implementation remains bound", () => {
  const evidence = ["data/tenant-isolation-audit/degraded-latest.json",
    "docs/tenant-isolation-audit-report-degraded.md"];
  const source = ["scripts/verify-republish-readiness.ts", "server/lib/tenant-audit-job-state.ts"];
  const paths = releaseInputPaths([...evidence, ...source], evidence);
  for (const path of evidence) assert.ok(!paths.includes(path));
  for (const path of source) assert.ok(paths.includes(path));
});

test("release inputs always bind deployment, migrations, assets and CI, even without a changed list", () => {
  const paths = ["Dockerfile", ".dockerignore", ".npmrc", "drizzle.config.ts",
    "migrations/0001.sql", "public/widget.js", ".github/workflows/ci.yml",
    "services/example/start.sh", "project-assets/brand.png", ".agents/skills/example/SKILL.md",
    "data/tenant-isolation-audit/suppressions.json", "data/tenant-isolation-audit/deferrals.json"];
  assert.deepEqual(releaseInputPaths(paths, []), [...paths].sort());
});

test("changed membership catches new, removed and unclassified paths", () => {
  assert.equal(sameReleaseMembership(["server/auth.ts"], ["server/auth.ts", "new.config"]), false);
  assert.equal(sameReleaseMembership(["server/auth.ts", "new.config"], ["server/auth.ts"]), false);
  assert.equal(sameReleaseMembership(["b", "a"], ["a", "b"]), true);
});

test("noisy checks stop at the byte cap and cannot pass", async () => {
  const dir = mkdtempSync(join(tmpdir(), "release-log-limit-"));
  try {
    const logFile = join(dir, "noisy.log");
    const result = await runBoundedReleaseCommand(process.execPath, [
      "-e", "process.stdout.write('x'.repeat(100000));",
    ], { logFile, timeoutMs: 5000, maxLogBytes: 1024 });
    assert.equal(result.passed, false);
    assert.equal(result.outputLimitExceeded, true);
    assert.ok(readFileSync(logFile).length <= 1024);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("check builds neither export database records nor preserve old snapshots", () => {
  for (const skipSync of [false, true]) {
    assert.deepEqual(buildDataPolicy(true, skipSync), { syncDevData: false, preserveDevSnapshot: false });
  }
  assert.equal(buildDataPolicy(false, false).syncDevData, true);
  assert.deepEqual(buildDataPolicy(false, false, true), { syncDevData: false, preserveDevSnapshot: false });
  const build = readFileSync("scripts/build.ts", "utf8");
  const runner = readFileSync("scripts/targeted-release-check.ts", "utf8");
  assert.match(build, /process\.argv\.includes\("--release-check"\)/);
  assert.match(build, /if \(!dataPolicy\.syncDevData\)/);
  assert.match(build, /dataPolicy\.preserveDevSnapshot\s*\?\s*await readFile/);
  assert.match(runner, /\["run", "build", "--", "--release-check"\]/);
  assert.match(runner, /BLOCKED_SENSITIVE_BUILD_SNAPSHOT/);
});

test("bounded checks report actual exit codes, not process launch success", async () => {
  const dir = mkdtempSync(join(tmpdir(), "release-command-"));
  try {
    const good = await runBoundedReleaseCommand(process.execPath, ["-e", "process.exit(0)"], { logFile: join(dir, "ok.log"), timeoutMs: 2000 });
    const bad = await runBoundedReleaseCommand(process.execPath, ["-e", "process.exit(7)"], { logFile: join(dir, "bad.log"), timeoutMs: 2000 });
    assert.equal(good.passed, true);
    assert.equal(bad.passed, false);
    assert.equal(bad.code, 7);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("hung checks are killed at a wall-clock deadline and never pass", async () => {
  const dir = mkdtempSync(join(tmpdir(), "release-deadline-"));
  try {
    const result = await runBoundedReleaseCommand(process.execPath, ["-e", "setInterval(()=>{},1000)"], { logFile: join(dir, "hung.log"), timeoutMs: 200 });
    assert.equal(result.timedOut, true);
    assert.equal(result.passed, false);
    assert.ok(result.elapsedMs < 3000);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("missing executables fail without hanging or producing a pass", async () => {
  const dir = mkdtempSync(join(tmpdir(), "release-spawn-"));
  try {
    const result = await runBoundedReleaseCommand("/nonexistent/release-check-command", [], { logFile: join(dir, "missing.log"), timeoutMs: 1000 });
    assert.equal(result.passed, false);
    assert.equal(result.code, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
