import test from "node:test";
import assert from "node:assert/strict";
import { extractDeliverablesFromTools } from "../../client/src/lib/chat-deliverables";

test("a successful Felix weekly recap launch renders an immediate video progress link", () => {
  const deliverables = extractDeliverablesFromTools([{
    name: "bwb_weekly_build",
    input: {},
    done: true,
    output: {
      ok: true,
      started: true,
      job_id: "vj_example_12345678",
      title: "Built With Bob — Weekly Recap",
      watch_progress_url: "/jobs",
    },
  }]);

  assert.deepEqual(deliverables, [{
    toolName: "bwb_weekly_build",
    kind: "video",
    title: "Built With Bob — Weekly Recap",
    watchUrl: "/jobs",
    downloadUrl: undefined,
    driveUrl: undefined,
    emailedTo: undefined,
  }]);
});