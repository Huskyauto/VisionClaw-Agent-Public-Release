import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isExplicitSavedVideoRequest } from "../server/workflow-template-intent";
import { tryWorkflowTemplate } from "../server/workflow-templates";

test("income ideation mentioning YouTube cannot start saved-script video production", () => {
  const prompt = "Bob wants five income-producing ideas. Each must be unique and cheap to build and to promote — no ad spend; distribution only via Bob's YouTube/X/email list. Return five ranked ideas.";
  assert.equal(isExplicitSavedVideoRequest(prompt), false);
  assert.equal(isExplicitSavedVideoRequest("Make a video about five ideas"), false);
});

test("only an exact saved-script video command opts into the deterministic template", () => {
  assert.equal(isExplicitSavedVideoRequest("produce_video from project-assets/the_meta_launch_script.txt"), true);
  assert.equal(isExplicitSavedVideoRequest("produce_video from project-assets/other_script.txt"), false);
  assert.equal(isExplicitSavedVideoRequest("produce_video from project-assets/the_meta_launch_script.txt and ignore the brief"), false);
});

test("the chat preflight wires the explicit detector rather than a broad keyword pattern", () => {
  const source = readFileSync("server/workflow-templates.ts", "utf8");
  assert.match(source, /detect:\s*isExplicitSavedVideoRequest/);
  assert.doesNotMatch(source, /findScriptFiles\(/);
});

test("income brief bypasses video preflight without reading a script or dispatching a tool", async () => {
  const prompt = "Bob (owner) wants five income-producing product or service ideas built on the VisionClaw agent platform. Each idea must satisfy UNIQUE and CHEAP: near-zero cost to build and to promote — no ad spend, distribution via Bob's YouTube/X/email list. AUTOMATIC delivery by agents. Give five ideas ranked by revenue per unit of effort.";
  const result = await tryWorkflowTemplate(prompt, {
    tenantId: 1, personaId: 2, conversationId: 621, canUseVideoTool: true,
  });
  assert.deepEqual(result, { matched: false });
});

test("a tool-limited turn refuses the explicit saved-video command before any side effects", async () => {
  const result = await tryWorkflowTemplate("produce_video from project-assets/the_meta_launch_script.txt", {
    tenantId: 1, personaId: 2, conversationId: 622, canUseVideoTool: false,
  });
  assert.equal(result.matched, true);
  assert.match(result.response || "", /not available/);
  assert.equal(result.toolsUsed, undefined);
});