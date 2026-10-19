import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { getFfmpegPath } from "../../server/lib/ffmpeg-paths";
import { mergeReportAudioChunks } from "../../server/lib/business-report-audio-merge";
import { validateReportMp3 } from "../../server/lib/business-report-audio-delivery";

test("separately encoded MP3 segments remux into one fully decodable recording", async () => {
  const fixture = spawnSync(getFfmpegPath(), ["-v", "error", "-f", "lavfi", "-i",
    "sine=frequency=440:duration=0.5", "-c:a", "libmp3lame", "-b:a", "128k", "-f", "mp3", "pipe:1"]);
  assert.equal(fixture.status, 0);
  const joined = await mergeReportAudioChunks([fixture.stdout, fixture.stdout, fixture.stdout]);
  assert.ok(joined.length > fixture.stdout.length * 2);
  await validateReportMp3(joined);
  await assert.rejects(() => mergeReportAudioChunks([]), /bounds/);
});
