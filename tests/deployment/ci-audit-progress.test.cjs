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

test("default security triggers and normal jobs remain intact beside isolated remote modes", () => {
  const workflow = yaml.load(readFileSync(".github/workflows/security-checks.yml", "utf8"));
  assert.deepEqual(workflow.on.push.branches, ["main"]);
  for (const event of ["push", "pull_request"]) {
    const included = workflow.on[event].paths;
    for (const pattern of ["server/**", "scripts/lib/tenant-audit-*.ts",
      "scripts/run-tenant-isolation-audit-resumable.ts", "services/scrapling-worker/**"]) {
      assert.ok(included.includes(pattern), `${event} must retain ${pattern}`);
    }
  }

  for (const jobName of ["deterministic-security", "scraping-worker"]) {
    const condition = workflow.jobs[jobName].if;
    assert.match(condition, /github\.event_name != 'workflow_dispatch'/, `${jobName} retains push/PR behavior`);
    assert.match(condition, /inputs\.release_base == ''/, `${jobName} is excluded only for selected release mode`);
    assert.match(condition, /inputs\.release_source == ''/);
  }
  const remoteSetup = workflow.jobs["remote-setup"].if;
  assert.match(remoteSetup, /inputs\.release_setup == 'true'/);
  assert.match(remoteSetup, /inputs\.release_base == ''/);

  const plan = workflow.jobs["remote-release-plan"];
  const checks = workflow.jobs["remote-release-checks"];
  const aggregate = workflow.jobs["remote-release-aggregate"];
  assert.match(plan.if, /github\.event_name == 'workflow_dispatch'/);
  for (const input of ["release_base", "release_head", "release_source"])
    assert.ok(plan.if.includes(`inputs.${input} != ''`), `plan requires ${input}`);
  assert.equal(checks.needs, "remote-release-plan");
  assert.ok(Array.isArray(aggregate.needs));
  assert.ok(aggregate.needs.includes("remote-release-plan"));
  assert.ok(aggregate.needs.includes("remote-release-checks"));
  assert.match(aggregate.if, /always\(\)/);

  const aggregateDownloads = aggregate.steps.filter(step =>
    step.uses === "actions/download-artifact@v4");
  assert.equal(aggregateDownloads.length, 2);
  assert.ok(aggregateDownloads.every(step => step["continue-on-error"] === true),
    "missing artifacts must reach the verifier so it can fail with a precise error");
  const verifier = aggregate.steps.find(step => step.name === "Verify exact required receipts and source binding");
  assert.ok(verifier);
  assert.equal(verifier["continue-on-error"], undefined);
  assert.match(verifier.run, /assertExactRemoteReleasePlan/);
  assert.match(verifier.run, /MATRIX_RESULT/);
  const aggregateUpload = aggregate.steps.find(step => step.uses === "actions/upload-artifact@v4");
  assert.equal(aggregateUpload.if, "always()");
  assert.ok(workflow.jobs["invalid-release-mode"]);
});

test("only regression shards install Chromium and the isolated check receives the fixed browser path", () => {
  const workflow = yaml.load(readFileSync(".github/workflows/security-checks.yml", "utf8"));
  const steps = workflow.jobs["remote-release-checks"].steps;
  const install = steps.find(step => step.name === "Install Chromium for browser-based regression shards");
  assert.ok(install);
  assert.equal(install.if, "startsWith(matrix.checkId, 'regressions-')");
  assert.equal(install.env.PLAYWRIGHT_BROWSERS_PATH, "/tmp/visionclaw-release-browser-cache");
  assert.equal(install.run, "npx --no-install playwright install --with-deps chromium");
  const check = steps.find(step => step.name === "Run fixed source-bound check");
  assert.equal(check.env.PLAYWRIGHT_BROWSERS_PATH, "/tmp/visionclaw-release-browser-cache");
});

test("release jobs pin the browser-supported Ubuntu image rather than a moving latest alias", () => {
  const workflow = yaml.load(readFileSync(".github/workflows/security-checks.yml", "utf8"));
  for (const id of ["remote-setup", "remote-release-plan", "remote-release-checks", "remote-release-aggregate"]) {
    assert.equal(workflow.jobs[id]["runs-on"], "ubuntu-24.04", `${id} must retain Playwright-compatible Ubuntu`);
  }
  assert.equal(workflow.jobs["remote-release-checks"].strategy["max-parallel"], 12,
    "the existing twelve checks should not be unnecessarily queued in three waves");
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
