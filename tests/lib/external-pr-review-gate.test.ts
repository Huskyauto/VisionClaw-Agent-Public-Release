import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const reviewWorkflow = readFileSync(
  ".github/workflows/external-pr-review-gate.yml",
  "utf8",
);
const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");
const docsWorkflow = readFileSync(".github/workflows/docs.yml", "utf8");
const codeowners = readFileSync(".github/CODEOWNERS", "utf8");

const highRiskPatternSource = reviewWorkflow.match(
  /const highRiskPatterns = \[([\s\S]*?)\n\s+\];/,
)?.[1];
assert.ok(highRiskPatternSource, "high-risk path policy must remain extractable");
const highRiskPatterns = Function(
  `"use strict"; return [${highRiskPatternSource}];`,
)() as RegExp[];
const isHighRiskPath = (filename: string) =>
  highRiskPatterns.some((pattern) => pattern.test(filename));

test("trusted PR review gate never executes contributor code or receives write authority", () => {
  assert.match(reviewWorkflow, /pull_request_target:/);
  assert.match(reviewWorkflow, /pull_request_review:/);
  assert.match(reviewWorkflow, /permissions:\s*\n\s+contents: read\s*\n\s+pull-requests: read/);
  assert.doesNotMatch(reviewWorkflow, /actions\/checkout/);
  assert.doesNotMatch(reviewWorkflow, /^\s*run:/m);
  assert.doesNotMatch(reviewWorkflow, /secrets\./);
  assert.doesNotMatch(reviewWorkflow, /\b(write|admin):\s*(?:true|write)\b/);
});

test("trusted PR review is bound to an approval on the exact current commit", () => {
  assert.match(reviewWorkflow, /trustedReview\?\.state === "APPROVED"/);
  assert.match(reviewWorkflow, /trustedReview\.commit_id === currentHead/);
  assert.match(reviewWorkflow, /core\.setFailed\(/);
  assert.match(codeowners, /^\* @Huskyauto$/m);
});

test("high-risk classifier covers every protected change category", () => {
  const highRiskExamples = [
    ".github/workflows/ci.yml",
    ".github/actions/setup/action.yml",
    ".github/CODEOWNERS",
    ".github/dependabot.yml",
    "package.json",
    "package-lock.json",
    "npm-shrinkwrap.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "apps/web/package.json",
    "Dockerfile",
    "containers/worker/Dockerfile.production",
    "docker-compose.prod.yml",
    "ops/compose.yaml",
    "deployment/railway/service.toml",
    "infra/terraform/main.tf",
    "k8s/api-deployment.yaml",
    ".replit",
    "replit.nix",
    "artifact.toml",
    "Procfile",
    "fly.toml",
    "railway.toml",
    "render.yaml",
    "vercel.json",
    "netlify.toml",
    "migrations/0001_init.sql",
    "db/migration/0002_auth.sql",
    "server/integrations/client.ts",
    "server/routes/public.ts",
    "shared/schema.ts",
    "shared/auth-contract.ts",
    "shared/security/types.ts",
    "client/src/auth/provider.tsx",
    "client/src/lib/oauth-client.ts",
    "client/src/session-store.ts",
    "scripts/release.ts",
    ".env.example",
    "config/.env.production",
    "SECURITY.md",
    "docs/CONTRIBUTING.md",
  ];

  for (const filename of highRiskExamples) {
    assert.equal(isHighRiskPath(filename), true, `${filename} must be high-risk`);
  }

  for (const filename of [
    "README.md",
    "docs/architecture.md",
    "client/src/components/Button.tsx",
    "public/logo.svg",
  ]) {
    assert.equal(
      isHighRiskPath(filename),
      false,
      `${filename} should remain an ordinary review path`,
    );
  }
});

test("PR CI checkouts do not persist GitHub credentials", () => {
  const assertEveryCheckoutIsHardened = (workflow: string, label: string) => {
    const checkoutCount = workflow.match(/actions\/checkout@v4/g)?.length ?? 0;
    const hardenedCount =
      workflow.match(/persist-credentials: false/g)?.length ?? 0;
    assert.ok(checkoutCount > 0, `${label} must contain at least one checkout`);
    assert.equal(
      hardenedCount,
      checkoutCount,
      `${label} must disable persisted credentials on every checkout`,
    );
  };

  assertEveryCheckoutIsHardened(ciWorkflow, "CI workflow");
  assertEveryCheckoutIsHardened(docsWorkflow, "docs workflow");
});