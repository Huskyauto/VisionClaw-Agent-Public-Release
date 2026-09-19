/**
 * R125+137.22 — summary quality audit + deterministic fallback (pure lib,
 * query-free: no DB imports, no pg pool).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  auditSummaryQuality,
  buildFallbackSummary,
  extractIdentifiers,
  REQUIRED_SUMMARY_SECTIONS,
} from "../../server/lib/summary-quality";

const GOOD_SUMMARY = `
# Handoff
Objective: ship the OpenClaw borrow round.
Progress: T1 and T4 completed; commitments miner wired in server/chat-engine.ts.
Pending: T2 tests remaining; next steps are the gates.
Decisions: chose in-memory ring buffer over a new table.
Identifiers: server/lib/egress-telemetry.ts, R125+137.22.
`;

test("good summary passes the audit", () => {
  const r = auditSummaryQuality(GOOD_SUMMARY);
  assert.equal(r.ok, true);
  assert.deepEqual(r.missingSections, []);
});

test("empty summary fails with all sections missing", () => {
  const r = auditSummaryQuality("");
  assert.equal(r.ok, false);
  assert.equal(r.missingSections.length, REQUIRED_SUMMARY_SECTIONS.length);
});

test("summary missing pending/decisions sections is flagged", () => {
  const r = auditSummaryQuality(
    "Objective: do a thing. Progress: files done in a.ts. Identifiers: a.ts and more text to pass the length floor for the audit check here.",
  );
  assert.equal(r.ok, false);
  assert.ok(r.missingSections.includes("pending"));
  assert.ok(r.missingSections.includes("decisions"));
});

test("identifier extraction finds paths, env tokens, R-tags, urls", () => {
  const ids = extractIdentifiers(
    "edit server/tools.ts and set DATABASE_URL; see #123, R125+137.22, https://example.com/x",
  );
  assert.ok(ids.includes("server/tools.ts"));
  assert.ok(ids.includes("DATABASE_URL"));
  assert.ok(ids.includes("#123"));
  assert.ok(ids.some((i) => i.startsWith("R125")));
  assert.ok(ids.some((i) => i.startsWith("https://example.com")));
});

test("losing most literal identifiers fails the audit", () => {
  const source =
    "files: a1.ts b2.ts c3.ts d4.ts e5.ts f6.ts — env TOKEN_ALPHA plus SECRET_BETA and #4567";
  const summary =
    "Objective: stuff. Progress: done things. Pending: none. Decisions: made some. Identifiers: none kept but the text is long enough to clear the floor.";
  const r = auditSummaryQuality(summary, source);
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.includes("identifiers")));
  assert.ok(r.lostIdentifiers.length >= 5);
});

test("partial identifier pruning is tolerated", () => {
  const source = "files: a1.ts b2.ts c3.ts d4.ts e5.ts";
  const summary = `Objective: x. Progress: touched a1.ts, b2.ts, c3.ts. Pending: d4.ts review. Decisions: kept scope. Identifiers: a1.ts b2.ts c3.ts d4.ts`;
  const r = auditSummaryQuality(summary, source);
  assert.equal(r.ok, true);
});

test("fallback summary is deterministic, honest, and carries identifiers", () => {
  const src = "start of transcript mentioning server/heartbeat.ts and CRON_SECRET " + "x".repeat(3000) + " end of transcript";
  const fb = buildFallbackSummary(src, ["missing sections: pending"]);
  assert.ok(fb.includes("Deterministic fallback summary"));
  assert.ok(fb.includes("missing sections: pending"));
  assert.ok(fb.includes("server/heartbeat.ts"));
  assert.ok(fb.includes("CRON_SECRET"));
  assert.ok(fb.includes("Opening excerpt"));
  assert.ok(fb.includes("Closing excerpt"));
  assert.equal(fb, buildFallbackSummary(src, ["missing sections: pending"]));
});
