import assert from "node:assert/strict";
import test from "node:test";
import {
  getRevenueWorkspace,
  getRevenueWorkspaceIdea,
  getRevenueWorkspaceByProjectName,
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

test("exposes the Work Opportunity Radar source channels as five curated workstreams", () => {
  const radar = getRevenueWorkspaceByProjectName("VisionClaw Work Opportunity Radar");

  assert.ok(radar);
  assert.equal(radar.key, "work-opportunity-radar");
  assert.equal(radar.ideas.length, 5);
  assert.deepEqual(
    radar.ideas.map((idea) => idea.title),
    [
      "Local AI Trust and Lead-Loss Scan",
      "Government and Institutional Opportunities",
      "Manual-Work Signals in Job Postings",
      "Agency and Consultant Overflow",
      "Public Complaint and Review Patterns",
    ],
  );
  for (const idea of radar.ideas) {
    assert.equal(
      idea.briefPath,
      "data/money-opportunities/agent-originated/2026-09-21-work-opportunity-source-channels.md",
    );
  }
});