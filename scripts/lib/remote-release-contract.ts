export const REMOTE_RELEASE_REPO = "Huskyauto/VisionClaw-Agent";
export const REMOTE_RELEASE_WORKFLOW = ".github/workflows/security-checks.yml";
export const REMOTE_RELEASE_BRANCH = /^release-checks\/[a-f0-9]{12,64}$/;
export const REMOTE_RELEASE_SHARDS = 3;
export const DATABASE_REGRESSION_TESTS = [
  "tests/providers/spark-relay-store.test.ts",
  "tests/storage/agent-working-context-isolation.test.ts",
  "tests/minerva-operational-plan-contract.test.ts",
  "tests/queue/spool.test.ts",
  "tests/agentic/rejected-plan-dedup.test.ts",
] as const;

export interface RemoteCheck {
  id: string;
  kind: "regressions" | "database-regressions" | "typecheck" | "surface-preflight" | "domain-preflight" | "build" |
    "portable-install" | "publish-typecheck" | "muse-s2-integration" | "mission-lifecycle";
  tests: string[];
  database: boolean;
}
export interface RemoteReleasePlan {
  version: 1;
  repository: string;
  base: string;
  head: string;
  sourceDigest: string;
  changed: string[];
  checks: RemoteCheck[];
}
export interface RemoteCheckReceipt {
  version: 1;
  checkId: string;
  head: string;
  sourceDigest: string;
  runId: number;
  runAttempt: number;
  tests: string[];
  passed: boolean;
  code: number | null;
  timedOut: boolean;
  outputLimitExceeded: boolean;
  elapsedMs: number;
  logSha256: string;
}
export interface TrustedRemoteRun {
  repository: string;
  repositoryId: number;
  workflowId: number;
  workflowPath: string;
  head: string;
  branch: string;
  runId: number;
  runAttempt: number;
  event: string;
  status: string;
  conclusion: string | null;
  jobs: { name: string; status: string; conclusion: string | null }[];
  artifact: { id: number; name: string; runId: number; expired: boolean };
}
export interface ExpectedRemoteRun {
  repositoryId: number;
  workflowId: number;
  branch: string;
  runId: number;
  runAttempt: number;
}
