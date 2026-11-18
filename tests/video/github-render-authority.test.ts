import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { spawnSync } from "node:child_process";

test("farm forwards host tenant authority and refuses denied narration without trusting an old file", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "farm-authority-"));
  try {
    const bundle = path.join(dir, "fixture.cjs");
    await build({
      stdin: { contents: `
        import { renderOnGithubFarm } from ${JSON.stringify(path.resolve("scripts/lib/github-render-farm.ts"))};
        import fs from "node:fs";
        (async()=>{
        fs.mkdirSync("project-assets",{recursive:true});
        fs.writeFileSync("project-assets/fixture_scene_1.mp3","stale foreign narration");
        fs.writeFileSync("hero.png","existing image");
        const host={tenantId:42,actor:"system",invokedVia:"video-render",internalPurpose:"Render requested tenant video"};
        const opts={videoId:"fixture",scenes:[{narration:"My words",imagePath:"hero.png",_tenantId:1}],
          voice:"locked-voice",strictVoice:true,outMp4:"out.mp4",repoSpec:"fixture/private",
          skipDailyCap:true,sceneDir:"scenes",fail:(message)=>{throw new Error(message)},log:()=>{}};
        for(const authority of [undefined,{...host,tenantId:0},host]){
          globalThis.calls=[];
          try{await renderOnGithubFarm({...opts,toolAuthority:authority});throw new Error("unexpected success")}
          catch(e){console.log(JSON.stringify({error:e.message,calls:globalThis.calls}))}
        }
        })().catch(e=>{console.error(e);process.exitCode=1});
      `, resolveDir: process.cwd(), sourcefile: "farm-authority-fixture.ts", loader: "ts" },
      outfile: bundle, bundle: true, platform: "node", format: "cjs", logLevel: "silent",
      plugins: [{ name: "offline-tools", setup(b) {
        b.onResolve({ filter: /server\/tools$|replit_integrations\/image\/client$/ },
          a => ({ path: a.path, namespace: "offline-tools" }));
        b.onLoad({ filter: /.*/, namespace: "offline-tools" }, a => ({
          contents: a.path.endsWith("/tools") ? `
            export async function executeTool(name,params,authority){
              globalThis.calls.push({name,params,authority});
              return {blocked:true,error:"fixture policy denial"};
            }` : `export async function generateImage(){throw new Error("must reuse existing image")}`,
        }));
      } }],
    });
    const child = spawnSync(process.execPath, [bundle], {
      cwd: dir, timeout: 15000, encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: dir, GITHUB_TOKEN: "synthetic-offline-only" },
    });
    assert.equal(child.status, 0, child.stderr);
    const rows = child.stdout.split("\n").filter(x => x.startsWith("{")).map(x => JSON.parse(x));
    assert.equal(rows.length, 3, child.stdout);
    assert.equal(rows[0].calls.length, 0);
    assert.equal(rows[1].calls.length, 0);
    assert.match(rows[2].error, /Narration generation refused: fixture policy denial/);
    assert.equal(rows[2].calls.length, 1);
    assert.equal(rows[2].calls[0].authority.tenantId, 42);
    assert.equal(rows[2].calls[0].authority.actor, "system");
    assert.equal(rows[2].calls[0].params.strictVoice, true);
    assert.equal(rows[2].calls[0].name, "generate_audio");
    assert.equal(fs.existsSync(path.join(dir, "project-assets/fixture_scene_1.mp3.voice")), false);
    assert.equal(fs.existsSync(path.join(dir, "out.mp4")), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
