/**
 * Tools-layer-split S24 seam guard (middleware extraction, phase 4: instant
 * play). Proves the instant-play layer was extracted from executeTool into
 * server/tools/middleware/instant-play.ts MECHANICALLY:
 *   - the module exists and exports attachInstantPlayUrls + isInstantPlayPathSafe,
 *   - executeTool imports + delegates to attachInstantPlayUrls, and re-exports
 *     isInstantPlayPathSafe (scripts/test-instant-play-gates.ts depends on that
 *     path via import("../server/tools")), and
 *   - executeTool no longer carries the inline instant-play consts/fns.
 *
 * Static-only: instant-play.ts imports only `path` (no db); the publisher +
 * tool-registry are pulled via call-time dynamic imports. The path-safety gate
 * is pure, so we exercise it directly. server/tools.ts is NEVER imported
 * (pg-pool hang). Contract: data/feature-contracts/tools-layer-split/spec.md
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { attachInstantPlayUrls, isInstantPlayPathSafe } from "../../server/tools/middleware/instant-play";

const toolsSrc = readFileSync(path.join(process.cwd(), "server/tools.ts"), "utf8");
const mwSrc = readFileSync(
  path.join(process.cwd(), "server/tools/middleware/instant-play.ts"),
  "utf8",
);

test("S24: instant-play middleware exports attachInstantPlayUrls + isInstantPlayPathSafe", () => {
  assert.equal(typeof attachInstantPlayUrls, "function");
  assert.equal(typeof isInstantPlayPathSafe, "function");
});

test("S24: executeTool imports+delegates and re-exports isInstantPlayPathSafe", () => {
  assert.ok(
    toolsSrc.includes('import { attachInstantPlayUrls } from "./tools/middleware/instant-play"'),
    "executeTool must import attachInstantPlayUrls",
  );
  assert.ok(
    toolsSrc.includes("attachInstantPlayUrls(name, finalResult, params)"),
    "executeTool must call attachInstantPlayUrls",
  );
  assert.ok(
    toolsSrc.includes('export { isInstantPlayPathSafe } from "./tools/middleware/instant-play"'),
    "tools.ts must re-export isInstantPlayPathSafe (scripts/test-instant-play-gates.ts depends on it)",
  );
});

test("S24: inline instant-play consts/fns no longer in tools.ts", () => {
  assert.ok(!toolsSrc.includes("function attachInstantPlayUrls"), "the fn definition must be gone from tools.ts");
  assert.ok(!toolsSrc.includes("MEDIA_EXT_RE"), "the media-ext regex must be gone from tools.ts");
  assert.ok(!toolsSrc.includes("INSTANT_PLAY_ALLOWED_ROOTS"), "the allowed-roots const must be gone from tools.ts");
});

test("S24: path-safety gate preserved (allow safe root, deny traversal + internal)", () => {
  assert.equal(isInstantPlayPathSafe("project-assets/video.mp4"), true);
  assert.equal(isInstantPlayPathSafe("project-assets/../server/secret.mp4"), false);
  assert.equal(isInstantPlayPathSafe("server/secret.mp4"), false);
  assert.equal(isInstantPlayPathSafe(".local/state.mp4"), false);
});

test("S24: instant-play module keeps acyclic call-time imports, no ./tools edge", () => {
  assert.ok(mwSrc.includes('await import("../../instant-play")'), "must dynamic-import the publisher at call time");
  assert.ok(mwSrc.includes('await import("../../tool-registry")'), "must dynamic-import tool-registry at call time");
  assert.ok(!/from ['"].*\/tools['"]/.test(mwSrc.replace(/tool-registry|instant-play/g, "")), "instant-play.ts must NOT static-import ./tools");
});
