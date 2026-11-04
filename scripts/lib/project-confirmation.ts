import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { confirmationDigest, createRunConfirmation, type CheckStatus } from "../../server/lib/run-confirmation";

const TESTS = [
  "tests/lib/structured-prompt-profile.test.ts",
  "tests/lib/harness-ab-sample.test.ts",
  "tests/lib/run-confirmation.test.ts",
  "tests/lib/plan-run-confirmation.test.ts",
  "tests/lib/project-confirmation.test.ts",
  "tests/lib/targeted-release-check.test.ts",
];
const SOURCES = [
  "server/lib/structured-task-prompt.ts", "server/lib/harness-ab-sample.ts",
  "server/lib/harness-ab-fixtures.ts", "server/lib/run-confirmation.ts",
  "server/lib/harness-ab-representative-fixtures.ts",
  "server/lib/plan-run-confirmation.ts", "server/llm-task.ts", "server/plan-executor.ts",
  "server/routes/agent-insights.ts", "client/src/pages/workflow-replay.tsx",
  "client/src/components/run-confirmation.tsx",
  "scripts/project-confirmation.ts", "scripts/lib/project-confirmation.ts",
  "scripts/lib/targeted-release-check.ts", "server/safety/spawn-env-guard.ts",
  "scripts/lib/build-data-policy.ts", "scripts/build.ts",
  "package.json", "package-lock.json", "tsconfig.json",
];

/** Closed, reviewed offline profiles, not caller-provided commands or paths. */
export function getConfirmationProfile(name: string) {
  if (name !== "harness-rollout") throw new Error("Unknown confirmation profile; available: harness-rollout");
  return {
    name, scope: "Offline harness-rollout regression checks only (no live model calls, UI browser checks or external outcomes).",
    tests: [...TESTS], sources: [...SOURCES, ...TESTS].sort(),
  };
}

export function snapshotConfirmationSources(files: string[]) {
  return files.map(file => {
    const absolute = resolve(file);
    const stat = lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(absolute) !== absolute || stat.size > 2 * 1024 * 1024)
      throw new Error("Unsafe or oversized confirmation source");
    return { file, sha256: confirmationDigest(readFileSync(absolute).toString("base64")) };
  });
}

export function assessTapCheck(log: string, processPassed: boolean): CheckStatus {
  if (!processPassed) return "failed";
  const count = (key: string) => {
    const matches = [...log.matchAll(new RegExp(`^# ${key} (\\d+)\\s*$`, "gm"))];
    return matches.length === 1 ? Number(matches[0][1]) : NaN;
  };
  if (count("fail") > 0) return "failed";
  return count("tests") > 0 && count("pass") === count("tests") &&
    ["fail", "cancelled", "skipped", "todo"].every(k => count(k) === 0) ? "passed" : "unverified";
}

export function assessReleaseConfirmation(input: {
  subjectDigest: string; sourceStable?: boolean; status: string;
  requirements: { id: string; label: string }[];
  checks: { name: string; passed: boolean; code: number | null; timedOut: boolean; elapsedMs: number; log: string }[];
}) {
  return createRunConfirmation({
    scope: "Targeted release command checks only. Independent review, full audit and live deployment remain separate.",
    subjectDigest: input.subjectDigest,
    currentDigest: input.sourceStable === true ? input.subjectDigest : undefined,
    requirements: [...input.requirements, { id: "admission", label: "Release scope admitted and no sensitive build snapshot remains" }],
    observations: [
      ...input.checks.map(c => ({
        id: c.name, status: c.passed ? "passed" as const : "failed" as const,
        evidence: `exit=${c.code}; timedOut=${c.timedOut}; elapsed=${c.elapsedMs}ms; retained log=${c.log}`,
      })),
      { id: "admission", status: input.status === "AUTOMATED_CHECKS_PASSED_REVIEW_REQUIRED" ? "passed" : "unverified",
        evidence: input.status === "AUTOMATED_CHECKS_PASSED_REVIEW_REQUIRED"
          ? "Declared automated admission checks completed; independent review still required."
          : "Run remains blocked, incomplete or has disallowed build output." },
    ],
  });
}
