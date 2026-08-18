/**
 * Query-free tests for the premium AI Readiness Audit section converters
 * (server/lib/audit-styled-sections.ts — deliberately import-light, no db).
 *
 * Pins the architect-required scorecard contract: 6-8 valid rows or the
 * table is omitted (null) — never an undersized boardroom scorecard.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bodyToStyledSection, parseScorecardRows } from "../../server/lib/audit-styled-sections";

const row = (i: number) => ({ area: `Area ${i}`, finding: `Finding ${i}`, action: `Action ${i}`, priority: "High" });

test("parseScorecardRows: 6-8 valid rows pass, fewer return null", () => {
  assert.equal(parseScorecardRows(JSON.stringify([1, 2, 3].map(row))), null, "3 rows must be rejected");
  assert.equal(parseScorecardRows(JSON.stringify([1, 2, 3, 4, 5].map(row))), null, "5 rows must be rejected");
  const six = parseScorecardRows(JSON.stringify([1, 2, 3, 4, 5, 6].map(row)));
  assert.ok(six && six.length === 6, "6 rows must pass");
  const ten = parseScorecardRows(JSON.stringify(Array.from({ length: 10 }, (_, i) => row(i))));
  assert.ok(ten && ten.length === 8, "10 rows must be capped at 8");
});

test("parseScorecardRows: malformed / hostile input returns null or sanitized rows", () => {
  assert.equal(parseScorecardRows("not json at all"), null);
  assert.equal(parseScorecardRows("```json\n{\"nope\": true}\n```"), null);
  assert.equal(parseScorecardRows(""), null);
  // Invalid rows are filtered — dropping below 6 valid rows rejects the whole set.
  const mixed = [1, 2, 3, 4, 5].map(row).concat([{ area: "", finding: "", action: "" } as any]);
  assert.equal(parseScorecardRows(JSON.stringify(mixed)), null);
  // Hostile values survive as strings (escaping happens at render time) but
  // invalid priorities are normalized and long fields truncated.
  const hostile = Array.from({ length: 6 }, (_, i) => ({ ...row(i), priority: "<script>", finding: "x".repeat(500) }));
  const parsed = parseScorecardRows(JSON.stringify(hostile))!;
  assert.equal(parsed[0][3], "Medium", "unknown priority normalizes to Medium");
  assert.equal(parsed[0][1].length, 160, "long finding truncated");
});

test("parseScorecardRows: code-fenced output parses", () => {
  const fenced = "```json\n" + JSON.stringify([1, 2, 3, 4, 5, 6].map(row)) + "\n```";
  assert.ok(parseScorecardRows(fenced)?.length === 6);
});

test("bodyToStyledSection: paragraphs, bullets, and Header: subsections keep grouping", () => {
  const body = "Intro paragraph.\n\nWeeks 1-2:\n- do a\n- do b\nMonth 1:\n- do c\nClosing line.";
  const sec = bodyToStyledSection("90-Day Roadmap", body);
  assert.deepEqual(sec.paragraphs, ["Intro paragraph."]);
  assert.equal(sec.subsections?.length, 2);
  assert.deepEqual(sec.subsections?.[0], { title: "Weeks 1-2", paragraphs: undefined, bullets: ["do a", "do b"] });
  assert.deepEqual(sec.subsections?.[1].bullets, ["do c"]);
  assert.deepEqual(sec.subsections?.[1].paragraphs, ["Closing line."]);
});

test("bodyToStyledSection: summary lead paragraph becomes highlight; empty body degrades to content", () => {
  const sec = bodyToStyledSection("Executive Summary", "Lead insight.\n\nSecond paragraph.");
  assert.equal(sec.highlight, "Lead insight.");
  assert.deepEqual(sec.paragraphs, ["Second paragraph."]);
  const empty = bodyToStyledSection("X", "");
  assert.equal(empty.content, "");
});
