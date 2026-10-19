import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { getFfmpegPath } from "./ffmpeg-paths";
import { REPORT_AUDIO_MAX_BYTES } from "./business-report-audio";

/** Lossless container remux. Raw MP3 concatenation leaves embedded ID3/Xing
 * headers that strict decoders can reject despite every segment being valid. */
export async function mergeReportAudioChunks(parts: readonly Buffer[]): Promise<Buffer> {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  if (!parts.length || parts.length > 60 || parts.some(part => part.length < 1000) ||
      size > REPORT_AUDIO_MAX_BYTES) throw new Error("Report audio parts exceed assembly bounds");
  if (parts.length === 1) return parts[0];
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "report-audio-merge-"));
  try {
    for (let index = 0; index < parts.length; index++) {
      await fs.writeFile(path.join(directory, `part-${index}.mp3`), parts[index], { mode: 0o600 });
    }
    await fs.writeFile(path.join(directory, "parts.txt"),
      parts.map((_, index) => `file 'part-${index}.mp3'`).join("\n"), { mode: 0o600 });
    await new Promise<void>((resolve, reject) => {
      const child = spawn(getFfmpegPath(), ["-hide_banner", "-nostdin", "-v", "error", "-xerror",
        "-protocol_whitelist", "file,pipe", "-f", "concat", "-safe", "1", "-i", "parts.txt",
        "-map", "0:a:0", "-c:a", "copy", "-f", "mp3", "joined.mp3"],
      { cwd: directory, stdio: ["ignore", "ignore", "pipe"] });
      let errorOutput = "";
      const timer = setTimeout(() => child.kill("SIGKILL"), 90_000);
      child.stderr.on("data", data => { errorOutput = (errorOutput + data).slice(0, 2048); });
      child.on("error", () => { clearTimeout(timer); reject(new Error("Report audio assembler unavailable")); });
      child.on("close", code => {
        clearTimeout(timer);
        if (code !== 0 || errorOutput.trim()) reject(new Error("Lossless report audio assembly failed"));
        else resolve();
      });
    });
    const output = path.join(directory, "joined.mp3");
    const stat = await fs.stat(output);
    if (stat.size < 1000 || stat.size > REPORT_AUDIO_MAX_BYTES) throw new Error("Joined report MP3 exceeds its bounds");
    return await fs.readFile(output);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
