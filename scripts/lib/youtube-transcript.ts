/**
 * YouTube transcript extraction — owner-clip workflow.
 *
 * Datacenter IPs get HTTP 429 on YouTube's *subtitle* endpoint, but the audio
 * media stream downloads fine. So we pull bestaudio via yt-dlp and transcribe
 * it with ElevenLabs Scribe (more accurate than auto-captions anyway). No paid
 * transcript API, no OAuth re-auth (youtube.force-ssl) required.
 *
 * yt-dlp is installed via `uv tool install yt-dlp` (binary in ~/.local/bin).
 * Set YTDLP_PATH to override the binary location.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { transcribeWords } from "../../server/video-editor";
import { sanitizeSpawnEnv } from "../../server/safety/spawn-env-guard";

export interface YouTubeTranscript {
  url: string;
  videoId: string;
  title: string;
  durationSeconds: number;
  transcript: string;
  language?: string;
}

const YTDLP_CANDIDATES = [
  process.env.YTDLP_PATH,
  path.join(os.homedir(), ".local/bin/yt-dlp"),
  "/home/runner/workspace/.local/bin/yt-dlp",
  "yt-dlp",
].filter(Boolean) as string[];

function resolveYtdlp(): string {
  for (const c of YTDLP_CANDIDATES) {
    if (c === "yt-dlp") return c; // rely on PATH as last resort
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return "yt-dlp";
}

const YTDLP = resolveYtdlp();

/** android_vr+web client combo is what got past the format-extraction wall from this IP. */
const EXTRACTOR_ARGS = "youtube:player_client=android_vr,web";

function runYtdlp(args: string[], timeoutMs = 120_000): { code: number; stdout: string; stderr: string } {
  const r = spawnSync(YTDLP, args, {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
    env: sanitizeSpawnEnv(process.env),
  });
  return { code: r.status ?? 1, stdout: r.stdout || "", stderr: r.stderr || "" };
}

/**
 * Download the audio for one YouTube URL and transcribe it.
 * Throws on failure so the caller can decide whether to skip or abort.
 */
export async function extractYouTubeTranscript(url: string): Promise<YouTubeTranscript> {
  if (!/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(url)) {
    throw new Error(`Not a YouTube URL: ${url}`);
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "bwb-yt-"));
  try {
    const outTmpl = path.join(workDir, "%(id)s.%(ext)s");
    const dl = runYtdlp([
      "-f",
      "bestaudio[ext=m4a]/bestaudio",
      "--extractor-args",
      EXTRACTOR_ARGS,
      "--no-playlist",
      "--write-info-json",
      "--no-warnings",
      "-o",
      outTmpl,
      url,
    ]);

    if (dl.code !== 0) {
      throw new Error(`yt-dlp audio download failed (${dl.code}): ${dl.stderr.trim().slice(-400)}`);
    }

    const files = fs.readdirSync(workDir);
    const infoFile = files.find((f) => f.endsWith(".info.json"));
    const audioFile = files.find((f) => !f.endsWith(".info.json"));
    if (!audioFile) throw new Error(`yt-dlp produced no audio file for ${url}`);

    let videoId = audioFile.replace(/\.[^.]+$/, "");
    let title = videoId;
    let durationSeconds = 0;
    if (infoFile) {
      try {
        const info = JSON.parse(fs.readFileSync(path.join(workDir, infoFile), "utf8"));
        videoId = info.id || videoId;
        title = info.title || title;
        durationSeconds = Number(info.duration) || 0;
      } catch {
        /* keep fallbacks */
      }
    }

    const audioPath = path.join(workDir, audioFile);
    const r = await transcribeWords(audioPath);
    if (!r.success) {
      throw new Error(`Scribe transcription failed for ${url}: ${(r as any).error || "unknown"}`);
    }

    const transcript = ((r as any).text || "").trim();
    if (!transcript) throw new Error(`Empty transcript for ${url}`);

    return {
      url,
      videoId,
      title,
      durationSeconds: durationSeconds || Number((r as any).durationSeconds) || 0,
      transcript,
      language: (r as any).language,
    };
  } finally {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

/**
 * Extract transcripts for many URLs. Serial (gentle on the source). One failure
 * does not abort the batch — it's collected in `failures` so the caller can
 * decide whether enough clips succeeded to proceed.
 */
export async function extractWeeklyTranscripts(
  urls: string[],
): Promise<{ transcripts: YouTubeTranscript[]; failures: { url: string; error: string }[] }> {
  const transcripts: YouTubeTranscript[] = [];
  const failures: { url: string; error: string }[] = [];
  for (const url of urls) {
    try {
      console.log(`[yt-transcript] extracting ${url} …`);
      const t = await extractYouTubeTranscript(url);
      console.log(`[yt-transcript]   ✓ "${t.title}" (${t.durationSeconds}s, ${t.transcript.length} chars)`);
      transcripts.push(t);
    } catch (e: any) {
      const error = e?.message || String(e);
      console.warn(`[yt-transcript]   ✗ ${url} — ${error}`);
      failures.push({ url, error });
    }
  }
  return { transcripts, failures };
}
