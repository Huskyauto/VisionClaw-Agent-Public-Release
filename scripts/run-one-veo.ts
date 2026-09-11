import { generateOmniFlashClip, OmniFlashError } from "../server/video/gemini-omni-flash";
import * as fs from "node:fs";
import * as path from "node:path";

async function main() {
  const [,, model, outDir, ...rest] = process.argv;
  const prompt = rest.join(" ");
  if (!model || !outDir || !prompt) { console.error("usage: run-one-veo MODEL OUTDIR PROMPT..."); process.exit(2); }
  fs.mkdirSync(outDir, { recursive: true });
  const t0 = Date.now();
  try {
    const r = await generateOmniFlashClip({ prompt, durationSec: 8, aspectRatio: "16:9", outDir, modelOverride: model });
    const dest = path.join(outDir, `${model.replace(/[^a-z0-9._-]/gi,"_")}.mp4`);
    fs.renameSync(r.videoPath, dest);
    const size = fs.statSync(dest).size;
    console.log(JSON.stringify({ model, ok: true, file: dest, latencyMs: r.latencyMs, pollAttempts: r.pollAttempts, sizeBytes: size }));
  } catch (e: any) {
    const msg = e instanceof OmniFlashError ? e.message : String(e?.message || e);
    fs.writeFileSync(path.join(outDir, `${model.replace(/[^a-z0-9._-]/gi,"_")}.error.txt`), msg);
    console.log(JSON.stringify({ model, ok: false, err: msg.slice(0, 300), latencyMs: Date.now() - t0 }));
  }
}
main();
