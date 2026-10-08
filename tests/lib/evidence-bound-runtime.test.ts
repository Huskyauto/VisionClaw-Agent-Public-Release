import test from "node:test";
import assert from "node:assert/strict";
import { observeFinalOutput, suppliedEvidenceSources, observationAuditDetail } from "../../server/lib/evidence-bound-runtime";

process.env.NODE_ENV = "test";
const input = { tenantId: 42, output: "Profit was $120.", subject: "ensemble_answer" as const };
const sources = [{ id: "ledger", title: "Example records", text: "The business earned $120.", tenantId: 42, provenance: "supplied_context" as const }];

test("missing sources skips semantic calls but produces an auditable unresolved receipt", async () => {
  let calls = 0, writes = 0;
  const r = await observeFinalOutput(input, {
    review: async () => { calls++; return []; },
    persist: async () => { writes++; return 123; },
  });
  assert.equal(calls, 0);
  assert.equal(writes, 1);
  assert.equal(r.status, "no_sources");
  assert.equal(r.audit.persisted, true);
  assert.equal(r.audit.activityId, 123);
});

test("review failure and audit failure cannot produce successful verification", async () => {
  const r = await observeFinalOutput({ ...input, sources }, {
    review: async () => { throw new Error("provider unavailable"); },
    persist: async () => { throw new Error("DB unavailable"); },
  });
  assert.equal(r.verified, false);
  assert.equal(r.semanticReview, "unavailable");
  assert.equal(r.audit.persisted, false);
  assert.equal(r.units[0].status, "unresolved");
});

test("bounded semantic call consumes source snapshots, not generated drafts", async () => {
  let calls = 0;
  const r = await observeFinalOutput({ ...input, sources }, {
    review: async ({ units, sources: snapshots }) => {
      calls++;
      assert.equal(units[0].text, input.output);
      assert.equal(snapshots[0].text, sources[0].text);
      return [{ unitId: "u1", verdict: "supported", evidence: [{ sourceId: "ledger", quote: sources[0].text }] }];
    },
    persist: async () => 5,
  });
  assert.equal(calls, 1);
  assert.equal(r.units[0].status, "provisional_support");
  assert.equal(r.verified, false);
});

test("kill switch and unknown mode do not run review or claim a passed check", async () => {
  for (const mode of ["off", "enforce"]) {
    process.env.EVIDENCE_BOUND_MODE = mode;
    try {
      const r = await observeFinalOutput({ ...input, sources }, {
        review: async () => { throw new Error("must not run"); },
        persist: async () => { throw new Error("must not write"); },
      });
      assert.equal(r.status, mode === "off" ? "disabled" : "unavailable");
      assert.equal(r.verified, false);
    } finally { delete process.env.EVIDENCE_BOUND_MODE; }
  }
});

test("sensitive source payloads never reach even an injected semantic reviewer", async () => {
  let calls = 0;
  const r = await observeFinalOutput({ ...input, sources: [{
    ...sources[0], text: "Authorization: Bearer " + "sk-" + "x".repeat(48),
  }] }, {
    review: async () => { calls++; return []; },
    persist: async () => 9,
  });
  assert.equal(calls, 0);
  assert.equal(r.semanticReview, "unavailable");
});

test("public source admission stamps tenant and cannot admit oversized snapshots", () => {
  const admitted = suppliedEvidenceSources(42, [{ id: "manual", title: "Manual", text: "A source sentence.", tenantId: 1, provenance: "model_draft" }]);
  assert.equal(admitted[0].tenantId, 42);
  assert.equal(admitted[0].provenance, "supplied_context");
  assert.throws(() => suppliedEvidenceSources(42, [{ id: "bad", title: "Source", text: "x".repeat(24001) }]));
  assert.throws(() => suppliedEvidenceSources(42, {}));
  assert.throws(() => suppliedEvidenceSources(42, [{ id: "bad", title: "Source" }]));
});

test("empty persistence acknowledgment is not recorded as successful audit", async () => {
  const r = await observeFinalOutput(input, { persist: async () => 0 });
  assert.equal(r.audit.persisted, false);
  assert.equal(r.audit.state, "unconfirmed");
});

test("unexpected source collector errors do not prevent the answer from returning", async () => {
  const bad = { ...sources[0], get id(): string { throw new Error("collector unavailable"); } };
  const r = await observeFinalOutput({ ...input, sources: [bad] });
  assert.equal(r.status, "unavailable");
  assert.equal(r.reason, "observer_unavailable");
  assert.equal(r.verified, false);
});

test("hung advisory reviewer is cut off and cannot claim completed verification", async () => {
  const start = performance.now();
  const r = await observeFinalOutput({ ...input, sources }, {
    review: async () => new Promise(() => {}),
    persist: async () => 123,
  });
  assert.ok(performance.now() - start < 7500);
  assert.equal(r.semanticReview, "unavailable");
  assert.equal(r.verified, false);
  assert.equal(r.audit.persisted, true);
});

test("redact-class sensitive findings skip egress and retain hashes only", async () => {
  const sensitiveInput = {
    ...input, output: "Recorded identifier is 123-45-6789.",
    sources: [{ ...sources[0], text: "The recorded identifier was 123-45-6789." }],
  };
  let calls = 0;
  const r = await observeFinalOutput(sensitiveInput, {
    review: async () => { calls++; return []; },
    persist: async () => 123,
  });
  assert.equal(calls, 0);
  assert.equal(r.semanticReview, "unavailable");
  const projected = observationAuditDetail(r);
  assert.equal(projected.evidenceRetained, "hashes_only");
  assert.ok(!JSON.stringify(projected.detail).includes("123-45-6789"));
  assert.ok(!("sources" in projected.detail));
});

test("arithmetic-only observations with sources remain zero-call deterministic checks", async () => {
  let calls = 0;
  const r = await observeFinalOutput({ ...input, output: "2 + 3 = 5.", sources }, {
    review: async () => { calls++; return []; },
    persist: async () => 123,
  });
  assert.equal(calls, 0);
  assert.equal(r.semanticReview, "not_run");
  assert.equal(r.units[0].arithmetic?.correct, true);
});