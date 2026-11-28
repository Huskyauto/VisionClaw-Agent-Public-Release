import { isDeepStrictEqual } from "node:util";
import {
  DATABASE_REGRESSION_TESTS, REMOTE_RELEASE_REPO, REMOTE_RELEASE_SHARDS,
  type RemoteCheck, type RemoteReleasePlan,
} from "./remote-release-contract";
import { classifyReleaseScope } from "./targeted-release-check";

const COMMIT_SHA = /^[a-f0-9]{40}$/;
const SOURCE_DIGEST = /^[a-f0-9]{64}$/;

export function createRemoteReleasePlan(input: {
  base: string;
  head: string;
  sourceDigest: string;
  changed: string[];
}): RemoteReleasePlan {
  if (!COMMIT_SHA.test(input.base)) throw new Error("Remote release base must be a full 40-character commit SHA");
  if (!COMMIT_SHA.test(input.head)) throw new Error("Remote release head must be a full 40-character commit SHA");
  if (!SOURCE_DIGEST.test(input.sourceDigest)) throw new Error("Remote release source digest must be a 64-character SHA-256");
  if (!Array.isArray(input.changed) || input.changed.some(path => typeof path !== "string"))
    throw new Error("Remote release changed paths must be strings");

  const changed = [...new Set(input.changed)].sort();
  const scope = classifyReleaseScope(changed);
  if (scope.unknown.length) throw new Error(`Unclassified release paths: ${scope.unknown.join(", ")}`);

  const databaseTests = scope.tests.filter(test => (DATABASE_REGRESSION_TESTS as readonly string[]).includes(test));
  const regressionTests = scope.tests.filter(test => !(DATABASE_REGRESSION_TESTS as readonly string[]).includes(test));
  const shards: string[][] = Array.from({ length: REMOTE_RELEASE_SHARDS }, () => []);
  for (const [index, test] of [...regressionTests].sort().entries())
    shards[index % REMOTE_RELEASE_SHARDS].push(test);

  const checks: RemoteCheck[] = shards.map((tests, index) => ({
    id: `regressions-${index + 1}`,
    kind: "regressions",
    tests,
    database: false,
  }));
  if (databaseTests.length) {
    checks.push({
      id: "database-regressions",
      kind: "database-regressions",
      tests: databaseTests.sort(),
      database: true,
    });
  }
  checks.push(
    { id: "typecheck", kind: "typecheck", tests: [], database: false },
    { id: "surface-preflight", kind: "surface-preflight", tests: [], database: false },
    { id: "domain-preflight", kind: "domain-preflight", tests: [], database: false },
    { id: "build", kind: "build", tests: [], database: false },
    { id: "portable-install", kind: "portable-install", tests: [], database: false },
    { id: "publish-typecheck", kind: "publish-typecheck", tests: [], database: false },
  );
  if (scope.areas.includes("muse-s2-integration")) {
    checks.push({
      id: "muse-s2-integration", kind: "muse-s2-integration",
      tests: ["tests/integration/muse-s2-adapter.test.ts"], database: true,
    });
  }
  if (scope.areas.includes("payments")) {
    checks.push({
      id: "mission-lifecycle", kind: "mission-lifecycle",
      tests: ["tests/integration/mission-golden-path.test.ts"], database: true,
    });
  }

  return {
    version: 1,
    repository: REMOTE_RELEASE_REPO,
    base: input.base,
    head: input.head,
    sourceDigest: input.sourceDigest,
    changed,
    checks,
  };
}

export function assertExactRemoteReleasePlan(
  actual: unknown,
  input: { base: string; head: string; sourceDigest: string; changed: string[] },
): asserts actual is RemoteReleasePlan {
  const expected = createRemoteReleasePlan(input);
  if (!isDeepStrictEqual(actual, expected))
    throw new Error("Remote release plan does not match the exact checkout source, diff and required lanes");
}
