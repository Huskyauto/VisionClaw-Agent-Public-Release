/**
 * Built With Bob — weekly clip discovery from Bob's Google Drive folder.
 *
 * Bob drops his daily selfie Shorts into a single Drive folder every day. This
 * module enumerates that folder and keeps only the recent SHORT-FORM dailies:
 *   - windowed by the date ENCODED IN THE FILENAME (Bob sometimes bulk-uploads,
 *     so Drive's modifiedTime is unreliable; we fall back to modifiedTime only
 *     when no date is parseable from the name),
 *   - a duration ceiling + a title guard drop the weekly long-form productions
 *     so the synthesizer never eats its own output (no feedback loop),
 *   - near-duplicate names ("Copy of …", numeric prefixes) are de-duped.
 * It then downloads each clip, extracts the audio, and transcribes it via
 * ElevenLabs Scribe — returning the SAME shape as the YouTube discovery path so
 * the weekly builder is source-agnostic.
 *
 * Drive access uses the configured google-drive connection (driveRequest →
 * getAccessToken), so it works headless with no token plumbing.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { driveJson, driveRequest } from "../../server/google-drive";
import { transcribeWords } from "../../server/video-editor";
import { sanitizeSpawnEnv } from "../../server/safety/spawn-env-guard";
import type { YouTubeTranscript } from "./youtube-transcript";

/** Drive file IDs are URL-safe base64-ish; reject anything else (path/URL-injection guard). */
const SAFE_DRIVE_ID = /^[A-Za-z0-9_-]+$/;

/** Bob's daily-Shorts drop folder. Override with BWB_DRIVE_FOLDER_ID. */
export const BWB_DRIVE_FOLDER_ID = "1kIrovQKB1ag9Ks5XQFf6axWR2V1soMMI";

// Drop the weekly long-form productions + non-clip assets so the weekly
// synthesizer never feeds on its own output (no feedback loop).
const DEFAULT_EXCLUDE =
  /(built[_\s]*with[_\s]*bob__|beyond[_\s]*wellness-program|week of|weekly|recap|channel[_\s]*intro|_script)/i;

export interface DiscoveredDriveClip {
  fileId: string;
  name: string;
  modifiedTime: string;
  clipDate: string | null; // ISO (YYYY-MM-DD) parsed from the filename, or null
  slot: "morning" | "evening" | null; // time-of-day talk parsed from the filename, or null
  durationSeconds: number; // from Drive metadata if known, else 0
}

