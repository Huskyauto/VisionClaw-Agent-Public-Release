// Regression tests for two fail-direction branches in server/deliverable-verifier.ts
// flagged by the whole-app post-edit review (missing dedicated coverage):
//
//   1. MIME fail-CLOSED — a contract with requiredMimePattern must FAIL (not
//      silently pass) when the MIME cannot be determined from the extension.
//   2. auditPersisted flag — when the audit-row INSERT fails, verification
//      still returns (quality fails OPEN) but auditPersisted === false so the
//      repudiation gap is visible; on success auditPersisted === true.
//
// DB access is stubbed on the imported db object (no live query — keeps the
// pg pool from hanging the node:test process; see the run.sh gotcha).

import test from "node:test";
import assert from "node:assert/strict";
import { db } from "../../server/db";
import { verifyDeliverable, invalidateContractCache } from "../../server/deliverable-verifier";

const FAKE_CONTRACT = {
  id: 999,
  deliverableType: "mime-gated-test",
  requiredMimePattern: "application/pdf",
  requiredExtensions: null,
  renderCheck: "none",
  minSizeBytes: null,
  maxSizeBytes: null,
} as any;

function stubDb(opts: { persistThrows?: boolean }) {
  (db as any).select = () => ({ from: async () => [FAKE_CONTRACT] });
  (db as any).execute = async () => {
    if (opts.persistThrows) throw new Error("simulated audit-insert outage");
    return { rows: [{ id: 4242 }] };
  };
  invalidateContractCache();
}

test("MIME-gated contract FAILS CLOSED when MIME is undeterminable (no extension)", async () => {
  stubDb({});
  const r = await verifyDeliverable({
    tenantId: 1,
    deliverableType: "mime-gated-test",
    fileUrl: "https://example.com/deliverable-without-extension",
    buffer: Buffer.from("some bytes"),
  });
  assert.equal(r.status, "failed", `expected failed, got ${r.status}: ${r.failures.join("; ")}`);
  assert.equal(r.passed, false);
  assert.ok(
    r.failures.some((f) => /mime required/i.test(f)),
    `expected a "mime required" failure, got: ${r.failures.join("; ")}`,
  );
});

test("MIME-gated contract PASSES on a matching extension-derived MIME (happy path)", async () => {
  stubDb({});
  const r = await verifyDeliverable({
    tenantId: 1,
    deliverableType: "mime-gated-test",
    fileUrl: "https://example.com/report.pdf",
    buffer: Buffer.from("%PDF-1.4 fake body"),
  });
  assert.equal(r.status, "passed", `expected passed, got ${r.status}: ${r.failures.join("; ")}`);
  assert.equal(r.auditPersisted, true, "successful audit insert must set auditPersisted=true");
  assert.equal(r.verificationId, 4242);
});

test("audit-insert failure sets auditPersisted=false without throwing (repudiation gap visible)", async () => {
  stubDb({ persistThrows: true });
  const r = await verifyDeliverable({
    tenantId: 1,
    deliverableType: "mime-gated-test",
    fileUrl: "https://example.com/report.pdf",
    buffer: Buffer.from("%PDF-1.4 fake body"),
  });
  assert.equal(r.status, "passed", "verification itself still completes (quality fails OPEN)");
  assert.equal(r.auditPersisted, false, "failed audit insert must set auditPersisted=false");
  assert.equal(r.verificationId, undefined);
});

test("audit-insert failure on a FAILING verification still surfaces both signals", async () => {
  stubDb({ persistThrows: true });
  const r = await verifyDeliverable({
    tenantId: 1,
    deliverableType: "mime-gated-test",
    fileUrl: "https://example.com/no-extension-here",
    buffer: Buffer.from("x"),
  });
  assert.equal(r.status, "failed");
  assert.equal(r.auditPersisted, false);
});
