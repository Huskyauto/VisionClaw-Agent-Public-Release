import { test } from "node:test";
import assert from "node:assert/strict";

import {
  scanFailureModes,
  isTextLike,
} from "../../server/lib/deliverable-failure-modes.ts";

// All assertions exercise the PURE no-LLM scanner — no DB, no network, no model.

test("isTextLike recognizes text extensions and mimes, rejects binary", () => {
  assert.equal(isTextLike(".md"), true);
  assert.equal(isTextLike(".CSV"), true); // case-insensitive
  assert.equal(isTextLike(".json"), true);
  assert.equal(isTextLike(undefined, "text/plain"), true);
  assert.equal(isTextLike(undefined, "application/json"), true);
  assert.equal(isTextLike(undefined, "application/xml"), true);
  assert.equal(isTextLike(".png"), false);
  assert.equal(isTextLike(".pdf", "application/pdf"), false);
  assert.equal(isTextLike(undefined, undefined), false);
});

test("empty_content is HARD and short-circuits the rest of the scan", () => {
  const r = scanFailureModes("   \n\t  ", { ext: ".txt" });
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].mode, "empty_content");
  assert.equal(r.blocking.length, 1);
  assert.equal(r.advisory.length, 0);
});

test("ai_meta_leakage is detected as HARD/blocking", () => {
  const text = "Here is your report.\n\nAs an AI language model, I cannot provide live stock prices.\n" + "x".repeat(50);
  const r = scanFailureModes(text, { ext: ".md" });
  assert.ok(r.findings.some((f) => f.mode === "ai_meta_leakage" && f.severity === "hard"));
  assert.ok(r.blocking.some((b) => b.includes("ai_meta_leakage")));
});

test("unfilled_placeholder catches handlebars, brackets, and ${} templates", () => {
  for (const ph of ["Hello {{ client_name }}", "Dear [CLIENT NAME], welcome", "total: ${unfilled_total}", "lorem ipsum dolor sit amet"]) {
    const r = scanFailureModes(ph + " " + "y".repeat(40), { ext: ".md" });
    assert.ok(r.findings.some((f) => f.mode === "unfilled_placeholder"), `expected placeholder finding for: ${ph}`);
  }
});

test("error_token_leakage is flagged for non-JSON but skipped for JSON", () => {
  const body = "The result is [object Object] and total = undefined here.\n" + "z".repeat(40);
  const md = scanFailureModes(body, { ext: ".md" });
  assert.ok(md.findings.some((f) => f.mode === "error_token_leakage"), "markdown should flag error tokens");

  // JSON legitimately contains null/values; the error-token bank is skipped.
  const json = scanFailureModes('{"value": null, "label": "undefined term"}\n' + "z".repeat(40), { ext: ".json" });
  assert.equal(json.findings.some((f) => f.mode === "error_token_leakage"), false);
});

test("truncation_marker is HARD/blocking", () => {
  const r = scanFailureModes("Section one done.\n[... truncated]\nmore\n" + "q".repeat(40), { ext: ".txt" });
  assert.ok(r.findings.some((f) => f.mode === "truncation_marker" && f.severity === "hard"));
});

test("clean deliverable yields zero findings", () => {
  const clean = "Quarterly summary: revenue rose to 4.2 million dollars across three regions. " +
    "The team shipped two products and onboarded eleven new customers.";
  const r = scanFailureModes(clean, { ext: ".md" });
  assert.equal(r.findings.length, 0);
  assert.equal(r.blocking.length, 0);
  assert.equal(r.advisory.length, 0);
});

test("suspicious_constant (ADVISORY) fires for a constant CSV column, ignores all-zero", () => {
  const csv = [
    "region,score,flag",
    "north,42,0",
    "south,42,0",
    "east,42,0",
    "west,42,0",
    "central,42,0",
  ].join("\n");
  const r = scanFailureModes(csv, { ext: ".csv" });
  const adv = r.findings.filter((f) => f.mode === "suspicious_constant");
  // "score" is a constant 42 → advisory; "flag" is all-zero → ignored.
  assert.equal(adv.length, 1);
  assert.equal(adv[0].severity, "advisory");
  assert.ok(r.advisory.length >= 1);
  assert.equal(r.blocking.length, 0, "advisory smells must never block");
});

test("suspicious_round (ADVISORY) fires when one exact percentage repeats >=5x", () => {
  const text = "Growth was 15.2% in Q1, 15.2% in Q2, 15.2% in Q3, 15.2% in Q4, and 15.2% again in summary. " + "w".repeat(30);
  const r = scanFailureModes(text, { ext: ".md" });
  assert.ok(r.findings.some((f) => f.mode === "suspicious_round" && f.severity === "advisory"));
  assert.equal(r.blocking.length, 0);
});

test("scanFailureModes never throws on odd input (fail-open)", () => {
  for (const v of [undefined, null, "", 12345, {}]) {
    const r = scanFailureModes(v as any, { ext: ".md" });
    assert.equal(Array.isArray(r.findings), true);
    assert.equal(Array.isArray(r.blocking), true);
    assert.equal(Array.isArray(r.advisory), true);
  }
});
