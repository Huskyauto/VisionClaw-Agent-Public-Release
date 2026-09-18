import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildCeoExecutionAttemptId,
  evaluateDelegationReportOnly,
  parseDelegationSupervisorPolicy,
  reportDelegationAttempt,
} from "../../server/delegation-supervisor";

test("malformed or unsupported policy cannot enable delegation enforcement", () => {
  assert.throws(
    () => parseDelegationSupervisorPolicy({
      schemaVersion: "delegation-supervisor-policy/v999",
      policyVersion: "owner-draft",
      mode: "enforce",
    }),
    /invalid delegation supervisor policy/i,
  );
});

test("unresolved owner policy reports without assigning or enforcing a tier", () => {
  const policy = parseDelegationSupervisorPolicy({
    schemaVersion: "delegation-supervisor-policy/v1",
    policyVersion: "owner-draft-1",
    mode: "report_only",
    ownerDecisionStatus: "unresolved",
    killSwitch: false,
    tierFloors: {},
  });

  const decision = evaluateDelegationReportOnly({
    policy,
    trustedContext: {
      tenantId: 7,
      requesterIdentity: "persona:12",
      isPlatformOwner: false,
    },
    request: {
      delegationId: "delegation-1",
      attemptId: "attempt-1",
      targetAgent: "Atlas",
      taskClass: "architecture_change",
      supervisionMode: "tiered",
    },
  });

  assert.equal(decision.enforcementEnabled, false);
  assert.equal(decision.finalTier, null);
  assert.equal(decision.status, "unresolved_policy");
});

test("owner-direct mode cannot be activated by an untrusted requester claim", () => {
  const policy = parseDelegationSupervisorPolicy({
    schemaVersion: "delegation-supervisor-policy/v1",
    policyVersion: "owner-approved-1",
    mode: "report_only",
    ownerDecisionStatus: "approved",
    killSwitch: false,
    tierFloors: { bounded_read: "tier_0" },
  });

  const decision = evaluateDelegationReportOnly({
    policy,
    trustedContext: {
      tenantId: 7,
      requesterIdentity: "tenant-admin:44",
      isPlatformOwner: false,
    },
    request: {
      delegationId: "delegation-2",
      attemptId: "attempt-1",
      targetAgent: "Atlas",
      taskClass: "bounded_read",
      supervisionMode: "owner_direct",
    },
  });

  assert.equal(decision.status, "invalid_owner_direct");
  assert.equal(decision.structurallyValid, false);
  assert.equal(decision.enforcementEnabled, false);
  assert.equal(decision.requiresSparkReview, false);
});

test("owner-direct bypasses Spark but retains independent Tier 3 review", () => {
  const policy = parseDelegationSupervisorPolicy({
    schemaVersion: "delegation-supervisor-policy/v1",
    policyVersion: "owner-approved-2",
    mode: "report_only",
    ownerDecisionStatus: "approved",
    killSwitch: false,
    tierFloors: { protected_change: "tier_3" },
  });

  const decision = evaluateDelegationReportOnly({
    policy,
    trustedContext: {
      tenantId: 1,
      requesterIdentity: "platform-owner-session",
      isPlatformOwner: true,
    },
    request: {
      delegationId: "delegation-3",
      attemptId: "attempt-1",
      targetAgent: "Forge",
      taskClass: "protected_change",
      supervisionMode: "owner_direct",
    },
  });

  assert.equal(decision.structurallyValid, true);
  assert.equal(decision.finalTier, "tier_3");
  assert.equal(decision.requiresSparkReview, false);
  assert.equal(decision.requiresIndependentReview, true);
  assert.equal(decision.enforcementEnabled, false);
});

test("reporting persists one bounded receipt with stable attempt identity", async () => {
  const receipts: Array<{ status: string; delegationId: string; attemptId: string }> = [];
  const decision = await reportDelegationAttempt({
    tenantId: 9,
    requesterIdentity: "persona:20",
    targetAgent: "Atlas",
    source: "internal",
    delegationId: "ceo:44:step-2",
    attemptId: "initial",
    policy: parseDelegationSupervisorPolicy({
      schemaVersion: "delegation-supervisor-policy/v1",
      policyVersion: "owner-draft-3",
      mode: "report_only",
      ownerDecisionStatus: "unresolved",
      killSwitch: false,
      tierFloors: {},
    }),
    receiptWriter: async (receipt) => {
      receipts.push({
        status: receipt.status,
        delegationId: receipt.delegationId,
        attemptId: receipt.attemptId,
      });
    },
    eventWriter: async () => {},
  });

  assert.equal(decision.enforcementEnabled, false);
  assert.deepEqual(receipts, [{
    status: "unresolved_policy",
    delegationId: "ceo:44:step-2",
    attemptId: "initial",
  }]);
  assert.equal(decision.receiptPersisted, true);
});

