import assert from "node:assert/strict";
import test from "node:test";

import { detectIncompleteOutcome } from "../../server/chat-response-validation";

test("an attachment review cannot finish with a promise to read the uploaded files", () => {
  const userMessage = "Please review all seven uploaded files and give me a comprehensive report.";
  const screenshots = [
    "I'll start by reviewing the files you've uploaded. Let me check what's available and read through them.",
    "Let me read all the uploaded files and produce your report.",
    "Let me now review all the files you've uploaded and create a comprehensive report.",
  ];

  for (const response of screenshots) {
    const result = detectIncompleteOutcome(userMessage, response, [], { attachmentCount: 7 });
    assert.ok(result, `expected attachment deferral to be incomplete: ${response}`);
    assert.match(result.reason, /attached files/i);
  }
});

test("attachment completion validation permits a delivered analysis and unrelated turns", () => {
  const delivered = detectIncompleteOutcome(
    "Review the attached articles and give me your opinion.",
    "The articles support thermoelectric harvesting for low-power sensing, but not continuous smartwatch charging. The strongest next step is a bounded prototype.",
    [],
    { attachmentCount: 7 },
  );
  assert.equal(delivered, null);

  const unrelated = detectIncompleteOutcome(
    "Review this product strategy.",
    "Let me review the available options.",
    [],
    { attachmentCount: 7 },
  );
  assert.equal(unrelated, null);
});

test("a substantive attachment analysis is not retried even if it mentions reviewing", () => {
  const result = detectIncompleteOutcome(
    "Review the uploaded articles and give me a comprehensive report.",
    "I'll now review the practical implications. Thermoelectric harvesting can support intermittent sensing, but it does not support continuous smartwatch charging under the described conditions. A bounded prototype should measure net energy after conversion losses before selecting the lowest-power sensor path.",
    [],
    { attachmentCount: 7, currentAttachmentCount: 7 },
  );
  assert.equal(result, null);
});

test("promise-only filler cannot bypass recovery by mentioning next steps", () => {
  const result = detectIncompleteOutcome(
    "Review the uploaded articles and give me a comprehensive report.",
    "I have organized the material and identified the next steps for the project. Let me now read the uploaded files and prepare the comprehensive report.",
    [],
    { attachmentCount: 7, currentAttachmentCount: 7 },
  );
  assert.ok(result);
});

test("the final promise clause controls completion even after earlier analysis", () => {
  const result = detectIncompleteOutcome(
    "Review the uploaded articles and give me a comprehensive report.",
    "I'll review the practical case first. Thermoelectric harvesting may support intermittent sensing, while continuous charging remains unsupported under the described conversion losses and wearable temperature gradient. The prototype should measure net energy at the regulator output. I'll check the remaining uploaded files before completing the report.",
    [],
    { attachmentCount: 7, currentAttachmentCount: 7 },
  );
  assert.ok(result);
});

test("old attachments do not hijack a later request about repository files", () => {
  const result = detectIncompleteOutcome(
    "Review the files in this repository and tell me which module is too large.",
    "Let me review the files before I answer.",
    [],
    { attachmentCount: 7, currentAttachmentCount: 0 },
  );
  assert.equal(result, null);
});

test("common attachment deferral wording is detected", () => {
  for (const response of [
    "I need to read the uploaded articles first.",
    "I’ll open the attached documents and then report back.",
    "I'll start by carefully analyzing the uploaded files.",
  ]) {
    const result = detectIncompleteOutcome(
      "Please analyze the uploaded files and give me a report.",
      response,
      [],
      { attachmentCount: 7, currentAttachmentCount: 7 },
    );
    assert.ok(result, `expected deferral to be detected: ${response}`);
  }
});

test("raw DSML tool markup cannot disguise an attachment-review deferral as a completed answer", () => {
  const response = `You're right — I've been stopping instead of actually completing the review. Let me do it now, end to end, with no more pauses.

First, let me read every uploaded file.<｜DSML｜tool_calls>
<｜DSML｜invoke name="exec_command">
<｜DSML｜parameter name="cmd" string="true">ls -la /home/runner/workspace/uploads/</｜DSML｜parameter>
</｜DSML｜invoke>
</｜DSML｜tool_calls>`;

  const result = detectIncompleteOutcome(
    "Please review these uploaded files and give me your assessment.",
    response,
    [],
    { attachmentCount: 8, currentAttachmentCount: 8 },
  );

  assert.ok(result);
  assert.match(result.reason, /attached files/i);
});

test("a repeated promise remains incomplete and must not become an accepted recovery answer", () => {
  const userMessage = "Review all uploaded files and deliver your final report.";
  const first = detectIncompleteOutcome(
    userMessage,
    "Let me read every uploaded file before I answer.",
    [],
    { attachmentCount: 8, currentAttachmentCount: 8 },
  );
  const second = detectIncompleteOutcome(
    userMessage,
    "I still need to open the attached documents, then I will provide the report.",
    [],
    { attachmentCount: 8, currentAttachmentCount: 8 },
  );

  assert.ok(first);
  assert.ok(second);
});

test("attachment review detection covers PDFs, spreadsheets, critique, and plain-language inspection requests", () => {
  for (const userMessage of [
    "Critique the attached PDFs.",
    "Go through these uploaded spreadsheets and flag the risks.",
    "Tell me what the uploads contain.",
  ]) {
    const result = detectIncompleteOutcome(
      userMessage,
      "Let me open the uploaded files and review them first.",
      [],
      { attachmentCount: 3, currentAttachmentCount: 3 },
    );
    assert.ok(result, `expected attachment completion guard for: ${userMessage}`);
  }
});

test("present-progress wording is still an incomplete attachment review", () => {
  for (const response of [
    "I'm reviewing the uploaded PDFs now; I'll send the findings shortly.",
    "I am reading the attachments now.",
    "I'm reviewing the uploaded files.",
    "I am reading the attachments.",
    "I'm analyzing the PDFs and will provide my findings.",
  ]) {
    const result = detectIncompleteOutcome(
      "Critique the attached PDFs and deliver the findings.",
      response,
      [],
      { attachmentCount: 2, currentAttachmentCount: 2 },
    );
    assert.ok(result, `expected in-progress promise to be incomplete: ${response}`);
  }
});
