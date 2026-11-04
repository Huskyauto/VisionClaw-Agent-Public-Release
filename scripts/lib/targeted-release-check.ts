import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { closeSync, openSync, writeSync } from "node:fs";

const KNOWN_RISK_TESTS = [
  "tests/security/tenant-audit-blockers.test.ts",
  "tests/security/tenant-audit-blocker-batch.test.ts",
  "tests/security/residual-tenant-audit.test.ts",
  "tests/security/retained-tenant-audit-scope.test.ts",
  "tests/security/completed-tenant-audit-remediation.test.ts",
  "tests/security/republish-tenant-query-boundaries.test.ts",
];

const AREA_TESTS: Record<string, string[]> = {
  auth: ["tests/security/tenant-auth-revocation.test.ts"],
  network: ["tests/security/tool-fetch-dns-pinning.test.ts"],
  audit: [
    "tests/lib/tenant-audit-completion.test.ts",
    "tests/lib/tenant-audit-fallback.test.ts",
    "tests/lib/tenant-audit-job-state.test.ts",
    "tests/lib/tenant-audit-runner.test.ts",
    "tests/lib/tenant-audit-recovery-controller.test.ts",
    "tests/security/tenant-audit-provider-policy.test.ts",
    "tests/security/tenant-audit-call-timeout.test.ts",
    "tests/security/tenant-audit-checkpoint-jsonb.test.ts",
    "tests/security/tenant-audit-chunk-size.test.ts",
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
  "release-tooling": ["tests/lib/targeted-release-check.test.ts", "tests/lib/public-mirror-contract.test.ts"],
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
  ],
  "plan-ownership": ["tests/security/release-plan-access.test.ts"],
};

const PATH_AREAS: Record<string, string> = {
  "server/lib/structured-task-prompt.ts": "run-confirmation",
  "server/lib/run-confirmation.ts": "run-confirmation",
  "server/lib/plan-run-confirmation.ts": "run-confirmation",
  "server/lib/harness-ab-sample.ts": "run-confirmation",
  "server/lib/harness-ab-fixtures.ts": "run-confirmation",
  "server/lib/harness-ab-representative-fixtures.ts": "run-confirmation",
  "server/llm-task.ts": "run-confirmation",
  "server/plan-executor.ts": "run-confirmation",
  "server/routes/agent-insights.ts": "run-confirmation",
  "client/src/components/run-confirmation.tsx": "run-confirmation",
  "client/src/pages/workflow-replay.tsx": "run-confirmation",
  "scripts/project-confirmation.ts": "run-confirmation",
  "scripts/lib/project-confirmation.ts": "run-confirmation",
  "scripts/harness-ab-sample.ts": "run-confirmation",
  "server/auth.ts": "auth",
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
  "scripts/targeted-release-check.ts": "release-tooling",
  "scripts/lib/targeted-release-check.ts": "release-tooling",
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
  return /^data\/tenant-isolation-audit\/[^/]+\.(json|md)$/.test(file) ||
    /^docs\/tenant-isolation-audit-report(?:-[a-z0-9-]+)?\.md$/.test(file);
}

function informational(file: string): boolean {
  return (
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
  const info = new Set(classifyReleaseScope(changed).informational);
  const buildInput = (file: string) =>
    !mutableAuditEvidence(file) && (
      releaseDocument(file) ||
      /^(server|client|shared|scripts|tests|docs)\//.test(file) ||
      /^data\//.test(file) ||
      /^(package(?:-lock)?\.json|tsconfig[^/]*\.json|vite\.config\.[^/]+|\.replit|replit\.nix)$/.test(file)
    );
  return [...new Set([...tracked.filter(buildInput),
    ...changed.filter(file => !info.has(file) && !mutableAuditEvidence(file))])].sort();
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
      detached: true, stdio: ["ignore", "pipe", "pipe"], env: options.env ?? process.env,
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