test("receipt writer receives canonical bounded identities, not caller labels", async () => {
  let persistedRequester = "";
  await reportDelegationAttempt({
    tenantId: 9,
    requesterIdentity: "secret-like free form label that must never persist raw",
    targetAgent: "Atlas",
    source: "internal",
    policy: parseDelegationSupervisorPolicy({
      schemaVersion: "delegation-supervisor-policy/v1",
      policyVersion: "owner-draft-identity",
      mode: "report_only",
      ownerDecisionStatus: "unresolved",
      killSwitch: false,
      tierFloors: {},
    }),
    receiptWriter: async (_decision, context) => {
      persistedRequester = context.requesterIdentity;
    },
    eventWriter: async () => {},
  });

  assert.match(persistedRequester, /^principal:[0-9a-f]{24}$/);
  assert.doesNotMatch(persistedRequester, /secret-like/i);
});

test("CEO recursive and backup executions receive distinct bounded attempt identities", () => {
  const ids = [
    buildCeoExecutionAttemptId("initial"),
    buildCeoExecutionAttemptId("self-correction", 1),
    buildCeoExecutionAttemptId("backup", 1, "VisionClaw"),
  ];
  assert.equal(new Set(ids).size, 3);
  assert.deepEqual(ids, ["initial", "self-correction:1", "backup:visionclaw:1"]);
  for (const id of ids) assert.match(id, /^[A-Za-z0-9:_-]{1,160}$/);
  assert.throws(() => buildCeoExecutionAttemptId("self-correction", 0), /positive integer/);
});

test("receipt and event failures are explicit but do not change report-only execution", async () => {
  const decision = await reportDelegationAttempt({
    tenantId: 9,
    requesterIdentity: "persona:20",
    targetAgent: "Atlas",
    source: "internal",
    policy: parseDelegationSupervisorPolicy({
      schemaVersion: "delegation-supervisor-policy/v1",
      policyVersion: "owner-draft-4",
      mode: "report_only",
      ownerDecisionStatus: "unresolved",
      killSwitch: false,
      tierFloors: {},
    }),
    receiptWriter: async () => { throw new Error("receipt unavailable"); },
    eventWriter: async () => { throw new Error("event unavailable"); },
  });

  assert.equal(decision.status, "unresolved_policy");
  assert.equal(decision.enforcementEnabled, false);
  assert.equal(decision.receiptPersisted, false);
  assert.equal(decision.receiptError, "persistence_failed");
});

test("reporting revalidates injected policy objects at runtime", async () => {
  const decision = await reportDelegationAttempt({
    tenantId: 9,
    requesterIdentity: "persona:20",
    targetAgent: "Atlas",
    source: "internal",
    policy: {
      schemaVersion: "delegation-supervisor-policy/v1",
      policyVersion: "forged",
      mode: "enforce",
      ownerDecisionStatus: "approved",
      killSwitch: false,
      tierFloors: { any: "tier_0" },
    } as never,
    receiptWriter: async () => {},
    eventWriter: async () => {},
  });

  assert.equal(decision.status, "invalid_policy");
  assert.equal(decision.enforcementEnabled, false);
  assert.equal(decision.structurallyValid, false);
});

test("kill switch is always non-enforcing and visible in the report", () => {
  const policy = parseDelegationSupervisorPolicy({
    schemaVersion: "delegation-supervisor-policy/v1",
    policyVersion: "owner-approved-3",
    mode: "report_only",
    ownerDecisionStatus: "approved",
    killSwitch: true,
    tierFloors: { bounded_read: "tier_0" },
  });
  const decision = evaluateDelegationReportOnly({
    policy,
    trustedContext: {
      tenantId: 1,
      requesterIdentity: "persona:1",
      isPlatformOwner: false,
    },
    request: {
      delegationId: "delegation-4",
      attemptId: "attempt-1",
      targetAgent: "Atlas",
      taskClass: "bounded_read",
      supervisionMode: "tiered",
    },
  });
  assert.equal(decision.status, "kill_switch_active");
  assert.equal(decision.enforcementEnabled, false);
});

test("all known child-agent execution families cross the shared report boundary", () => {
  const heartbeat = readFileSync("server/heartbeat.ts", "utf8");
  const subagents = readFileSync("server/subagents.ts", "utf8");
  const manager = readFileSync("server/agent-manager.ts", "utf8");
  const sessions = readFileSync("server/sessions.ts", "utf8");
  const ceo = readFileSync("server/ceo-orchestrator.ts", "utf8");

  assert.ok((heartbeat.match(/reportDelegationAttempt\(/g) || []).length >= 2);
  assert.ok(subagents.indexOf("reportDelegationAttempt({") < subagents.indexOf("storage.createConversation({"));
  assert.ok(manager.indexOf("reportDelegationAttempt({") < manager.indexOf("storage.createConversation({"));
  assert.ok(sessions.indexOf("reportDelegationAttempt({") < sessions.indexOf("processMessage(convId"));
  assert.match(sessions, /const delegationId = `intersession:\$\{convId\}:\$\{randomUUID\(\)\}`/);
  assert.match(subagents, /attemptId: `coached-retry:\$\{retryOrdinal\}`/);
  assert.ok((ceo.match(/reportDelegationAttempt\(/g) || []).length >= 3);
});