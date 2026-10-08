import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const app = fs.readFileSync(path.join(root, "client/src/App.tsx"), "utf8");
const sidebar = fs.readFileSync(path.join(root, "client/src/components/app-sidebar.tsx"), "utf8");
const page = fs.readFileSync(path.join(root, "client/src/pages/admin-human-ai-synergy-trial.tsx"), "utf8");

test("human-AI synergy trial is owner-only and feature gated", () => {
  assert.match(app, /HUMAN_AI_SYNERGY_TRIAL_ENABLED/);
  assert.match(app, /path="\/admin\/human-ai-synergy-trial"/);
  assert.match(sidebar, /HUMAN_AI_SYNERGY_TRIAL_ENABLED/);
  assert.match(sidebar, /human-ai-synergy-trial/);
});

test("trial discovery requires platform-owner authority and explicit opt-in", () => {
  assert.match(app, /tenant\?\.id === 1 && tenant\?\.isAdmin === true/);
  assert.match(sidebar, /tenant\?\.id === 1 && tenant\?\.isAdmin === true/);
  assert.match(app, /VITE_HUMAN_AI_SYNERGY_TRIAL_ENABLED === "1"/);
  assert.match(sidebar, /VITE_HUMAN_AI_SYNERGY_TRIAL_ENABLED === "1"/);
  assert.match(page, /Both.*must be set to 1/i);
});

test("trial page exposes bounded observational inputs and API wiring", () => {
  for (const label of ["Trial name", "Task label", "Participant alias", "Idempotency key", "Notes"]) {
    assert.match(page, new RegExp(label));
  }
  for (const condition of ["Human-alone", "AI-alone", "Human \\+ AI"]) {
    assert.match(page, new RegExp(condition));
  }
  for (const dimension of ["Outcome quality", "Time efficiency", "Error detection", "Adaptation"]) {
    assert.match(page, new RegExp(dimension));
  }
  assert.match(page, /\/api\/human-ai-synergy-trials/);
  assert.match(page, /observational/i);
  assert.match(page, /not IQ, hiring, or causal evidence/i);
  assert.match(page, /operator[- ]supplied/i);
  assert.match(page, /does not verify pseudonymity/i);
  assert.match(page, /pseudonymous/i);
  assert.match(page, /participant alias/i);
  assert.match(page, /no sensitive\/customer content/i);
  assert.match(page, /coverage/i);
  assert.match(page, /human lift/i);
  assert.match(page, /AI lift/i);
  assert.match(page, /conservative verdict/i);
});

test("trial page uses the canonical backend arm contract and bounded limits", () => {
  for (const condition of ["human_alone", "ai_alone", "human_ai"]) {
    assert.match(page, new RegExp(condition));
  }
  assert.match(page, /arms:/);
  assert.match(page, /measurements:/);
  assert.match(page, /maxLength=\{80\}/);
  assert.match(page, /maxLength=\{120\}/);
  assert.match(page, /maxLength=\{200\}/);
  assert.match(page, /security policy failure/i);
  assert.match(page, /result\.coverage/);
  assert.match(page, /result\.liftVsHuman/);
  assert.match(page, /result\.liftVsAi/);
  assert.match(page, /result\.scores/);
});

test("saved score cards render direct overall scores", () => {
  assert.match(page, /resultScores\[key\]/);
  assert.doesNotMatch(page, /resultScores\[key\]\?\.\[dimension\]/);
});