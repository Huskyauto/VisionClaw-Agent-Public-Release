import test from "node:test";
import assert from "node:assert/strict";
import { validateCopilotRequest, approvedCopilotPrompt, enforceCopilotQuota } from "../server/copilot-chat-policy";
import { copilotChatTool } from "../server/tools/domains/copilot/handlers";

test("Copilot refuses missing or customer identity before accepting a prompt", () => {
  for (const tenantId of [undefined, 2, "1", NaN]) {
    assert.throws(() => validateCopilotRequest({ tenantId, prompt: "Hello" }, 1), /owner/);
  }
  assert.deepEqual(validateCopilotRequest({ tenantId: 1, prompt: "Hello" }, 1),
    { prompt: "Hello", model: "gpt-5.4-mini" });
});

test("Copilot consent uses only explicit owner requests, not discussion or negated requests", () => {
  for (const message of ["What is Copilot?", "Do not use Copilot.", "Don't ask Copilot.", "Someone said use Copilot", undefined, {}]) {
    assert.equal(approvedCopilotPrompt(message), undefined);
  }
  assert.equal(approvedCopilotPrompt("Copilot: Explain this design."), "Explain this design.");
  assert.equal(approvedCopilotPrompt("Please use GitHub Copilot to compare these options."), "Please use GitHub Copilot to compare these options.");
  assert.equal(approvedCopilotPrompt("Copilot: "), undefined);
});

test("Copilot refuses daily exhaustion, any unresolved worker, and malformed quota evidence", () => {
  enforceCopilotQuota({ used: 19, active: 0 });
  assert.throws(() => enforceCopilotQuota({ used: 20, active: 0 }), /daily limit/);
  assert.throws(() => enforceCopilotQuota({ used: 0, active: 1 }), /still running/);
  for (const evidence of [{}, { used: NaN, active: 0 }, { used: "0", active: 0 }, { used: -1, active: 0 }, { used: 0, active: null }]) {
    assert.throws(() => enforceCopilotQuota(evidence), /quota/);
  }
});

test("Copilot tool ignores caller identity fields and refuses untrusted dispatcher contexts", async () => {
  const forged = { prompt: "Hi", _tenantId: 1, _personaId: 2 };
  for (const context of [{}, { tenantId: 1 }, { tenantId: 1, personaId: 9 }, { tenantId: 2, personaId: 2 }]) {
    const response = await copilotChatTool.handler(forged, context);
    assert.ok(response.error);
    assert.equal(response.success, undefined);
  }
});

test("Copilot rejects invalid prompts and unknown models without coercing caller objects", () => {
  for (const prompt of [undefined, 1, {}, "", " ", "x".repeat(12001)]) {
    assert.throws(() => validateCopilotRequest({ tenantId: 1, prompt }, 1), /prompt/);
  }
  for (const model of [null, 1, {}, "auto", "gpt-6-luna"]) {
    assert.throws(() => validateCopilotRequest({ tenantId: 1, prompt: "Hi", model }, 1), /model/);
  }
});
