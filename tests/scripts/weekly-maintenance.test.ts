import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { safeErrorDetail } from "../../scripts/lib/weekly-maintenance-scheduled";

const root = mkdtempSync(join(tmpdir(), "weekly-maintenance-test-"));
const script = resolve("scripts/weekly-maintenance.ts");
let runNumber = 0;

function runner(name: string, payload: unknown): string {
  const path = join(root, `${name}.cjs`);
  writeFileSync(path, `console.log(${JSON.stringify(JSON.stringify(payload))});\n`);
  return `${process.execPath} ${path}`;
}

function run(pass: number, env: Record<string, string> = {}) {
  const outputDir = join(root, `output-${++runNumber}`);
  const result = spawnSync(process.execPath, ["--import", "tsx", script, `--pass=${pass}`, "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      WEEKLY_MAINTENANCE_OUTPUT_DIR: outputDir,
      WEEKLY_SECURITY_SCAN_COMMAND: "",
      WEEKLY_SECURITY_SCAN_COMMAND_ENV_ALLOWLIST: "",
      WEEKLY_PRODUCTION_DATABASE_URL: "",
      WEEKLY_PRODUCTION_LOG_SCAN_COMMAND: "",
      WEEKLY_PRODUCTION_LOG_SCAN_COMMAND_ENV_ALLOWLIST: "",
      ...env,
    },
    timeout: 30_000,
  });
  assert.notEqual(result.status, null, result.stderr);
  const summary = JSON.parse(result.stdout);
  const durable = JSON.parse(readFileSync(join(outputDir, "weekly-maintenance-latest.json"), "utf8"));
  const markdown = readFileSync(join(outputDir, "weekly-maintenance-latest.md"), "utf8");
  assert.equal(durable.overallStatus, summary.overallStatus);
  return { status: result.status, summary, pass: summary.passes[0], markdown };
}

test("missing scheduled security capability is degraded, never green", () => {
  const result = run(3);
  assert.equal(result.status, 0);
  assert.equal(result.summary.overallStatus, "YELLOW");
  assert.equal(result.pass.coverage, "DEGRADED");
  assert.deepEqual(result.summary.coverage.unavailablePasses, [3]);
  assert.match(result.summary.ownerActionRequired.join("\n"), /restore scheduled coverage and rerun/);
  assert.match(result.markdown, /WEEKLY_SECURITY_SCAN_COMMAND is not configured/);
});

test("complete empty three-scanner result is green", () => {
  const command = runner("security-clean", {
    coverageComplete: true,
    sast: { status: "ok", results: [] },
    dependencyAudit: { status: "ok", vulnerabilities: [] },
    hounddog: { status: "ok", vulnerabilities: [] },
  });
  const result = run(3, { WEEKLY_SECURITY_SCAN_COMMAND: command });
  assert.equal(result.status, 0);
  assert.equal(result.summary.overallStatus, "GREEN");
  assert.equal(result.pass.coverage, "COMPLETE");
  assert.equal(result.summary.coverage.complete, true);
});

test("high security finding is red and credential-shaped evidence is redacted", () => {
  const command = runner("security-high", {
    coverageComplete: true,
    sast: {
      status: "ok",
      results: [{
        severity: "HIGH",
        checkId: "unsafe-test",
        message: "token=sk-fakefakefakefakefake",
        location: { file: "server/example.ts" },
      }],
    },
    dependencyAudit: { status: "ok", vulnerabilities: [] },
    hounddog: { status: "ok", vulnerabilities: [] },
  });
  const result = run(3, { WEEKLY_SECURITY_SCAN_COMMAND: command });
  assert.equal(result.status, 1);
  assert.equal(result.summary.overallStatus, "RED");
  assert.equal(result.pass.coverage, "COMPLETE");
  const serialized = JSON.stringify(result.summary);
  assert.match(serialized, /\[REDACTED\]/);
  assert.doesNotMatch(serialized, /sk-fake/);
  assert.match(result.markdown, /remediation evidence: token=\[REDACTED\]/);
});