export interface DriveDiscoverOptions {
  folderId?: string;
  /** @deprecated No longer used — the default window is always a Sun–Sat week, not a trailing day count. */
  days?: number;
  /**
   * Pin discovery to a LITERAL week. When BOTH are supplied (or BWB_WEEK_START /
   * BWB_WEEK_END env), only clips whose FILENAME date falls inside
   * [weekStart 00:00 … weekEnd 23:59] are kept — the default Sun–Sat week is ignored.
   * This is what makes "recap May 23–30" actually mean May 23–30. YYYY-MM-DD.
   */
  weekStart?: string;
  weekEnd?: string;
  /**
   * Anchor date for the default Sun–Sat week (env BWB_WEEK_ANCHOR). When set, the
   * recap covers the Sunday→Saturday week CONTAINING this date. When omitted, the
   * recap covers the JUST-COMPLETED week (the prior Sun–Sat). Ignored when an
   * explicit weekStart/weekEnd range is supplied. YYYY-MM-DD.
   */
  anchorDate?: string;
  /** Duration ceiling in seconds — known-longer clips are treated as the weekly long-form and excluded (default 120). */
  maxDurationSec?: number;
  /** Regex that, when it matches a filename, excludes the file (default: weekly-production names). */
  excludeTitlePattern?: RegExp;
  /**
   * Include clips that have NO parseable date in their filename by falling back
   * to Drive's modifiedTime (default false — modifiedTime is unreliable because
   * Bob bulk-uploads/re-touches old clips, which leaks last-week footage into
   * "this week"). Env override: BWB_ALLOW_UNDATED=1. NOTE: the weekly builder
   * passes allowUndated:false explicitly so the modifiedTime fallback can never
   * leak re-touched old clips into the recap (the original stale-footage bug).
   */
  allowUndated?: boolean;
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** Build a calendar date, rejecting impossible values + JS month/day rollover. */
function buildDate(year: number, month1: number, day: number): Date | null {
  if (month1 < 1 || month1 > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month1 - 1, day);
  // Reject rollover artifacts (e.g. month 25 → next year) by round-tripping.
  if (d.getFullYear() !== year || d.getMonth() !== month1 - 1 || d.getDate() !== day) return null;
  return d;
}

/**
 * Parse a clip date out of a filename. Handles ISO "2026-05-30", US "5-30-26" /
 * "5/30/2026", and month-name "May 30 2026" / "May-23-26". Boundary-guarded so
 * an embedded run of digits can't be mis-sliced, and rollover dates are rejected.
 * Returns null if no valid date is found.
 */
export function parseClipDate(name: string): Date | null {
  // ISO YYYY-MM-DD FIRST — otherwise the US M-D-YY pattern below would grab
  // "26-05-30" out of "2026-05-30" and build the wrong date.
  const iso = name.match(/(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/);
  if (iso) {
    const d = buildDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (d) return d;
  }
  // Compact ISO YYYYMMDD, optionally followed by a _HHMMSS time (the raw
  // phone-camera default, e.g. "20260603_153712_75444064.mp4"). Delimited by
  // NON-ALPHANUMERICS so an 8-digit run embedded in a word ("v20260530clip")
  // is never mis-parsed; buildDate rejects the trailing random numeric blocks
  // (e.g. "75444064" → month 40). First valid calendar date wins (the real
  // date always precedes the random suffix in these filenames).
  for (const m of name.matchAll(/(?<![A-Za-z0-9])(\d{8})(?![A-Za-z0-9])/g)) {
    const ds = m[1];
    const d = buildDate(Number(ds.slice(0, 4)), Number(ds.slice(4, 6)), Number(ds.slice(6, 8)));
    if (d) return d;
  }
  // US M-D-YY or M-D-YYYY (Bob's daily-clip convention), boundary-guarded.
  const num = name.match(/(?<!\d)(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})(?!\d)/);
  if (num) {
    let year = Number(num[3]);
    if (year < 100) year += 2000;
    const d = buildDate(year, Number(num[1]), Number(num[2]));
    if (d) return d;
  }
  // Month-name D, YYYY  /  Month-D-YY. Word-bounded with real month-name
  // completions so "junk"→"jun", "marathon"→"mar" etc. can't false-match.
  const mon = name.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b[\s,-]+(\d{1,2})(?:st|nd|rd|th)?[\s,-]+(\d{2,4})/i,
  );
  if (mon) {
    const m = MONTHS[mon[1].slice(0, 3).toLowerCase()];
    let year = Number(mon[3]);
    if (year < 100) year += 2000;
    const d = buildDate(year, m + 1, Number(mon[2]));
    if (d) return d;
  }
  return null;
}

/**
 * Detect the time-of-day "talk" from a filename so morning + evening clips on
 * the SAME calendar day are first-class and never collapsed into one. Bob films
 * a morning and an evening clip most days; the recap must hear both.
 */
export function detectSlot(name: string): "morning" | "evening" | null {
  const s = name.toLowerCase();
  if (/\b(morning|sunrise|wake[\s-]*up|breakfast|a\.?m\.?)\b/.test(s)) return "morning";
  if (/\b(evening|night|bedtime|sunset|dinner|p\.?m\.?)\b/.test(s)) return "evening";
  // Raw phone-camera compact name "YYYYMMDD_HHMMSS" with no explicit slot word —
  // derive the slot from the capture hour (before noon = morning, else evening).
  const t = s.match(/(?<![a-z0-9])\d{8}[_-](\d{2})[0-5]\d[0-5]\d(?![0-9])/);
  if (t) {
    const hour = Number(t[1]);
    if (hour >= 0 && hour <= 23) return hour < 12 ? "morning" : "evening";
  }
  return null;
}

