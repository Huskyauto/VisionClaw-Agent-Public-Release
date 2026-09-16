import { describe, it, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHumanAiSynergyPostHandler, type HumanAiSynergyStore } from "../../server/routes/human-ai-synergy";

const arms = [
  { condition: "human_alone", measurements: { outcomeQuality: 70, timeEfficiency: 60, errorDetection: 65, adaptation: 60 } },
  { condition: "ai_alone", measurements: { outcomeQuality: 65, timeEfficiency: 80, errorDetection: 55, adaptation: 60 } },
  { condition: "human_ai", measurements: { outcomeQuality: 90, timeEfficiency: 85, errorDetection: 88, adaptation: 86 } },
];
const body = { trialName: "Pilot", taskLabel: "Task", participantAlias: "A", idempotencyKey: "pilot-1", securityPass: true, arms };
function response() {
  return { statusCode: 200, body: undefined as any, status(code: number) { this.statusCode = code; return this; }, json(value: any) { this.body = value; return this; } };
}
function row(values: any = {}) {
  return { id: 9, tenantId: 7, idempotencyKey: "pilot-1", trialName: "Pilot", taskLabel: "Task", participantAlias: "A", notes: null, rubricVersion: "human-ai-synergy-v1", measurements: { securityPass: true, arms }, result: { valid: true, verdict: "positive_synergy" }, createdAt: new Date(), ...values } as any;
}
function handler(store: HumanAiSynergyStore, owner = true) {
  return createHumanAiSynergyPostHandler({
    store,
    requireOwnerAdmin: (_req, res) => { if (!owner) res.status(403).json({ error: "owner required" }); return owner; },
    getTenant: () => 7,
  });
}
afterEach(() => { delete process.env.HUMAN_AI_SYNERGY_TRIAL_ENABLED; });
beforeEach(() => { process.env.HUMAN_AI_SYNERGY_TRIAL_ENABLED = "1"; });

describe("human-ai synergy POST route", () => {
  it("fails closed when disabled and rejects non-owner", async () => {
    process.env.HUMAN_AI_SYNERGY_TRIAL_ENABLED = "0";
    let res = response(); await handler({} as any)( { body } as any, res as any);
    assert.equal(res.statusCode, 404);
    process.env.HUMAN_AI_SYNERGY_TRIAL_ENABLED = "1";
    res = response(); await handler({} as any, false)({ body } as any, res as any);
    assert.equal(res.statusCode, 403);
  });
  it("creates once, replays identical content, and conflicts on changed payload", async () => {
    let existing: any;
    const store: HumanAiSynergyStore = {
      findByKey: async () => existing,
      createWithAudit: async (insert, audit) => {
        assert.equal(insert.tenantId, 7);
        assert.equal((insert.measurements as any).securityPass, true);
        assert.deepEqual(Object.keys(audit).sort(), ["idempotencyKey", "trialId", "verdict"]);
        existing = row(insert); return existing;
      },
    };
    let res = response(); await handler(store)({ body }, res as any);
    assert.equal(res.statusCode, 201);
    res = response(); await handler(store)({ body }, res as any);
    assert.equal(res.statusCode, 200);
    res = response(); await handler(store)({ body: { ...body, taskLabel: "Changed" } }, res as any);
    assert.equal(res.statusCode, 409);
  });
  it("returns controlled 500 on database failure and recovers concurrent duplicate", async () => {
    const failing: HumanAiSynergyStore = { findByKey: async () => { throw new Error("db down"); }, createWithAudit: async () => { throw new Error("db down"); } };
    let res = response(); await handler(failing)({ body }, res as any);
    assert.equal(res.statusCode, 500);
    let reads = 0;
    const race: HumanAiSynergyStore = {
      findByKey: async () => ++reads === 1 ? undefined : row(),
      createWithAudit: async () => { throw new Error("unique"); },
    };
    res = response(); await handler(race)({ body }, res as any);
    assert.equal(res.statusCode, 200);
  });
  it("does not accept a body tenant and rejects whitespace metadata", async () => {
    let seenTenant = 0;
    const store: HumanAiSynergyStore = { findByKey: async (tenant) => { seenTenant = tenant; return undefined; }, createWithAudit: async (insert) => row(insert) };
    let res = response(); await handler(store)({ body: { ...body, tenantId: 999, notes: "   " } }, res as any);
    assert.equal(res.statusCode, 400);
    res = response(); await handler(store)({ body: { ...body, tenantId: 999 } }, res as any);
    assert.equal(res.statusCode, 201); assert.equal(seenTenant, 7);
  });
});