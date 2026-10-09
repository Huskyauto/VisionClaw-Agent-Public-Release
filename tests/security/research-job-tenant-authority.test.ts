import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getResearchJobTenantId } from "../../server/job-worker";

function job(tenantId: number | null, payload: Record<string, unknown>) {
  return { kind: "research_digest", tenantId, payload };
}

test("research job tenant validation makes the persisted tenant authoritative", () => {
  assert.equal(getResearchJobTenantId(job(41, {})), 41, "an absent payload tenant uses the persisted tenant");
  assert.equal(
    getResearchJobTenantId(job(41, { tenantId: 41 })),
    41,
    "a matching payload tenant remains compatible",
  );
  assert.throws(
    () => getResearchJobTenantId(job(41, { tenantId: 99 })),
    /research_digest tenant scope mismatch/,
  );
  assert.throws(
    () => getResearchJobTenantId(job(null, {})),
    /requires a positive persisted tenant scope/,
  );
});

test("research handlers validate tenant payloads before using only the persisted scope", () => {
  const source = readFileSync(new URL("../../server/job-worker.ts", import.meta.url), "utf8");
  const codeProposal = source.slice(
    source.indexOf('registerJobHandler("research_code_proposal"'),
    source.indexOf('registerJobHandler("research_digest"'),
  );
  const digest = source.slice(
    source.indexOf('registerJobHandler("research_digest"'),
    source.indexOf('registerJobHandler("astra_report_batch"'),
  );

  assert.match(codeProposal, /const tenantId = getResearchJobTenantId\(job\)/);
  assert.match(codeProposal, /const \{ sessionId, model,/);
  assert.match(codeProposal, /const session = \{ sessionId, tenantId, model \}/);
  assert.match(digest, /const tenantId = getResearchJobTenantId\(job\)/);
  assert.match(digest, /generateResearchDigest\(tenantId\)/);
  assert.doesNotMatch(codeProposal, /const \{[^}]*tenantId[^}]*\} = job\.payload/);
  assert.doesNotMatch(digest, /const \{[^}]*tenantId[^}]*\} = job\.payload/);
});