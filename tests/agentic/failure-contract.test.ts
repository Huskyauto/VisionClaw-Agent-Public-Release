/**
 * FAILURE CONTRACT — unit coverage for the deterministic terminal-failure
 * renderer (server/agentic/failure-contract.ts).
 *
 * Pure-function suite: NO DB, NO network, so it never opens a pg pool (which
 * would hang the per-file node process). Top-level imports only — inline
 * require() throws under the tsx ESM test loader.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderFailureContract } from "../../server/agentic/failure-contract";

test("renders all four sections (completed / failed / exists / next step)", () => {
  const { text } = renderFailureContract({
    reason: "approval_rejected",
    completed: ["Drafted the outline", "Generated 3 of 5 scenes"],
    failed: { what: "the publish step", why: "you declined it" },
    artifacts: [{ label: "Draft video", url: "https://example.com/x.mp4" }],
    nextStep: "Approve the publish or adjust the script.",
  });
  assert.match(text, /What completed/);
  assert.match(text, /What failed/);
  assert.match(text, /What exists right now/);
  assert.match(text, /Next step/);
  assert.match(text, /Drafted the outline/);
  assert.match(text, /Draft video: https:\/\/example\.com\/x\.mp4/);
});

test("empty completed/artifacts produce honest placeholders, not blank sections", () => {
  const { text, meta } = renderFailureContract({
    reason: "budget_halt",
    failed: { what: "the run", why: "hit the safety budget ceiling" },
    nextStep: "Raise the budget or narrow the request.",
  });
  assert.match(text, /Nothing was completed/);
  assert.match(text, /No saved artifact/);
  assert.equal(meta.completed.length, 0);
  assert.equal(meta.artifacts.length, 0);
});

test("default headline + owner are inferred from reason", () => {
  const rejected = renderFailureContract({
    reason: "approval_rejected",
    failed: { what: "x", why: "y" },
    nextStep: "z",
  });
  assert.equal(rejected.meta.nextStepOwner, "user");
  assert.match(rejected.meta.headline, /approval/i);

  const budget = renderFailureContract({
    reason: "budget_halt",
    failed: { what: "x", why: "y" },
    nextStep: "z",
  });
  assert.equal(budget.meta.nextStepOwner, "owner");
});

test("explicit headline + owner override the defaults", () => {
  const { meta } = renderFailureContract({
    reason: "tool_error",
    headline: "Custom headline",
    failed: { what: "x", why: "y" },
    nextStep: "z",
    nextStepOwner: "user",
  });
  assert.equal(meta.headline, "Custom headline");
  assert.equal(meta.nextStepOwner, "user");
});

test("long / multiline inputs are collapsed and clamped (no runaway error blobs)", () => {
  const huge = "a ".repeat(2000);
  const { meta } = renderFailureContract({
    reason: "tool_error",
    failed: { what: "step", why: huge + "\n\nstack\ttrace\nlines" },
    nextStep: "do x",
  });
  assert.ok(meta.failed.why.length <= 501, `why should be clamped, got ${meta.failed.why.length}`);
  assert.ok(!meta.failed.why.includes("\n"), "newlines should be collapsed");
});

test("untrusted angle-bracket input is HTML-escaped (no raw tag injection)", () => {
  const { text, meta } = renderFailureContract({
    reason: "approval_rejected",
    failed: {
      what: 'the action ("<script>alert(1)</script>")',
      why: "you declined it — <img src=x onerror=alert(1)>",
    },
    nextStep: "retry",
  });
  assert.ok(!text.includes("<script>"), "raw <script> tag must not survive");
  assert.ok(!text.includes("<img"), "raw <img> tag must not survive");
  assert.match(text, /&lt;script&gt;/);
  assert.ok(!meta.failed.why.includes("<"), "meta should also be escaped");
});

test("untrusted markdown metacharacters are escaped (no inline link/image/emphasis injection)", () => {
  const { text, meta } = renderFailureContract({
    reason: "approval_rejected",
    failed: {
      what: "the [click here](https://evil.example/steal) step",
      why: "rejected — ![pwn](https://evil.example/x.png) `rm -rf` *urgent* _now_ |a|b|",
    },
    nextStep: "Visit [our site](https://evil.example) to continue",
    artifacts: [{ label: "Draft [x](y)", url: "https://example.com/a(b).mp4" }],
  });
  // The opening bracket is escaped, so the unescaped link/image forms (the only
  // thing a renderer turns into a live anchor/img) are gone — even though the
  // inert `](` character sequence still exists as plain text.
  assert.ok(!text.includes("[click here]("), "unescaped markdown link must not survive");
  assert.ok(!text.includes("![pwn]("), "unescaped markdown image must not survive");
  assert.match(text, /\\\[click here\\\]/, "link brackets should be backslash-escaped");
  assert.match(text, /\\`rm -rf\\`/, "code span backticks should be escaped");
  assert.match(text, /\\\*urgent\\\*/, "emphasis asterisks should be escaped");
  // The real artifact URL is NOT mangled (mdSafe=false) — parens preserved.
  assert.match(text, /https:\/\/example\.com\/a\(b\)\.mp4/, "artifact URL must stay intact");
  assert.ok(meta.failed.what.includes("\\[click here\\]"), "meta is escaped too");
});

test("meta is structured and self-consistent with the reason", () => {
  const { meta } = renderFailureContract({
    reason: "consecutive_failure_cap",
    completed: ["a"],
    failed: { what: "the step", why: "failed 3x" },
    artifacts: [{ label: "partial" }],
    nextStep: "retry narrower",
  });
  assert.equal(meta.kind, "failure_contract");
  assert.equal(meta.reason, "consecutive_failure_cap");
  assert.equal(meta.completed[0], "a");
  assert.equal(meta.artifacts[0].label, "partial");
  assert.equal(meta.artifacts[0].url, undefined);
});

test("unknown reason falls back to a safe generic contract", () => {
  const { text, meta } = renderFailureContract({
    reason: "unknown",
    failed: { what: "the run", why: "an unexpected error" },
    nextStep: "review and retry",
  });
  assert.equal(meta.reason, "unknown");
  assert.equal(meta.nextStepOwner, "agent");
  assert.match(text, /could not be completed/i);
});