test("partial, truncated, and malformed scanner results are degraded", () => {
  const invalidScanners = [
    { status: "partial", results: [] },
    { status: "ok", truncated: true, results: [] },
    { status: "ok", results: {} },
  ];
  for (const [index, invalid] of invalidScanners.entries()) {
    const command = runner(`security-invalid-${index}`, {
      coverageComplete: true,
      sast: invalid,
      dependencyAudit: { status: "ok", vulnerabilities: [] },
      hounddog: { status: "ok", vulnerabilities: [] },
    });
    const result = run(3, { WEEKLY_SECURITY_SCAN_COMMAND: command });
    assert.equal(result.summary.overallStatus, "YELLOW");
    assert.equal(result.pass.coverage, "DEGRADED");
  }
});

test("runner environment is explicit and allowed credential output is redacted", () => {
  const path = join(root, "security-env.cjs");
  writeFileSync(path, `
    const value = process.env.WEEKLY_TEST_SECRET || "not-inherited";
    console.log(JSON.stringify({
      coverageComplete: true,
      sast: { status: "ok", results: [{ severity: "HIGH", message: value }] },
      dependencyAudit: { status: "ok", vulnerabilities: [] },
      hounddog: { status: "ok", vulnerabilities: [] }
    }));
  `);
  const command = `${process.execPath} ${path}`;
  const secret = "weekly-test-secret-value-123456";

  const restricted = run(3, { WEEKLY_SECURITY_SCAN_COMMAND: command, WEEKLY_TEST_SECRET: secret });
  assert.doesNotMatch(JSON.stringify(restricted.summary), new RegExp(secret));
  assert.match(JSON.stringify(restricted.summary), /not-inherited/);

  const allowed = run(3, {
    WEEKLY_SECURITY_SCAN_COMMAND: command,
    WEEKLY_SECURITY_SCAN_COMMAND_ENV_ALLOWLIST: "WEEKLY_TEST_SECRET,NODE_OPTIONS",
    WEEKLY_TEST_SECRET: secret,
  });
  const serialized = JSON.stringify(allowed.summary);
  assert.doesNotMatch(serialized, new RegExp(secret));
  assert.match(serialized, /\[REDACTED\]/);
});

test("short PIN and blocked-event class values are redacted", () => {
  const commandPath = join(root, "logs-secret-class.cjs");
  writeFileSync(commandPath, `
    console.log(JSON.stringify({
      coverageComplete: true,
      truncated: false,
      events: [{ class: process.env.ADMIN_PIN, blocked: true }],
      anomalousSpikes: []
    }));
  `);
  const pin = "1234";
  const result = run(5, {
    WEEKLY_PRODUCTION_LOG_SCAN_COMMAND: `${process.execPath} ${commandPath}`,
    WEEKLY_PRODUCTION_LOG_SCAN_COMMAND_ENV_ALLOWLIST: "ADMIN_PIN",
    ADMIN_PIN: pin,
  });
  assert.doesNotMatch(JSON.stringify(result.summary), new RegExp(pin));
  assert.match(JSON.stringify(result.summary), /\[REDACTED\]/);
});

test("missing production schema connection is degraded", () => {
  const result = run(4);
  assert.equal(result.status, 0);
  assert.equal(result.summary.overallStatus, "YELLOW");
  assert.equal(result.pass.coverage, "DEGRADED");
  assert.deepEqual(result.summary.coverage.unavailablePasses, [4]);
});

