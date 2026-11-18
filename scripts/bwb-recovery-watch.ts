/**
 * Backfill a previously started BWB run. Future canonical stages use awaited
 * checkpoints; this finite companion cannot retroactively gate old code.
 * npx tsx scripts/bwb-recovery-watch.ts VIDEO_ID [--follow]
 */
import fs from "node:fs";
import { createBwbRecovery } from "./lib/bwb-drive-recovery";

async function main() {
  const videoId = process.argv[2];
  const recovery = createBwbRecovery(videoId);
  const scriptPath = `data/youtube/scripts/${videoId}.json`;
  const script = JSON.parse(fs.readFileSync(scriptPath, "utf8"));
  if (script.videoId !== videoId || !Array.isArray(script.scenes)) throw new Error("Recovery script identity mismatch");
  await recovery.file(scriptPath);
  const retainedPath = "generated-artifacts/bwb-recovery/retained-checkpoints.json";
  if (fs.existsSync(retainedPath)) {
    const retained = JSON.parse(fs.readFileSync(retainedPath, "utf8"));
    if (retained.find((r: any) => r.stage === "planning")?.artifact?.videoId === videoId) {
      await recovery.json("retained-checkpoints.json", retained);
    }
  }
  const paths = new Set<string>([scriptPath]);
  script.scenes.forEach((scene: { imagePath?: string }, i: number) => {
    if (scene.imagePath) paths.add(scene.imagePath);
    const image = `data/youtube/scenes/${videoId}/scene-${i + 1}.png`;
    paths.add(image); paths.add(`${image}.prompt`);
    for (const ext of ["mp3", "wav"]) {
      const audio = `project-assets/${videoId}_scene_${i + 1}.${ext}`;
      paths.add(audio); paths.add(`${audio}.voice`);
    }
  });
  paths.add(`data/youtube/${videoId}-github-render.mp4`);
  paths.add(`data/youtube/${videoId}-thumbnail.png`);
  const resultPath = `data/youtube/scripts/${videoId}.result.json`;
  paths.add(resultPath);
  const saved = new Map<string, string>();
  const deadline = Date.now() + 60 * 60_000;
  do {
    const final = fs.existsSync(resultPath);
    for (const file of paths) {
      if (!fs.existsSync(file)) continue;
      const stat = fs.statSync(file);
      const version = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
      if (final || saved.get(file) !== version) {
        await recovery.file(file);
        saved.set(file, version);
      }
    }
    if (final || !process.argv.includes("--follow")) return;
    await new Promise(resolve => setTimeout(resolve, 15_000));
  } while (Date.now() < deadline);
  throw new Error("Recovery companion timed out; existing verified Drive copies remain intact");
}
main().then(() => process.exit(0)).catch(error => {
  console.error(`[bwb-recovery] STOPPED: ${error.message}`);
  process.exit(1);
});
