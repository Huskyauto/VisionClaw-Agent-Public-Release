import assert from "node:assert/strict";
import test from "node:test";
import { retainDiagnosticOutput } from "../../server/lib/maintenance-log-retention";

test("maintenance logs preserve both startup context and the final failure summary", () => {
  const head = "STARTUP-CONTEXT\n";
  const noisyMiddle = "render progress\n".repeat(1_000);
  const tail = [
    "[golden-path] INCIDENT-SUMMARY",
    "FAIL html_app_tip_calculator: grader failed",
    "REVIEW https://drive.google.com/file/d/example/view",
  ].join("\n");

  const retained = retainDiagnosticOutput(`${head}${noisyMiddle}${tail}`, 4_000);

  assert.ok(retained.length <= 4_000);
  assert.match(retained, /STARTUP-CONTEXT/);
  assert.match(retained, /FAIL html_app_tip_calculator/);
  assert.match(retained, /https:\/\/drive\.google\.com/);
  assert.match(retained, /middle omitted/);
});

test("maintenance logs remain unchanged when already within the limit", () => {
  const output = "short diagnostic";
  assert.equal(retainDiagnosticOutput(output, 4_000), output);
});