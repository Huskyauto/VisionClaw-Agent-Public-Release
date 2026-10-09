import test from "node:test";
import assert from "node:assert/strict";
import { scoutIncomePublicEvidence } from "../../server/lib/income-discovery-scout";

test("evidence-first scouting makes one free public lookup per seat without leaking the original prompt", async () => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const pass = await scoutIncomePublicEvidence(1,
    "Private launch details: https://private.example, private@example.com. Find HVAC buyer pain.",
    async (tool, args) => {
      calls.push([tool, args]);
      return { success: true, results: [{ url: "https://example.org/report", text: "Documented buyer complaints",
        content: "Documented buyer complaints", source: "public" }] };
    });
  assert.deepEqual(calls, [["web_search",
    { free_only: true, query: "hvac comparable service prices public sources" }]]);
  assert.equal(pass.receipts.length, 1);
  assert.equal(pass.receipts[0].ok, true);
  assert.deepEqual(pass.receipts[0].sources, [
    { url: "https://example.org/report", text: "Documented buyer complaints" }]);
  assert.ok(!JSON.stringify(pass).includes("private.example"));
});

test("failed searches and query echoes without returned source text stay unavailable", async () => {
  for (const output of [
    { error: "Unavailable" },
    { success: false, results: [{ url: "https://example.org", text: "A cached public signal" }] },
    { blocked: true, results: [{ url: "https://example.org", text: "A cached public signal" }] },
    { success: true, results: [], query: "HVAC demand" },
    { success: true, results: [{ url: "https://example.org", text: "" }] },
  ]) {
    const pass = await scoutIncomePublicEvidence(0, "HVAC", async () => output);
    assert.equal(pass.receipts[0].ok, false);
  }
});
