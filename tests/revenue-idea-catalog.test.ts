import assert from "node:assert/strict";
import test from "node:test";
import {
  getRevenueWorkspace,
  getRevenueWorkspaceIdea,
} from "../server/lib/revenue-idea-catalog";

test("exposes five actionable ideas for each owner revenue workspace", () => {
  const launchpad = getRevenueWorkspace("customer-revenue-launchpad");
  const fable = getRevenueWorkspace("fable-5");

  assert.equal(launchpad.ideas.length, 5);
  assert.equal(fable.ideas.length, 5);
  assert.equal(launchpad.ownerOnly, true);
  assert.equal(fable.ownerOnly, true);
  assert.match(launchpad.ideas[0].starterPrompt, /manual|evidence|validate/i);
  assert.equal(fable.ideas[0].linkedProjectName, "Idea 1: HVAC Contractor Document Packs");
});

test("only resolves briefs belonging to the requested workspace", () => {
  assert.equal(
    getRevenueWorkspaceIdea("fable-5", "hvac-contractor-document-packs")?.briefPath,
    "project-assets/5-money-making-ideas/idea-1-hvac-document-packs/README.md"
  );
  assert.equal(getRevenueWorkspaceIdea("fable-5", "ai-visibility-trust-audit"), null);
});