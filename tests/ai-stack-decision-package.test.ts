import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { INCOME_OPPORTUNITIES } from "../client/src/data/income-opportunities";
import { DECISION_REVIEW_DOCUMENTS, DECISION_REVIEW_META, buildDecisionReviewMarkdown } from "../shared/ai-stack-decision-package";

test("complete manual-first decision review package exports every document without external actions", () => {
  assert.equal(DECISION_REVIEW_META.price, 350);
  assert.equal(DECISION_REVIEW_META.path, "/income-opportunities/ai-stack-decision-review");
  const ids = DECISION_REVIEW_DOCUMENTS.map((document) => document.id);
  assert.deepEqual(ids, ["offer", "sample", "intake", "method", "fulfillment", "economics", "launch", "templates"]);
  assert.equal(new Set(ids).size, ids.length);
  for (const document of DECISION_REVIEW_DOCUMENTS) {
    assert.ok(document.content.length > 900, `${document.id} must be substantive`);
  }
  const exported = buildDecisionReviewMarkdown();
  for (const document of DECISION_REVIEW_DOCUMENTS) assert.ok(exported.includes(document.content));
  assert.match(exported, /No payment checkout/);
  assert.match(exported, /Source-reviewed/);
  assert.match(exported, /Hypothetical/);
  assert.match(exported, /refund/i);
});

test("catalog exposes the package without claiming paid customer validation", () => {
  const item = INCOME_OPPORTUNITIES.find((entry) => entry.slug === "ai-stack-decision-review");
  assert.ok(item);
  assert.equal(item.evidence, "Idea");
  assert.equal(item.actionPath, "/income-opportunities/ai-stack-decision-review");
});

test("workspace is connected through owner-only routing and Income Opportunities navigation", () => {
  const app = fs.readFileSync("client/src/App.tsx", "utf8");
  const sidebar = fs.readFileSync("client/src/components/app-sidebar.tsx", "utf8");
  assert.match(app, /isPlatformAdmin && <Route path="\/income-opportunities\/ai-stack-decision-review" component=\{AdminAiStackDecisionReviewPage\}/);
  assert.match(sidebar, /isPlatformAdmin && <NavLink path="\/income-opportunities\/ai-stack-decision-review"[^>]*label="AI Stack Decision Review"/);
});
