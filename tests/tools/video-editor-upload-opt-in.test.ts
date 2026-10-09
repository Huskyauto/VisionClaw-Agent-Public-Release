import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const handlers = readFileSync(
  "server/tools/domains/video-editor/handlers.ts",
  "utf8",
);
const definitions = readFileSync(
  "server/tools/domains/video-editor/definitions.ts",
  "utf8",
);

test("video editor external uploads require explicit opt-in", () => {
  assert.equal(
    (handlers.match(/params\.uploadToDrive === true/g) || []).length,
    2,
  );
  assert.doesNotMatch(handlers, /params\.uploadToDrive !== false/);
  assert.equal(
    (definitions.match(/Default false\./g) || []).length,
    2,
  );
});