/** Normalize a filename for dedup: strip ext, "Copy of", leading numeric prefix. */
function normName(name: string): string {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/^\s*copy of\s+/i, "")
    .replace(/^\d+-/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Resolve the recap's date window. Two modes:
 *   - EXPLICIT: both weekStartRaw+weekEndRaw → that literal [start 00:00 … end 23:59].
 *   - SUN–SAT (default): Sunday→Saturday week. With anchorRaw, the week CONTAINING
 *     it; without, the JUST-COMPLETED week (prior Sun–Sat) relative to `now`.
 * Pure/deterministic (inject `now` in tests). Throws on invalid/partial/inverted input.
 */
export function computeWeekWindow(args: {
  weekStartRaw?: string;
  weekEndRaw?: string;
  anchorRaw?: string;
  now?: Date;
}): { cutoff: number; upperBound: number; windowDesc: string } {
  const { weekStartRaw, weekEndRaw, anchorRaw } = args;
  const isoDay = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  if (weekStartRaw && weekEndRaw) {
    const ws = parseClipDate(weekStartRaw);
    const we = parseClipDate(weekEndRaw);
    if (!ws || !we) {
      throw new Error(
        `[drive-discover] invalid explicit week range — weekStart="${weekStartRaw}" weekEnd="${weekEndRaw}"; both must be a parseable date (YYYY-MM-DD).`,
      );
    }
    if (we.getTime() < ws.getTime()) {
      throw new Error(`[drive-discover] explicit week range is inverted — weekEnd (${weekEndRaw}) is before weekStart (${weekStartRaw}).`);
    }
    ws.setHours(0, 0, 0, 0);
    we.setHours(23, 59, 59, 999);
    return { cutoff: ws.getTime(), upperBound: we.getTime(), windowDesc: `explicit week ${weekStartRaw} → ${weekEndRaw}` };
  }
  if (weekStartRaw || weekEndRaw) {
    throw new Error(
      `[drive-discover] partial week range — set BOTH weekStart/weekEnd (BWB_WEEK_START + BWB_WEEK_END), got start="${weekStartRaw || ""}" end="${weekEndRaw || ""}".`,
    );
  }
  // Default: Sunday→Saturday week.
  const anchor = anchorRaw ? parseClipDate(anchorRaw) : new Date(args.now ?? Date.now());
  if (!anchor) {
    throw new Error(`[drive-discover] invalid anchorDate/BWB_WEEK_ANCHOR="${anchorRaw}" — must be a parseable date (YYYY-MM-DD).`);
  }
  // Snap to the Sunday of the week CONTAINING the anchor. getDay(): 0=Sun…6=Sat,
  // so subtracting getDay() lands on that week's Sunday.
  anchor.setHours(0, 0, 0, 0);
  const sunday = new Date(anchor);
  sunday.setDate(anchor.getDate() - anchor.getDay());
  // With no explicit anchor, the autonomous run recaps the JUST-COMPLETED week
  // (today's week isn't over yet) — step back one full week to the prior Sunday.
  if (!anchorRaw) sunday.setDate(sunday.getDate() - 7);
  const saturday = new Date(sunday);
  saturday.setDate(sunday.getDate() + 6);
  const startDate = new Date(sunday);
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(saturday);
  endDate.setHours(23, 59, 59, 999);
  return {
    cutoff: startDate.getTime(),
    upperBound: endDate.getTime(),
    windowDesc:
      `Sun–Sat week ${isoDay(startDate)} → ${isoDay(saturday)} ` +
      (anchorRaw ? `(anchor ${anchorRaw})` : "(last completed week)"),
  };
}

/** Discover this week's short-form dailies from the Drive folder. Newest-first. */
export async function discoverWeeklyDriveClips(opts: DriveDiscoverOptions = {}): Promise<DiscoveredDriveClip[]> {
  const folderId = opts.folderId || process.env.BWB_DRIVE_FOLDER_ID || BWB_DRIVE_FOLDER_ID;
  const maxDurationSec = (opts.maxDurationSec ?? Number(process.env.BWB_MAX_SHORT_SEC)) || 120;
  const exclude = opts.excludeTitlePattern ?? DEFAULT_EXCLUDE;

  const q = `'${folderId}' in parents and trashed=false`;
  const fields = "nextPageToken,files(id,name,mimeType,modifiedTime,videoMediaMetadata)";
  const base =
    `/drive/v3/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(fields)}` +
    `&pageSize=200&orderBy=modifiedTime%20desc&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  // Paginate — Bob's archive folder can hold >200 files, and the daily clips we
  // want may sit past the first page once the archive grows.
  const files: any[] = [];
  let pageToken = "";
  for (let page = 0; page < 25; page++) {
    const ep = pageToken ? `${base}&pageToken=${encodeURIComponent(pageToken)}` : base;
    const data = await driveJson(ep);
    files.push(...(data.files || []));
    pageToken = data.nextPageToken || "";
    if (!pageToken) break;
  }
  if (pageToken) {
    console.warn(
      `[drive-discover] pagination cap (25 pages × 200) reached with more pages remaining — ` +
        `the clip set may be silently truncated. Narrow the folder or raise the cap.`,
    );
  }

  // Window resolution. Two modes:
  //   1. EXPLICIT RANGE (opts.weekStart+weekEnd, or BWB_WEEK_START+BWB_WEEK_END):
  //      the recap is pinned to a LITERAL week — only clips whose FILENAME date
  //      falls inside [weekStart 00:00 … weekEnd 23:59] are kept. This is what
  //      makes a stated week ("May 23–30") actually mean that week, instead of
  //      "the last 7 days from whenever the job happens to run."
  //   2. SUN–SAT WEEK (default): the recap week is ALWAYS Sunday (start) → the
  //      following Saturday (end) — Bob's fixed weekly cadence. With no anchor we
  //      recap the JUST-COMPLETED week (the current week isn't over when the
  //      autonomous job runs, so we step back to the prior Sun–Sat). With an
  //      explicit anchorDate / BWB_WEEK_ANCHOR we recap the Sun–Sat week that
  //      CONTAINS that date. Both bounds are floored/ceiled to local day edges so
  //      a clip dated at local midnight on Sunday isn't dropped by a few hours.
  const { cutoff, upperBound, windowDesc } = computeWeekWindow({
    weekStartRaw: opts.weekStart ?? process.env.BWB_WEEK_START,
    weekEndRaw: opts.weekEnd ?? process.env.BWB_WEEK_END,
    anchorRaw: opts.anchorDate ?? process.env.BWB_WEEK_ANCHOR,
  });
  console.log(
    `[drive-discover] window: ${windowDesc} ` +
      `[${new Date(cutoff).toISOString().slice(0, 10)} … ${new Date(upperBound).toISOString().slice(0, 10)}]`,
  );
  // The ONLY trustworthy date signal is the one ENCODED IN THE FILENAME. Drive's
  // modifiedTime is unreliable for the weekly window — Bob bulk-uploads and
  // re-touches old clips, so a last-week clip can carry a recent modifiedTime and
  // silently leak into "this week" (the exact stale-footage bug). By default we
  // therefore DROP clips with no parseable filename date; set BWB_ALLOW_UNDATED=1
  // (or opts.allowUndated) to fall back to modifiedTime for undated clips.
  const allowUndated = opts.allowUndated ?? process.env.BWB_ALLOW_UNDATED === "1";
  const picked: DiscoveredDriveClip[] = [];
  for (const f of files) {
    if (!String(f.mimeType || "").startsWith("video/")) continue;
    if (exclude.test(f.name || "")) continue;
    const parsed = parseClipDate(f.name || "");
    if (!parsed && !allowUndated) {
      console.warn(
        `[drive-discover] ⊘ skipping "${f.name}" — no parseable date in filename; ` +
          `Drive modifiedTime is unreliable for the weekly window (set BWB_ALLOW_UNDATED=1 to include undated clips by modifiedTime).`,
      );
      continue;
    }
    const effDate = parsed ?? new Date(f.modifiedTime);
    if (!effDate || isNaN(effDate.getTime())) continue;
    const t = effDate.getTime();
    if (t < cutoff || t > upperBound) continue;
    const durMs = Number(f.videoMediaMetadata?.durationMillis || 0);
    const durSec = durMs ? Math.round(durMs / 1000) : 0;
    if (durSec > 0 && durSec > maxDurationSec) continue; // known long-form → skip
    picked.push({
      fileId: f.id,
      name: f.name,
      modifiedTime: f.modifiedTime,
      clipDate: parsed ? parsed.toISOString().slice(0, 10) : null,
      slot: detectSlot(f.name || ""),
      durationSeconds: durSec,
    });
  }

  // Dedupe TRUE copies only. The key is keyed on (calendar day + time-of-day slot
  // + normalized name) so two distinct same-day talks (morning + evening) are
  // NEVER collapsed into one — that collapse is exactly what dropped one of Bob's
  // daily talks from the recap. Only a genuine duplicate (same day, same slot,
  // same normalized name — e.g. "Copy of 2026-05-30 morning") is deduped.
  const seen = new Set<string>();
  const deduped: DiscoveredDriveClip[] = [];
  for (const c of picked) {
    const dayKey = c.clipDate || c.modifiedTime.slice(0, 10);
    const key = `${dayKey}|${c.slot ?? ""}|${normName(c.name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(c);
  }

  deduped.sort((a, b) => {
    const da = (a.clipDate ? new Date(a.clipDate) : new Date(a.modifiedTime)).getTime();
    const db = (b.clipDate ? new Date(b.clipDate) : new Date(b.modifiedTime)).getTime();
    return db - da;
  });
  return deduped;
}

function extractAudio(videoPath: string, outPath: string): boolean {
  const r = spawnSync(
    "ffmpeg",
    ["-y", "-i", videoPath, "-vn", "-acodec", "aac", "-b:a", "128k", outPath],
    { encoding: "utf8", timeout: 120_000, maxBuffer: 16 * 1024 * 1024, env: sanitizeSpawnEnv(process.env) },
  );
  return (r.status ?? 1) === 0 && fs.existsSync(outPath);
}

/**
 * Actual media duration in seconds via ffprobe. Returns NaN when the probe
 * FAILS (non-zero exit, missing binary, unparseable output) so callers can
 * fail-closed instead of mistaking "unknown" for "short". A silent 0 here
 * would disable the long-form exclusion guard whenever ffprobe is broken.
 */
function probeDurationSec(videoPath: string): number {
  const r = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", videoPath],
    { encoding: "utf8", timeout: 30_000, env: sanitizeSpawnEnv(process.env) },
  );
  if ((r.status ?? 1) !== 0) return NaN;
  const v = parseFloat(String(r.stdout || "").trim());
  return Number.isFinite(v) && v > 0 ? v : NaN;
}

async function downloadDriveFile(fileId: string, destPath: string): Promise<void> {
  if (!SAFE_DRIVE_ID.test(fileId)) {
    throw new Error(`refusing to download Drive file with unexpected id format: "${fileId.slice(0, 40)}"`);
  }
  const resp = await driveRequest(`/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`);
  if (!resp.ok) {
    throw new Error(`Drive download ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 200)}`);
  }
  if (!resp.body) throw new Error("Drive download returned an empty body");
  // Stream straight to disk — these clips are 90-150MB+; buffering the whole
  // file into memory (arrayBuffer) OOM-killed the process under load.
  await pipeline(Readable.fromWeb(resp.body as any), fs.createWriteStream(destPath));
}

/**
 * Download + transcribe each Drive clip. Serial (gentle on Drive + Scribe). One
 * failure does not abort the batch. Same return shape as extractWeeklyTranscripts
 * so the weekly builder is source-agnostic.
 */
export async function extractWeeklyDriveTranscripts(
  clips: DiscoveredDriveClip[],
): Promise<{ transcripts: YouTubeTranscript[]; failures: { url: string; error: string }[] }> {
  const transcripts: YouTubeTranscript[] = [];
  const failures: { url: string; error: string }[] = [];
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "bwb-drive-"));
  try {
    const maxShortSec = Number(process.env.BWB_MAX_SHORT_SEC) || 120;
    for (const c of clips) {
      try {
        if (!SAFE_DRIVE_ID.test(c.fileId)) throw new Error(`unexpected Drive fileId format: "${String(c.fileId).slice(0, 40)}"`);
        console.log(`[drive-transcript] downloading "${c.name}" …`);
        const videoPath = path.join(workDir, `${c.fileId}.mp4`);
        await downloadDriveFile(c.fileId, videoPath);
        const mb = (fs.statSync(videoPath).size / 1048576).toFixed(1);
        console.log(`[drive-transcript]   downloaded ${mb}MB → extracting audio…`);
        // Fail-closed long-form guard: Drive often omits videoMediaMetadata for
        // freshly uploaded clips, so discovery's metadata duration filter can't
        // see them. Probe the ACTUAL duration now that the file is on disk and
        // skip anything over the short ceiling so the weekly long-form can't
        // re-enter synthesis (feedback loop).
        const probed = probeDurationSec(videoPath);
        if (!Number.isFinite(probed)) {
          // Fail-closed: if we cannot verify the clip is short-form (ffprobe
          // broken/unavailable) we skip it rather than risk re-admitting
          // long-form into weekly synthesis. Recorded so the run surfaces it.
          console.warn(`[drive-transcript]   ⊘ skipping "${c.name}" — could not probe duration (ffprobe failed); skipping to keep the long-form guard fail-closed`);
          failures.push({ url: c.name, error: "duration probe failed (ffprobe) — skipped fail-closed" });
          try { fs.rmSync(videoPath, { force: true }); } catch { /* best effort */ }
          continue;
        }
        if (probed > maxShortSec) {
          console.warn(`[drive-transcript]   ⊘ skipping "${c.name}" — ${Math.round(probed)}s exceeds ${maxShortSec}s short ceiling (likely long-form)`);
          try { fs.rmSync(videoPath, { force: true }); } catch { /* best effort */ }
          continue;
        }
        // Extract audio so we don't ship a 150MB video to Scribe.
        const audioPath = path.join(workDir, `${c.fileId}.m4a`);
        const haveAudio = extractAudio(videoPath, audioPath);
        const r = await transcribeWords(haveAudio ? audioPath : videoPath);
        if (!r.success) throw new Error((r as any).error || "transcription failed");
        const text = ((r as any).text || "").trim();
        if (!text) throw new Error("empty transcript");
        console.log(`[drive-transcript]   ✓ "${c.name}" (${text.length} chars)`);
        transcripts.push({
          url: `https://drive.google.com/file/d/${c.fileId}/view`,
          videoId: c.fileId,
          title: c.name.replace(/\.[^.]+$/, ""),
          durationSeconds: c.durationSeconds || Number((r as any).durationSeconds) || 0,
          transcript: text,
          language: (r as any).language,
        });
        try { fs.rmSync(videoPath, { force: true }); fs.rmSync(audioPath, { force: true }); } catch { /* best effort */ }
      } catch (e: any) {
        const error = e?.message || String(e);
        console.warn(`[drive-transcript]   ✗ ${c.name} — ${error}`);
        failures.push({ url: c.name, error });
      }
    }
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  return { transcripts, failures };
}
