import { test } from "node:test";
import assert from "node:assert/strict";
import { renderFailureReason } from "../../scripts/lib/bwb-render-failure";

test("renderFailureReason prefers a delivery failure over a later success-sidecar log", () => {
  const output = [
    "[gh-render] delivery failed for #43; refusing to report render success",
    "[gh-render] wrote result sidecar: data/youtube/scripts/weekly-2026-08-29.result.json",
  ].join("\n");

  assert.equal(
    renderFailureReason(output),
    "[gh-render] delivery failed for #43; refusing to report render success",
  );
});