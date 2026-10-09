import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectActionFirstModeCommand,
  renderActionFirstModeContext,
  preserveExplicitCommunicationMode,
} from "../../server/lib/action-first-mode";

test("explicit activation and deactivation phrases are recognized without fuzzy medical inference", () => {
  assert.equal(detectActionFirstModeCommand("Turn on action-first mode"), "action_first");
  assert.equal(detectActionFirstModeCommand("Switch to action-first mode"), "action_first");
  assert.equal(detectActionFirstModeCommand("Use action first mode"), "action_first");
  assert.equal(detectActionFirstModeCommand("Turn action-first mode on"), "action_first");
  assert.equal(detectActionFirstModeCommand("action first mode off"), "standard");
  assert.equal(detectActionFirstModeCommand("Switch to standard mode"), "standard");
  assert.equal(detectActionFirstModeCommand("Please disable action-first mode."), "standard");
  assert.equal(detectActionFirstModeCommand("I have ADHD"), null);
  assert.equal(detectActionFirstModeCommand("Could concise answers help people with ADHD?"), null);
  assert.equal(detectActionFirstModeCommand("This action-first article is interesting"), null);
});

test("action-first context preserves safety, completeness, autonomous execution, and explanations", () => {
  const context = renderActionFirstModeContext("action_first");
  assert.match(context, /lead with the answer/i);
  assert.match(context, /do the work yourself/i);
  assert.match(context, /safety/i);
  assert.match(context, /complete/i);
  assert.match(context, /explanation/i);
  assert.doesNotMatch(context, /ADHD/i);
  assert.equal(renderActionFirstModeContext("standard"), "");
});

test("model consolidation cannot overwrite an explicit communication mode", () => {
  assert.deepEqual(
    preserveExplicitCommunicationMode(
      { outputFormat: "bullets", communicationMode: "action_first" },
      { detailLevel: "medium", communicationMode: "standard" },
    ),
    { detailLevel: "medium", communicationMode: "action_first" },
  );
  assert.deepEqual(
    preserveExplicitCommunicationMode({ outputFormat: "bullets" }, { detailLevel: "medium" }),
    { detailLevel: "medium" },
  );
  assert.deepEqual(
    preserveExplicitCommunicationMode({}, { communicationMode: "action_first", detailLevel: "medium" }),
    { detailLevel: "medium" },
  );
});