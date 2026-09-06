// R125+146 — Workflow Replay sanitization + step-filtering invariants.
// Pure lib tests (no DB import) — server/lib/replay-sanitize.ts must never
// import db, or this file would hang the runner on an open pg pool.
import { test } from "node:test";
import assert from "node:assert/strict";
import { redactForReplay, capForReplay, isStepResultEntry } from "../../server/lib/replay-sanitize";

// ── redaction ────────────────────────────────────────────────────────────────
test("redacts emails", () => {
  const out = redactForReplay("contact bob.smith+x@example.co.uk for details");
  assert.ok(!out.includes("example.co.uk"), out);
  assert.ok(out.includes("[EMAIL]"), out);
});

test("redacts phone numbers but leaves short number runs alone", () => {
  const out = redactForReplay("call +1 (555) 123-4567 about order 1234");
  assert.ok(out.includes("[PHONE]"), out);
  assert.ok(out.includes("order 1234"), out);
});

test("redacts Authorization / Bearer headers", () => {
  const out = redactForReplay("Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdef");
  assert.ok(!out.includes("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdef"), out);
});

test("redacts cookie values", () => {
  const out = redactForReplay("Set-Cookie: session=a1b2c3d4e5f6g7h8; Path=/");
  assert.ok(!out.includes("a1b2c3d4e5f6g7h8"), out);
});

test("redacts credentials in connection strings", () => {
  const out = redactForReplay("postgres://admin:hunter2secret@db.internal:5432/prod");
  assert.ok(!out.includes("hunter2secret"), out);
  assert.ok(out.includes("[REDACTED]:[REDACTED]@"), out);
});

test("redacts password/api_key style assignments", () => {
  const out = redactForReplay('password=Sup3rS3cret! api_key: "sk_live_something" client_secret=abcd1234');
  assert.ok(!out.includes("Sup3rS3cret"), out);
  assert.ok(!out.includes("sk_live_something"), out);
  assert.ok(!out.includes("abcd1234"), out);
});

test("redacts long opaque tokens", () => {
  const tok = "A".repeat(30) + "b1c2d3e4f5g6h7i8j9k0" ;
  const out = redactForReplay(`artifact id ${tok} stored`);
  assert.ok(!out.includes(tok), out);
});

test("leaves ordinary prose untouched", () => {
  const s = "Researched 3 competitors and drafted a 500-word summary for step 4.";
  assert.equal(redactForReplay(s), s);
});

// ── capping ──────────────────────────────────────────────────────────────────
test("capForReplay truncates over the limit and never exceeds cap+marker", () => {
  // Use word-separated text — an unbroken 9000-char run would (correctly)
  // be swallowed by the long-opaque-token redactor before capping.
  const out = capForReplay("lorem ipsum ".repeat(800), 100)!;
  assert.ok(out.length < 200, String(out.length));
  assert.ok(out.includes("truncated"), out);
});

test("capForReplay returns null for null/undefined", () => {
  assert.equal(capForReplay(null), null);
  assert.equal(capForReplay(undefined), null);
});

// ── step filtering ───────────────────────────────────────────────────────────
test("accepts real step-result entries", () => {
  assert.ok(isStepResultEntry({ step: 1, agent: "Atlas", success: true, summary: "done" }));
  assert.ok(isStepResultEntry({ step: 3, output: "text" }));
});

test("rejects lifecycle entries without a step number", () => {
  assert.ok(!isStepResultEntry({ event: "execution.started", at: "2026-08-01" }));
  assert.ok(!isStepResultEntry({ event: "execution.wave", wave: 2 }));
  assert.ok(!isStepResultEntry({ event: "replanning", reason: "deadlock" }));
});

test("rejects invalid step numbers (0, negative, float, string)", () => {
  assert.ok(!isStepResultEntry({ step: 0, summary: "x" }));
  assert.ok(!isStepResultEntry({ step: -1, summary: "x" }));
  assert.ok(!isStepResultEntry({ step: 1.5, summary: "x" }));
  assert.ok(!isStepResultEntry({ step: "1", summary: "x" }));
  assert.ok(!isStepResultEntry(null));
  assert.ok(!isStepResultEntry("execution.started"));
});

test("event-tagged entries WITH results still count as steps", () => {
  assert.ok(isStepResultEntry({ event: "step.completed", step: 2, success: true }));
});
