/**
 * R99 — Felix Visual Continuity smoke tests.
 *
 * Focused unit coverage on the three new services that does NOT require a
 * live DB row or LLM credit:
 *   - portrait-registry input validation
 *   - best-image-selector single-candidate short-circuit + no-candidate guard
 *   - reference-selector empty-pool branch + buildPromptPrefix shape
 *
 * The full DB+LLM end-to-end is exercised by produce_video integration runs
 * in CI; this file is the deterministic safety net that runs every push.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Force LLM off for determinism + zero cost. Both services fall back to safe
// deterministic paths when there's no provider available.
process.env.NO_INTENT_GATE_LLM = "1";

after(() => { setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref(); });

// ---- best-image-selector --------------------------------------------------

test("selectBestImage: throws when given zero valid candidate paths", async () => {
  const { selectBestImage } = await import("../../server/video/best-image-selector");
  await assert.rejects(
    () => selectBestImage({ candidates: [], references: [], targetDescription: "x", tenantId: 1 }),
    /no valid candidate/i,
  );
});

test("selectBestImage: single-candidate short-circuits without LLM cost", async () => {
  // R99.1 +sec: must use a path inside project-assets so the new jail accepts
  // it — os.tmpdir() is (correctly) rejected.
  const dir = path.resolve(process.cwd(), "project-assets", "_r99_test");
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `r99_cand_${Date.now()}.png`);
  fs.writeFileSync(tmp, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  try {
    const { selectBestImage } = await import("../../server/video/best-image-selector");
    const res = await selectBestImage({
      candidates: [tmp],
      references: [],
      targetDescription: "test",
      tenantId: 1,
    });
    assert.equal(res.winnerIndex, 0);
    assert.equal(res.winnerPath, tmp);
    assert.equal(res.source, "first_fallback");
    assert.ok(res.scores.character_consistency >= 0 && res.scores.character_consistency <= 10);
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* swallow */ }
  }
});

test("selectBestImage: filters out non-existent candidate paths", async () => {
  const { selectBestImage } = await import("../../server/video/best-image-selector");
  await assert.rejects(
    () => selectBestImage({
      candidates: ["/nonexistent/a.png", "/nonexistent/b.png"],
      references: [],
      targetDescription: "test",
      tenantId: 1,
    }),
    /no valid candidate/i,
  );
});

// ---- portrait-registry ----------------------------------------------------

test("registerPortrait: rejects missing tenantId / identifier / view / file", async () => {
  const { registerPortrait } = await import("../../server/video/portrait-registry");
  await assert.rejects(
    () => registerPortrait({ tenantId: 0, identifier: "x", view: "front", imagePath: "/tmp/y.png" } as any),
    /tenantId required/,
  );
  await assert.rejects(
    () => registerPortrait({ tenantId: 1, identifier: "", view: "front", imagePath: "/tmp/y.png" }),
    /identifier required/,
  );
  await assert.rejects(
    () => registerPortrait({ tenantId: 1, identifier: "bob", view: "", imagePath: "/tmp/y.png" }),
    /view required/,
  );
  await assert.rejects(
    () => registerPortrait({ tenantId: 1, identifier: "bob", view: "front", imagePath: "" }),
    /imagePath required/,
  );
  // R99.1 +sec: path is jail-allowed (lives under project-assets) but the file
  // doesn't exist on disk, so we exercise the "does not exist" branch.
  await assert.rejects(
    () => registerPortrait({ tenantId: 1, identifier: "bob", view: "front", imagePath: path.resolve(process.cwd(), "project-assets", "_r99_test", "definitely_not_here.png") }),
    /does not exist/,
  );
  // And the jail itself: a path outside allowed roots is rejected before the
  // existence check, with a distinct error.
  await assert.rejects(
    () => registerPortrait({ tenantId: 1, identifier: "bob", view: "front", imagePath: "/etc/passwd" }),
    /outside allowed roots/,
  );
});

test("portrait-registry: hard caps exposed and sane", async () => {
  const mod = await import("../../server/video/portrait-registry");
  assert.equal(mod.PORTRAIT_VIEWS_MAX_PER_CALL, 4);
  assert.equal(mod.PORTRAIT_CHARACTERS_MAX_PER_CALL, 5);
  assert.ok(mod.PORTRAIT_VIEWS_DEFAULT.length >= 1 && mod.PORTRAIT_VIEWS_DEFAULT.length <= 4);
});

test("listPortraits: rejects missing tenantId", async () => {
  const { listPortraits } = await import("../../server/video/portrait-registry");
  await assert.rejects(() => listPortraits({ tenantId: 0 }), /tenantId required/);
});

// ---- reference-selector --------------------------------------------------

test("selectReferencesForFrame: empty pool returns source='none' and empty arrays", async () => {
  // Use a job id that cannot exist in the frame pool + a tenant id that has
  // no portraits in the dev DB. We expect the deterministic 'none' branch.
  const { selectReferencesForFrame } = await import("../../server/video/reference-selector");
  const res = await selectReferencesForFrame({
    tenantId: 999_999_999, // impossibly-high tenant id → no portraits
    jobId: `r99_test_${Date.now()}_no_such_job`,
    frameDescription: "irrelevant",
    maxReferences: 4,
  });
  assert.equal(res.source, "none");
  assert.deepEqual(res.indices, []);
  assert.deepEqual(res.imagePaths, []);
  assert.equal(res.promptPrefix, "");
});

test("logFrame: silently no-ops when tenantId is invalid (defense in depth)", async () => {
  const { logFrame } = await import("../../server/video/reference-selector");
  // Should not throw — invalid tenant id → silent skip.
  await logFrame({ tenantId: 0, jobId: "nope", frameIdx: 0, imagePath: "/tmp/x.png" });
  await logFrame({ tenantId: -1, jobId: "nope", frameIdx: 0, imagePath: "/tmp/x.png" });
});

// ---- mpeg-engine surface --------------------------------------------------

test("MpegScene type accepts qualityTier 'hero' | 'broll' (compile-time smoke)", async () => {
  // This is a pure import smoke — ensures the mpeg-engine module loads with
  // the R99 wiring intact (no syntax / circular-import regression).
  const mod = await import("../../server/mpeg-engine");
  assert.equal(typeof mod.produceVideo, "function");
});
