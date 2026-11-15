const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const yaml = require("js-yaml");

test("both CI triggers exclude generated audit progress without excluding audit code", () => {
  const workflow = yaml.load(readFileSync(".github/workflows/ci.yml", "utf8"));
  for (const event of ["push", "pull_request"]) {
    const ignored = workflow.on[event]["paths-ignore"];
    assert.ok(ignored.includes("data/tenant-isolation-audit/precision-progress.json"));
    assert.ok(!ignored.includes("data/tenant-isolation-audit/**"));
    assert.ok(!ignored.some((pattern) => pattern.startsWith("server/") || pattern.startsWith("scripts/")));
  }
});

test("bounded security checks still run on application, worker and audit-code changes", () => {
  const workflow = yaml.load(readFileSync(".github/workflows/security-checks.yml", "utf8"));
  for (const event of ["push", "pull_request"]) {
    const included = workflow.on[event].paths;
    for (const pattern of ["server/**", "scripts/lib/tenant-audit-*.ts",
      "scripts/run-tenant-isolation-audit-resumable.ts", "services/scrapling-worker/**"]) {
      assert.ok(included.includes(pattern), `${event} must retain ${pattern}`);
    }
  }
  const source = readFileSync(".github/workflows/security-checks.yml", "utf8");
  assert.ok(source.includes("tests/deployment/ci-audit-progress.test.cjs"));
  assert.ok(!source.includes("continue-on-error: true"));
});

test("workflow trigger regression runs only after npm dependencies are installed", () => {
  for (const file of ["ci.yml", "security-checks.yml"]) {
    const workflow = yaml.load(readFileSync(`.github/workflows/${file}`, "utf8"));
    const steps = workflow.jobs[file === "ci.yml" ? "build" : "deterministic-security"].steps;
    const install = steps.findIndex((step) => step.run?.startsWith("npm ci"));
    const regression = steps.findIndex((step) => step.run?.includes("tests/deployment/ci-audit-progress.test.cjs"));
    assert.ok(install >= 0 && regression > install, `${file} must install js-yaml before parsing workflows`);
  }
});
