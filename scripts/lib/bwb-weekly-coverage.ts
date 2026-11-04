import { createHash } from "node:crypto";

interface DailySource { fileId: string; name: string; modifiedTime: string }
interface DailyTranscript { videoId: string; transcript: string }

/** Changing the selected uploads must invalidate both transcription and planning. */
export function weeklySourceKey(sources: DailySource[]): string {
  return "all-dailies-v1-" + createHash("sha256")
    .update(JSON.stringify(sources.map(s => [s.fileId, s.name, s.modifiedTime]).sort(
      (a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)),
    )))
    .digest("hex");
}

/** Render/delivery caches must not return a finished older partial-week MP4. */
export function weeklyVideoId(baseVideoId: string, sourceKey: string): string {
  return sourceKey ? `${baseVideoId}-src-${sourceKey.slice(-16)}` : baseVideoId;
}

/** Never silently ship a partial recap after an unreadable or missing upload. */
export function assertCompleteDriveTranscripts(sources: DailySource[], transcripts: DailyTranscript[]): void {
  const missing = sources.filter(s => !transcripts.some(
    t => t.videoId === s.fileId && typeof t.transcript === "string" && t.transcript.trim(),
  ));
  const expected = new Set(sources.map(s => s.fileId));
  const ids = transcripts.map(t => t.videoId);
  if (missing.length || ids.length !== expected.size || new Set(ids).size !== ids.length ||
      ids.some(id => !expected.has(id))) {
    throw new Error(
      `Incomplete weekly clip review: ${transcripts.length}/${sources.length} transcripts. ` +
      `Missing or empty: ${missing.map(s => s.name).join(", ") || "unexpected or duplicate clip identity"}. ` +
      "Every selected daily upload must be transcribed before planning; fix the failed clips and retry.",
    );
  }
}
