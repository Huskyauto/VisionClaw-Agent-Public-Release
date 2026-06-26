// R115 — External Review Council invariant tests (node:test). Pure logic +
// static-source contracts. LLM fan-out is covered by multi-lineage-review.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

type V = "approve" | "reject" | "needs_revision" | "abstain";

function tallyVotes(votes: Array<{ verdict: V | "error" }>) {
  const productive = votes.filter((v) => v.verdict === "approve" || v.verdict === "reject" || v.verdict === "needs_revision");
  if (productive.length < 2) {
    return { verdict: "abstain" as V, consensusCount: productive.length, reviewerCount: productive.length };
  }
  const counts: Record<string, number> = { approve: 0, reject: 0, needs_revision: 0 };
  for (const v of productive) counts[v.verdict as string]++;
  const top = (Object.entries(counts) as [V, number][]).reduce((best, cur) => (cur[1] > best[1] ? cur : best), ["abstain" as V, 0]);
  if (top[1] < 2) return { verdict: "abstain" as V, consensusCount: top[1], reviewerCount: productive.length };
  return { verdict: top[0], consensusCount: top[1], reviewerCount: productive.length };
}

function computeAgreement(verdict: string, finalDecision: string): boolean | null {
  if (finalDecision === "deferred" || verdict === "abstain" || verdict === "pending" || verdict === "error") return null;
  if (finalDecision === "approved") return verdict === "approve";
  if (finalDecision === "rejected") return verdict === "reject";
  return null;
}

describe("R115 Council — tally rules", () => {
  it("3 approve -> APPROVE 3/3", () => {
    assert.deepEqual(tallyVotes([{ verdict: "approve" }, { verdict: "approve" }, { verdict: "approve" }]),
      { verdict: "approve", consensusCount: 3, reviewerCount: 3 });
  });
  it("2 approve + 1 reject -> APPROVE 2/3", () => {
    assert.deepEqual(tallyVotes([{ verdict: "approve" }, { verdict: "approve" }, { verdict: "reject" }]),
      { verdict: "approve", consensusCount: 2, reviewerCount: 3 });
  });
  it("2 reject + 1 needs_revision -> REJECT 2/3", () => {
    assert.deepEqual(tallyVotes([{ verdict: "reject" }, { verdict: "reject" }, { verdict: "needs_revision" }]),
      { verdict: "reject", consensusCount: 2, reviewerCount: 3 });
  });
  it("1-1-1 split -> ABSTAIN", () => {
    const r = tallyVotes([{ verdict: "approve" }, { verdict: "reject" }, { verdict: "needs_revision" }]);
    assert.equal(r.verdict, "abstain");
    assert.equal(r.reviewerCount, 3);
  });
  it("only 1 productive (2 errors) -> ABSTAIN", () => {
    const r = tallyVotes([{ verdict: "approve" }, { verdict: "error" }, { verdict: "error" }]);
    assert.equal(r.verdict, "abstain");
    assert.equal(r.consensusCount, 1);
    assert.equal(r.reviewerCount, 1);
  });
  it("all errors -> ABSTAIN 0/0", () => {
    assert.deepEqual(tallyVotes([{ verdict: "error" }, { verdict: "error" }, { verdict: "error" }]),
      { verdict: "abstain", consensusCount: 0, reviewerCount: 0 });
  });
  it("2 approve + 1 error -> APPROVE 2/2 (errors not counted)", () => {
    assert.deepEqual(tallyVotes([{ verdict: "approve" }, { verdict: "approve" }, { verdict: "error" }]),
      { verdict: "approve", consensusCount: 2, reviewerCount: 2 });
  });
  it("2 needs_revision + 1 approve -> NEEDS_REVISION 2/3", () => {
    assert.deepEqual(tallyVotes([{ verdict: "needs_revision" }, { verdict: "needs_revision" }, { verdict: "approve" }]),
      { verdict: "needs_revision", consensusCount: 2, reviewerCount: 3 });
  });
});

describe("R115 Council — agreement computation (track record)", () => {
  it("approve + approved -> true", () => assert.equal(computeAgreement("approve", "approved"), true));
  it("approve + rejected -> false (override)", () => assert.equal(computeAgreement("approve", "rejected"), false));
  it("reject + rejected -> true", () => assert.equal(computeAgreement("reject", "rejected"), true));
  it("reject + approved -> false (override)", () => assert.equal(computeAgreement("reject", "approved"), false));
  it("needs_revision + approved -> false", () => assert.equal(computeAgreement("needs_revision", "approved"), false));
  it("abstain + any -> null", () => {
    assert.equal(computeAgreement("abstain", "approved"), null);
    assert.equal(computeAgreement("abstain", "rejected"), null);
  });
  it("deferred -> null", () => {
    assert.equal(computeAgreement("approve", "deferred"), null);
    assert.equal(computeAgreement("reject", "deferred"), null);
  });
  it("error/pending -> null", () => {
    assert.equal(computeAgreement("error", "approved"), null);
    assert.equal(computeAgreement("pending", "rejected"), null);
  });
});

