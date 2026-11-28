import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";
import { stageCapabilities, CAPABILITY_ASSET } from "../../server/daily-ai-insights/capabilities";

test("the real bundled capability reader works with dist alone and rejects altered or missing assets", async () => {
  const root = await mkdtemp(join(tmpdir(), "daily-capability-layout-"));
  try {
    const snapshot = await stageCapabilities(process.cwd(), join(root, "dist"));
    const asset = join(root, "dist", CAPABILITY_ASSET);
    const bundle = join(root, "dist", "reader.cjs");
    await build({ entryPoints: [resolve("server/daily-ai-insights/capabilities.ts")],
      bundle: true, platform: "node", format: "cjs", outfile: bundle, logLevel: "silent" });
    const invoke = () => spawnSync(process.execPath, ["-e",
      `require(${JSON.stringify(bundle)}).readCapabilities().then(x=>console.log(JSON.stringify(x))).catch(()=>process.exit(1))`],
    { cwd: root, env: { NODE_ENV: "production", PATH: process.env.PATH }, encoding: "utf8", timeout: 5000 });
    await assert.rejects(access(join(root, "server")), "No source directory is shipped in this layout");
    const result = invoke();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), snapshot.entries);
    snapshot.entries[0].text += "\nAltered after build.";
    await writeFile(asset, JSON.stringify(snapshot));
    assert.notEqual(invoke().status, 0, "Tampered excerpt must fail closed");
    await rm(asset);
    assert.notEqual(invoke().status, 0, "Missing production asset must not fall back to source");
  } finally { await rm(root, { recursive: true, force: true }); }
});
