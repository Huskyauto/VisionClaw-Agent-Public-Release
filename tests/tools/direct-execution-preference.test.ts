import assert from "node:assert/strict";
import { test } from "node:test";
import { renderDirectExecutionPreference, isOptionalStartQuestion, shouldUseDirectExecutionPreference } from "../../server/lib/direct-execution-preference";
import { chatRequestPreferenceFields } from "../../shared/chat-request-preferences";
import { getIntakeInstruction } from "../../server/intake-interview";

const request = "Run a thorough system check across the app including all APIs and services, and give me a full report.";
const deferred = "I'd be happy to run a thorough system check. Before I dive in, would you like me to walk through a few quick questions first, or would you prefer I jump right in?";

test("Suggestions Off tells the agent to act on the original request without optional intake", () => {
  assert.deepEqual(chatRequestPreferenceFields(false), { preferDirectExecution: true });
  assert.deepEqual(chatRequestPreferenceFields(true), { preferDirectExecution: false, suggestQuestions: true });
  assert.equal(getIntakeInstruction([], request, { preferDirectExecution: true }), null);
  assert.match(getIntakeInstruction([], request, { preferDirectExecution: false }) || "", /intake interview protocol/i);
  assert.match(renderDirectExecutionPreference(true), /original request/i);
  assert.match(renderDirectExecutionPreference(true), /do not ask whether/i);
  assert.match(renderDirectExecutionPreference(true), /approval|consent/i);
  assert.equal(renderDirectExecutionPreference(false), "");
});

test("a preference question about starting a clear task is not a completed response", () => {
  assert.equal(isOptionalStartQuestion(request, deferred, 0), true);
  assert.equal(isOptionalStartQuestion(request, "Would you like me to get started?", 0), true);
  assert.equal(isOptionalStartQuestion(request, "Should I run the audit now?", 0), true);
  assert.equal(isOptionalStartQuestion(request, "Do you want me to run it now?", 0), true);
  assert.equal(isOptionalStartQuestion("Give me a full report on system health", deferred, 0), true);
  assert.equal(isOptionalStartQuestion("Provide a comprehensive report on all APIs", deferred, 0), true);
  assert.equal(isOptionalStartQuestion("Run a thorough system audit and send me a report", deferred, 0), true);
  assert.equal(isOptionalStartQuestion(request, deferred, 1), false);
});

test("blocking questions and approvals are not treated as optional deferral", () => {
  assert.equal(isOptionalStartQuestion(request, "Which API endpoint returns the 500 error?", 0), false);
  assert.equal(isOptionalStartQuestion("Send a payment to the vendor", "Please confirm the payment before I send it.", 0), false);
  assert.equal(isOptionalStartQuestion("Delete my account", "Should I run the account deletion now?", 0), false);
  assert.equal(isOptionalStartQuestion("Run a thorough system audit and send me a report", "Should I send it now?", 0), false);
  assert.equal(isOptionalStartQuestion("What is a system check?", deferred, 0), false);
});

test("an interview the user already opted into can continue even if Suggestions is now Off", () => {
  const prior = [
    { role: "user", content: request },
    { role: "assistant", content: "Would you like to walk through a few quick questions first?" },
  ];
  assert.match(getIntakeInstruction(prior, "Yes, let's do the questions", { preferDirectExecution: true }) || "", /interview — in progress/i);
  assert.equal(shouldUseDirectExecutionPreference(true, getIntakeInstruction(prior, "Yes, let's do the questions", { preferDirectExecution: true })), false);
  assert.equal(shouldUseDirectExecutionPreference(true, getIntakeInstruction([], request, { preferDirectExecution: true })), true);
});