describe("R115 Council — read-only static contract", () => {
  const libSrc = readFileSync("server/lib/external-review-council.ts", "utf8");

  it("never imports write_file or apply/rollback mutators", () => {
    assert.ok(!/import.*write_file/i.test(libSrc));
    assert.ok(!/import\s*\{[^}]*applyProcedureEdit/.test(libSrc));
    assert.ok(!/import\s*\{[^}]*rollbackProcedureEdit/.test(libSrc));
  });

  it("imports getProcedureEdit (read-only) from aevo-meta-editor", () => {
    assert.match(libSrc, /import\s*\{\s*getProcedureEdit\s*\}\s*from\s*"\.\/aevo-meta-editor"/);
  });

  it("every INSERT/UPDATE targets council_verdicts only", () => {
    const mutations = libSrc.match(/(?:INSERT INTO|UPDATE)\s+(\w+)/gi) || [];
    assert.ok(mutations.length > 0, "expected at least one mutation");
    for (const m of mutations) {
      assert.match(m, /council_verdicts/i, `forbidden mutation target: ${m}`);
    }
  });

  it("every UPDATE includes tenant_id scope (no cross-tenant leak)", () => {
    const updates = libSrc.split(/\bUPDATE\s+council_verdicts/i).slice(1);
    for (const u of updates) {
      const stmt = u.split("`")[0];
      assert.match(stmt, /tenant_id\s*=/i, "UPDATE missing tenant_id WHERE clause");
    }
  });
});

describe("R115 Council — three-lineage diversity invariant", () => {
  const libSrc = readFileSync("server/lib/external-review-council.ts", "utf8");
  it("reviewer pool spans openai + anthropic + google", () => {
    assert.match(libSrc, /REVIEWER_LINEAGES[^=]*=\s*\[[^\]]*"openai"[^\]]*"anthropic"[^\]]*"google"[^\]]*\]/s);
  });
  it("minResponses = 2 (a single reviewer never decides)", () => {
    assert.match(libSrc, /minResponses:\s*2/);
  });
});

describe("R115 Council — schema invariants", () => {
  const schemaSrc = readFileSync("shared/schema.ts", "utf8");
  it("council_verdicts table declared with tenantId NOT NULL no default", () => {
    const block = schemaSrc.split('pgTable("council_verdicts"')[1]?.split("}));")[0] || "";
    assert.ok(block.length > 0, "council_verdicts table not found");
    assert.match(block, /tenantId:\s*integer\("tenant_id"\)\.notNull\(\)/);
    assert.ok(!/tenant_id.*default/i.test(block.split("tenantId")[1]?.split(",")[0] || ""), "tenantId must have no default");
  });
  it("council_verdicts has procedure_edit_id, verdict, plain_english_summary, per_model_votes", () => {
    const block = schemaSrc.split('pgTable("council_verdicts"')[1]?.split("}));")[0] || "";
    assert.match(block, /procedureEditId/);
    assert.match(block, /verdict.*notNull/);
    assert.match(block, /plainEnglishSummary.*notNull/);
    assert.match(block, /perModelVotes/);
  });
});

describe("R115 Council — route surface", () => {
  const routesSrc = readFileSync("server/routes/council-verdicts.ts", "utf8");
  const mountSrc = readFileSync("server/routes.ts", "utf8");
  it("mounted at /api/council-verdicts behind authMiddleware", () => {
    assert.match(mountSrc, /app\.use\("\/api\/council-verdicts",\s*authMiddleware,\s*councilVerdictsRouter\)/);
  });
  it("exposes request, by-edit, final, track-record endpoints", () => {
    assert.match(routesSrc, /\.post\("\/request\/:editId"/);
    assert.match(routesSrc, /\.get\("\/by-edit\/:editId"/);
    assert.match(routesSrc, /\.post\("\/:id\/final"/);
    assert.match(routesSrc, /\.get\("\/track-record"/);
  });
  it("every route requires tenant context (getTenantFromRequest)", () => {
    const handlers = routesSrc.match(/councilVerdictsRouter\.(get|post)[\s\S]*?^\}\);/gm) || [];
    assert.ok(handlers.length >= 4, `expected 4+ handlers, found ${handlers.length}`);
    for (const h of handlers) {
      assert.match(h, /getTenantFromRequest/, "handler missing tenant scope");
    }
  });
});
