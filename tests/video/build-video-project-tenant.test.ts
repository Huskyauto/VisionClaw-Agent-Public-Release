import assert from "node:assert/strict";
import test from "node:test";
import { verifyVideoProjectOwnership } from "../../server/build-video-from-brief";

test("a foreign project is refused before a video render can start", async () => {
  const result = await verifyVideoProjectOwnership(
    { tenantId: 7, projectId: 42 },
    async () => false,
  );

  assert.deepEqual(result, {
    success: false,
    message: "Project #42 is not available to this tenant.",
    error: "project_not_found",
  });
});