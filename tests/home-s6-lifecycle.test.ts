import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("client/src/pages/home.tsx", "utf8");

test("Home renders every lifecycle label and bounded blocker/publish action", () => {
  for (const label of ["Awaiting approval", "Approved", "Executing", "Blocked", "Workspace review pending", "Publish required", "Verified"]) {
    assert.ok(source.includes(label), `missing lifecycle label: ${label}`);
  }
  assert.match(source, /plan\.blockerReason/);
  assert.match(source, /Review and publish when ready/);
});

test("approval controls remain in the awaiting-plan card, not recent activity", () => {
  const awaitingStart = source.indexOf("pendingPlans.map");
  const recentStart = source.indexOf("activeOrRecentPlans.map");
  assert.ok(awaitingStart >= 0 && recentStart > awaitingStart);
  const awaiting = source.slice(awaitingStart, recentStart);
  const recent = source.slice(recentStart);
  assert.match(awaiting, /button-approve-plan/);
  assert.doesNotMatch(recent, /button-approve-plan|button-revise-plan|button-reject-plan/);
  assert.match(recent, /plan\.lifecycle !== "archived"/);
});

test("publish-required activity is review-only and has no replacement or auto-publish action", () => {
  assert.match(source, /lifecycle === "publish_required"/);
  assert.match(source, /Publish required · Review and publish when ready/);
  assert.doesNotMatch(source, /autoPublish|publishPlan|replacePlan|replacementPlan/);
});

test("handoff-pending activity is review-only and has no decision or publish action", () => {
  assert.match(source, /lifecycle === "handoff_pending"/);
  assert.match(source, /Workspace review pending/);
  const recentStart = source.indexOf("activeOrRecentPlans.map");
  const recent = source.slice(recentStart);
  assert.doesNotMatch(recent, /button-approve-plan|button-revise-plan|button-reject-plan|publishPlan|autoPublish/);
});