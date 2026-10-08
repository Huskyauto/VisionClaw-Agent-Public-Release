import assert from "node:assert/strict";
import test from "node:test";
import { replayEvidenceErrors } from "../../scripts/lib/golden-path-replay-evidence";

test("golden-path cannot pass without a real grader result and archived review link", () => {
  const archive = { archive_view_url: "https://drive.google.com/file/d/demo/view" };
  assert.deepEqual(replayEvidenceErrors("video", { ok: true, metrics: { duration_sec: 11.7 } }, archive), []);
  assert.ok(replayEvidenceErrors("video", undefined, archive).some((x) => x.includes("grader")));
  assert.ok(replayEvidenceErrors("video", { ok: true }, archive).some((x) => x.includes("duration")));
  assert.ok(replayEvidenceErrors("video", { ok: false }, archive).some((x) => x.includes("grader")));
  assert.ok(replayEvidenceErrors("video", { ok: true, metrics: { duration_sec: 11.7 } }, { archive_error: "upload failed" }).some((x) => x.includes("archive")));
  assert.ok(replayEvidenceErrors("pdf", { ok: true, metrics: {} }, archive, 2).some((x) => x.includes("page")));
});