test("database URLs and known secret values are removed from errors", () => {
  const key = "WEEKLY_TEST_DATABASE_URL";
  const value = "postgresql://weekly-user:weekly-password@db.example.test/visionclaw";
  const previous = process.env[key];
  process.env[key] = value;
  try {
    const redacted = safeErrorDetail(`connection failed for ${value}; password=weekly-password`);
    assert.doesNotMatch(redacted, /weekly-user|weekly-password/);
    assert.match(redacted, /\[REDACTED\]/);
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});

test("complete blocked production log result is green", () => {
  const command = runner("logs-clean", {
    coverageComplete: true,
    truncated: false,
    events: [{ class: "ssrf", blocked: true, evidence: "evt-1" }],
    anomalousSpikes: [],
  });
  const result = run(5, { WEEKLY_PRODUCTION_LOG_SCAN_COMMAND: command });
  assert.equal(result.status, 0);
  assert.equal(result.summary.overallStatus, "GREEN");
  assert.equal(result.pass.coverage, "COMPLETE");
});

test("unblocked production security event is red with bounded evidence", () => {
  const command = runner("logs-unblocked", {
    coverageComplete: true,
    truncated: false,
    events: [{ class: "jailbreak", blocked: false, evidence: "evt-unblocked" }],
    anomalousSpikes: [],
  });
  const result = run(5, { WEEKLY_PRODUCTION_LOG_SCAN_COMMAND: command });
  assert.equal(result.status, 1);
  assert.equal(result.summary.overallStatus, "RED");
  assert.equal(result.pass.coverage, "COMPLETE");
  assert.match(JSON.stringify(result.pass.findings), /evt-unblocked/);
  assert.match(result.markdown, /reported as NOT blocked/);
});

test("malformed production log envelopes and events are degraded", () => {
  const invalidPayloads = [
    { coverageComplete: true, truncated: false, events: {}, anomalousSpikes: [] },
    { coverageComplete: true, truncated: false, events: [], anomalousSpikes: {} },
    { coverageComplete: true, truncated: false, events: [{ blocked: true }], anomalousSpikes: [] },
  ];
  for (const [index, payload] of invalidPayloads.entries()) {
    const command = runner(`logs-invalid-${index}`, payload);
    const result = run(5, { WEEKLY_PRODUCTION_LOG_SCAN_COMMAND: command });
    assert.equal(result.summary.overallStatus, "YELLOW");
    assert.equal(result.pass.coverage, "DEGRADED");
  }
});

test("malformed informational currency payloads cannot be green", () => {
  const integrations = runner("integrations-invalid", { coverageComplete: true, integrations: {} });
  const integrationResult = run(2, { WEEKLY_INTEGRATIONS_CURRENCY_COMMAND: integrations });
  assert.equal(integrationResult.summary.overallStatus, "YELLOW");
  assert.match(JSON.stringify(integrationResult.pass.findings), /malformed integrations field/);

  const models = runner("models-invalid", { coverageComplete: true, issues: {} });
  const modelResult = run(7, { WEEKLY_MODEL_CURRENCY_COMMAND: models });
  assert.equal(modelResult.summary.overallStatus, "YELLOW");
  assert.match(JSON.stringify(modelResult.pass.findings), /malformed issues field/);

  const advisory = runner("integrations-advisory", {
    coverageComplete: true,
    integrations: [{ name: "google-drive", currentVersion: "1.0.0", availableVersion: "1.0.0", advisory: "critical CVE" }],
  });
  const advisoryResult = run(2, { WEEKLY_INTEGRATIONS_CURRENCY_COMMAND: advisory });
  assert.equal(advisoryResult.summary.overallStatus, "YELLOW");
  assert.match(JSON.stringify(advisoryResult.pass.findings), /security advisory/);

  const malformedRecord = runner("integrations-malformed-record", {
    coverageComplete: true,
    integrations: [{ advisory: "critical CVE" }],
  });
  const malformedResult = run(2, { WEEKLY_INTEGRATIONS_CURRENCY_COMMAND: malformedRecord });
  assert.equal(malformedResult.summary.overallStatus, "YELLOW");
  assert.match(JSON.stringify(malformedResult.pass.findings), /1 malformed/);
});