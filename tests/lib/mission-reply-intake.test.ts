// Query-free unit tests for the pure fail-closed helpers of the event-driven
// mission reply intake (server/lib/mission-reply-intake.ts). No DB queries —
// only the exported pure functions are exercised (node-test DB-pool hang rule).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { extractSenderEmail, assessReplyMessage, categoryFromEvidenceRow } from "../../server/lib/mission-reply-intake";

describe("extractSenderEmail", () => {
  test("extracts and lowercases from a display-name header", () => {
    assert.equal(extractSenderEmail(`"Jane Doe" <Jane.Doe+test@Example.COM>`), "jane.doe+test@example.com");
  });
  test("returns null when no address is present", () => {
    assert.equal(extractSenderEmail("no address here"), null);
    assert.equal(extractSenderEmail(""), null);
    assert.equal(extractSenderEmail(undefined as any), null);
  });
});

describe("assessReplyMessage (fail-closed intake gate)", () => {
  test("fetch failure never proceeds — null even with a valid-looking from", () => {
    assert.equal(assessReplyMessage({ fetchOk: false, from: "a@b.com", snippet: "" }), null);
  });

  test("unmatched sender is skipped when requireSender (default, automated path)", () => {
    assert.equal(assessReplyMessage({ fetchOk: true, from: "Mailer Daemon", snippet: "interested!" }), null);
  });

  test("operator path (requireSender=false) proceeds with contactEmail=null", () => {
    const a = assessReplyMessage({ fetchOk: true, from: "Mailer Daemon", snippet: "sounds great", requireSender: false });
    assert.deepEqual(a, { contactEmail: null });
  });

  test("matched sender proceeds with the lowercased address", () => {
    const a = assessReplyMessage({ fetchOk: true, from: "Buyer <Buyer@Corp.IO>", snippet: "yes let's talk" });
    assert.deepEqual(a, { contactEmail: "buyer@corp.io" });
  });
});

describe("categoryFromEvidenceRow (reconciliation category recovery)", () => {
  test("reads raw.category (object and stringified jsonb)", () => {
    assert.equal(categoryFromEvidenceRow({ raw: { category: "out_of_office" }, type: "other" }), "out_of_office");
    assert.equal(categoryFromEvidenceRow({ raw: JSON.stringify({ category: "bounce" }), type: "other" }), "bounce");
  });
  test("legacy rows fall back to the binary type mapping", () => {
    assert.equal(categoryFromEvidenceRow({ raw: {}, type: "positive_reply" }), "interested");
    assert.equal(categoryFromEvidenceRow({ raw: null, type: "negative_reply" }), "not_interested");
  });
  test("unknown category / junk rows yield null (no enrollment action)", () => {
    assert.equal(categoryFromEvidenceRow({ raw: { category: "banana" }, type: "other" }), null);
    assert.equal(categoryFromEvidenceRow({ raw: "not-json{", type: "other" }), null);
    assert.equal(categoryFromEvidenceRow(null), null);
  });
});
