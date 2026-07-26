import { test } from "node:test";
import assert from "node:assert/strict";
import {
  redactPiiForStorage,
  redactRecordFields,
  redactObjectForStorage,
} from "../../server/storage-helpers/pii-redaction-guard";

test("redacts a valid (Luhn) credit-card number", () => {
  const r = redactPiiForStorage("card on file 4111 1111 1111 1111 thanks");
  assert.ok(r.redacted.includes("[REDACTED_CC]"), r.redacted);
  assert.ok(!r.redacted.includes("4111"), r.redacted);
  assert.ok(r.redactedClasses.includes("credit_card"));
});

test("leaves a Luhn-INVALID long number alone (no false positive)", () => {
  const r = redactPiiForStorage("order id 1234 5678 9012 3456 placed");
  assert.ok(r.redacted.includes("1234 5678 9012 3456"), r.redacted);
  assert.ok(!r.redactedClasses.includes("credit_card"));
});

test("redacts a US SSN", () => {
  const r = redactPiiForStorage("ssn is 123-45-6789 on file");
  assert.ok(r.redacted.includes("[REDACTED_SSN]"), r.redacted);
  assert.ok(!r.redacted.includes("123-45-6789"));
  assert.ok(r.redactedClasses.includes("ssn"));
});

test("does NOT treat an SSA-invalid range as an SSN", () => {
  const r = redactPiiForStorage("ref 000-12-3456 internal");
  assert.ok(r.redacted.includes("000-12-3456"), r.redacted);
  assert.ok(!r.redactedClasses.includes("ssn"));
});

test("composes secret scanning (e.g. AWS-style key) and redacts it", () => {
  const r = redactPiiForStorage("key REDACTED_AWS_KEY in note");
  assert.ok(!r.redacted.includes("REDACTED_AWS_KEY"), r.redacted);
  assert.ok(r.redactedClasses.includes("secret"));
});

test("DETECTS but does NOT strip email/phone by default (CRM safety)", () => {
  const r = redactPiiForStorage("contact bob@example.com or 415-555-1234");
  assert.ok(r.redacted.includes("bob@example.com"), r.redacted);
  assert.ok(r.redacted.includes("415-555-1234"), r.redacted);
  assert.ok(r.detectedClasses.includes("email"));
  assert.ok(r.detectedClasses.includes("phone"));
  assert.ok(!r.redactedClasses.includes("email"));
  assert.ok(!r.redactedClasses.includes("phone"));
});

test("STRIPS email/phone when redactContactInfo is opted in", () => {
  const r = redactPiiForStorage("contact bob@example.com or 415-555-1234", {
    redactContactInfo: true,
  });
  assert.ok(r.redacted.includes("[REDACTED_EMAIL]"), r.redacted);
  assert.ok(r.redacted.includes("[REDACTED_PHONE]"), r.redacted);
  assert.ok(r.redactedClasses.includes("email"));
  assert.ok(r.redactedClasses.includes("phone"));
});

test("benign business text is left fully intact", () => {
  const input = "Customer prefers morning meetings and dark-roast coffee.";
  const r = redactPiiForStorage(input);
  assert.equal(r.redacted, input);
  assert.equal(r.redactedClasses.length, 0);
  assert.equal(r.detectedClasses.length, 0);
});

test("handles empty / non-string input safely", () => {
  assert.equal(redactPiiForStorage("").redacted, "");
  assert.equal(redactPiiForStorage(null).redacted, "");
  assert.equal(redactPiiForStorage(undefined).redacted, "");
  assert.deepEqual(redactPiiForStorage(42 as unknown).redactedClasses, []);
});

test("redactRecordFields redacts only the named string fields", () => {
  const input = { title: "ssn 123-45-6789", content: "all good", tenantId: 7 };
  const r = redactRecordFields(input, ["title", "content"]);
  assert.ok(r.data.title.includes("[REDACTED_SSN]"), r.data.title);
  assert.equal(r.data.content, "all good");
  assert.equal(r.data.tenantId, 7);
  assert.ok(r.redactedClasses.includes("ssn"));
});

test("redactRecordFields returns the SAME object reference when nothing redacted", () => {
  const input = { fact: "customer likes coffee", tenantId: 1 };
  const r = redactRecordFields(input, ["fact"]);
  assert.equal(r.data, input);
  assert.equal(r.redactedClasses.length, 0);
});

test("redactRecordFields skips missing / non-string fields safely", () => {
  const input = { fact: undefined as unknown as string, tenantId: 1 };
  const r = redactRecordFields(input, ["fact"]);
  assert.equal(r.data, input);
  assert.equal(r.redactedClasses.length, 0);
});

test("redactObjectForStorage keeps JSON valid when a CC appears as a numeric leaf", () => {
  const entry = { seq: 12, card: 4111111111111111, note: "ssn 123-45-6789" };
  const r = redactObjectForStorage(entry);
  const serialized = JSON.stringify(r.redacted);
  const parsed = JSON.parse(serialized); // must not throw
  assert.equal(parsed.card, "[REDACTED_CC]");
  assert.ok(parsed.note.includes("[REDACTED_SSN]"), parsed.note);
  assert.equal(parsed.seq, 12);
  assert.ok(r.redactedClasses.includes("credit_card"));
  assert.ok(r.redactedClasses.includes("ssn"));
});

test("redactObjectForStorage walks nested arrays/objects and leaves benign data", () => {
  const entry = { a: [{ b: "all good" }, { b: 42 }], c: "fine" };
  const r = redactObjectForStorage(entry);
  assert.deepEqual(r.redacted, entry);
  assert.equal(r.redactedClasses.length, 0);
});

test("is idempotent on already-redacted output", () => {
  const once = redactPiiForStorage("ssn 123-45-6789 card 4111111111111111");
  const twice = redactPiiForStorage(once.redacted);
  assert.equal(twice.redacted, once.redacted);
  assert.equal(twice.redactedClasses.length, 0);
});
