import test from "node:test";
import assert from "node:assert/strict";
import { responseModelIdentity } from "../../server/lib/jury-evidence";
import { extractAssistantResponseModel } from "../../server/claude-runner";

test("an adapter's request echo is never an actual response identity", () => {
  assert.equal(responseModelIdentity({ model: "claude-runner/claude-opus-5" }), undefined);
  assert.equal(responseModelIdentity({ model: "" }), undefined);
  assert.equal(responseModelIdentity({ model: "gpt-5.4-2026-09-01" }), "gpt-5.4-2026-09-01");
});

test("Claude identity comes only from its native assistant response, not requested model", () => {
  assert.equal(extractAssistantResponseModel({ type: "assistant", message: { model: "claude-opus-5-20260901" } }), "claude-opus-5-20260901");
  assert.equal(extractAssistantResponseModel({ type: "result", model: "claude-opus-5" }), undefined);
  assert.equal(extractAssistantResponseModel({ type: "assistant", message: {} }), undefined);
});
