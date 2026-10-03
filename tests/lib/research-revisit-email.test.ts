import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEmailHtml, buildEmailText, isAcceptedMailResult, isCompleteMaintenanceSummary } from "../../server/weekly-maintenance-cron";

test("weekly owner summary includes advisory research candidates, HTML-escaped", () => {
  const summary = {
    generatedAt: "2026-09-23T12:00:00Z",
    weekOf: "2026-09-23",
    overallStatus: "GREEN" as const,
    passes: [{
      name: "Pass 25: Prior research revisit (advisory)",
      status: "GREEN",
      findings: [{
        severity: "INFO",
        message: "Review candidate: Study <script> (rotation; .agents/memory/test-verdict.md)",
      }],
      durationMs: 0,
    }],
    actionsTaken: [],
    actionsQueued: [],
    ownerActionRequired: [],
  };
  assert.match(buildEmailText(summary), /Review candidate: Study <script>/);
  const html = buildEmailHtml(summary);
  assert.match(html, /Review candidate: Study &lt;script&gt;/);
  assert.doesNotMatch(html, /Study <script>/);
});

test("weekly email text carries every finding and queued action for exact-repeat detection", () => {
  const summary = {
    generatedAt: "2026-09-23T12:00:00Z", weekOf: "2026-09-21",
    overallStatus: "RED" as const,
    passes: [{ name: "Pass 1: audit", status: "RED", findings: [
      { severity: "HIGH", message: "Critical advisory" },
      { severity: "LOW", message: "New patch recommendation" },
    ], durationMs: 0 }],
    actionsTaken: [], actionsQueued: ["Review new patch"], ownerActionRequired: [],
  };
  const text = buildEmailText(summary);
  assert.match(text, /LOW: New patch recommendation/);
  assert.match(text, /Review new patch/);
  const changedDetail = {
    ...summary,
    passes: [{ ...summary.passes[0], findings: [
      { severity: "HIGH", message: "Critical advisory", detail: { advisory: "B" } },
      summary.passes[0].findings[1],
    ] }],
  };
  assert.notEqual(buildEmailText(summary), buildEmailText(changedDetail));
  assert.doesNotMatch(buildEmailText(changedDetail), /advisory.*B/);
});

test("a queued or silenced owner digest is not reported as a provider-accepted weekly email", () => {
  assert.equal(isAcceptedMailResult({ queued: true }), false);
  assert.equal(isAcceptedMailResult({ silenced: true }), false);
  assert.equal(isAcceptedMailResult(undefined), false);
  assert.equal(isAcceptedMailResult({ id: "provider-message" }), true);
  assert.equal(isAcceptedMailResult({ messageId: "provider-message", threadId: "thread" }), true);
  assert.equal(isAcceptedMailResult({ messageId: "" }), false);
  assert.equal(isAcceptedMailResult({ message_id: "  " }), false);
});

test("a partial but parseable report cannot masquerade as a complete weekly review", () => {
  const passes = Array.from({ length: 25 }, (_, n) => ({
    name: `Pass ${n + 1}: example`, status: "GREEN",
    findings: n === 24 ? [{ severity: "INFO", message: "Candidate" }] : [], durationMs: 0,
  }));
  const base = {
    generatedAt: "2026-09-23", weekOf: "2026-09-23", overallStatus: "GREEN",
    passes, actionsTaken: [], actionsQueued: [], ownerActionRequired: [],
  };
  assert.equal(isCompleteMaintenanceSummary(base), true);
  assert.equal(isCompleteMaintenanceSummary({ ...base, passes: passes.slice(0, 24) }), false);
  assert.equal(isCompleteMaintenanceSummary({ ...base, passes: passes.map((p, n) => n === 24 ? { ...p, findings: [] } : p) }), false);
  assert.equal(isCompleteMaintenanceSummary({ ...base, passes: passes.map((p, n) => n === 24 ? { ...p, findings: null } : p) }), false);
});