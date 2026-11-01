import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tenantAuditProviderOptions } from "../../scripts/lib/tenant-audit-provider-policy";

test("isolated flat-rate audit routes cannot acquire a metered fallback", () => {
  for (const lane of ["profundo", "openference"]) {
    for (const metered of [false, true]) {
      assert.deepEqual(tenantAuditProviderOptions(lane, metered), {
        providerLane: lane, forbidMeteredFallback: true,
      });
    }
  }
});

test("unknown and metered pins fail closed; global billing flags cannot enable direct recovery", () => {
  for (const invalid of ["", "profundoo", "openai-api", "anthropic-api", " profundo"]) {
    assert.throws(() => tenantAuditProviderOptions(invalid, false), /AUDIT_PROVIDER_LANE/);
  }
  assert.deepEqual(tenantAuditProviderOptions(undefined, false), { forbidMeteredFallback: true });
  assert.deepEqual(tenantAuditProviderOptions(undefined, true), { forbidMeteredFallback: true });
});

test("source and precision passes share an explicit fallback ladder and bind it to checkpoint identity", () => {
  const source = readFileSync("scripts/tenant-isolation-audit.ts", "utf8");
  const transport = readFileSync("scripts/lib/tenant-audit-completion.ts", "utf8");
  assert.match(transport, /resolve\(route\.model,\s*1,\s*options\)/);
  assert.match(source, /invokeAuditRoute\(route,\s*system,\s*user/);
  assert.match(source, /auditRoutes\(process\.env\.AUDIT_PROVIDER_LANE \|\| "profundo", TRIAGE_MODEL\)/);
  assert.match(source, /routes:\s*AUDIT_ROUTES/);
  assert.match(source, /unitChars:\s*AUDIT_UNIT_CHARS/);
  assert.match(source, /providerLane:\s*AUDIT_PROVIDER_OPTIONS\.providerLane/);
  assert.match(source.slice(source.indexOf("const reportJson =")), /providerLane:\s*AUDIT_PROVIDER_OPTIONS\.providerLane/);
  const hashSource = readFileSync("scripts/lib/tenant-audit-evidence-hash.ts", "utf8");
  assert.ok(hashSource.includes('"scripts/lib/tenant-audit-provider-policy.ts"'),
    "the provider contract must be part of the immutable evidence identity");
});
