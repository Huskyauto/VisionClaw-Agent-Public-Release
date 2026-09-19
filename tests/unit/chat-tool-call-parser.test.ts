import assert from "node:assert/strict";
import test from "node:test";

import {
  createToolMarkupStreamFilter,
  parseXmlToolCalls,
  stripXmlToolCallMarkup,
} from "../../server/chat-tool-call-parser";

test("DeepSeek DSML tool_calls markup is recovered as a structured tool call", () => {
  const productionResponse = `First, let me read every uploaded file.<｜DSML｜tool_calls>
<｜DSML｜invoke name="exec_command">
<｜DSML｜parameter name="cmd" string="true">ls -la /home/runner/workspace/uploads/2>/dev/null</｜DSML｜parameter>
<｜DSML｜parameter name="justification" string="true">Locate uploaded files</｜DSML｜parameter>
</｜DSML｜invoke>
</｜DSML｜tool_calls>`;

  const parsed = parseXmlToolCalls(productionResponse);

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].function.name, "exec_command");
  assert.deepEqual(JSON.parse(parsed[0].function.arguments), {
    cmd: "ls -la /home/runner/workspace/uploads/2>/dev/null",
    justification: "Locate uploaded files",
  });
  assert.equal(stripXmlToolCallMarkup(productionResponse), "First, let me read every uploaded file.");
});

test("stream filter withholds full-width DSML markup even when every boundary is split", () => {
  const filter = createToolMarkupStreamFilter();
  const chunks = [
    "I will inspect the files.",
    "<｜DS",
    "ML｜tool_",
    "calls><｜DSML｜invoke name=\"exec_command\">",
    "<｜DSML｜parameter name=\"cmd\">ls uploads</｜DSML｜parameter>",
    "</｜DSML｜invoke></｜DSML｜tool_calls>",
  ];
  const streamed = chunks.map((chunk) => filter.push(chunk)).join("") + filter.flush();

  assert.equal(streamed, "I will inspect the files.");
  assert.equal(filter.sawToolMarkup, true);
});

test("stream filter preserves ordinary text byte-for-byte", () => {
  const filter = createToolMarkupStreamFilter();
  const text = "A normal response with no structured tool markup.";
  const streamed = filter.push(text.slice(0, 7))
    + filter.push(text.slice(7, 19))
    + filter.push(text.slice(19))
    + filter.flush();

  assert.equal(streamed, text);
  assert.equal(filter.sawToolMarkup, false);
});