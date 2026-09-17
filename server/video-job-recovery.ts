import * as fs from "fs";
import * as path from "path";
import type { ChapterSpec, MpegScene } from "./mpeg-engine";

const JOBS_ROOT = path.resolve(process.cwd(), "data", "video-jobs");
const JOB_ID_RE = /^vj_[a-z0-9_]{8,80}$/;
const MIN_CHAPTER_BYTES = 4096;
const MAX_CHAPTERS = 24;
const MAX_SCENES_PER_CHAPTER = 24;
const MAX_TITLE_LENGTH = 200;
const MAX_TEXT_LENGTH = 12_000;
const MAX_PATH_LENGTH = 2_000;

export interface RenderManifest {
  version: 1;
  chapters: ChapterSpec[];
}

function boundedString(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  if (value.length > maxLength) throw new Error(`${field} exceeds its ${maxLength}-character limit`);
  return value;
}

function normalizeScene(scene: unknown, chapterIdx: number, sceneIdx: number): MpegScene {
  if (!scene || typeof scene !== "object" || Array.isArray(scene)) {
    throw new Error(`chapter ${chapterIdx + 1}, scene ${sceneIdx + 1} must be an object`);
  }
  const source = scene as Record<string, unknown>;
  const durationOverride = source.durationOverride;
  if (durationOverride !== undefined && (!Number.isFinite(durationOverride) || typeof durationOverride !== "number" || durationOverride <= 0 || durationOverride > 300)) {
    throw new Error(`chapter ${chapterIdx + 1}, scene ${sceneIdx + 1} has an invalid durationOverride`);
  }
  const qualityTier = source.qualityTier;
  if (qualityTier !== undefined && qualityTier !== "hero" && qualityTier !== "broll") {
    throw new Error(`chapter ${chapterIdx + 1}, scene ${sceneIdx + 1} has an invalid qualityTier`);
  }
  const normalized: MpegScene = {
    title: boundedString(source.title, "scene title", MAX_TITLE_LENGTH),
    narration: boundedString(source.narration, "scene narration", MAX_TEXT_LENGTH),
    imagePath: boundedString(source.imagePath, "scene imagePath", MAX_PATH_LENGTH),
    imagePrompt: boundedString(source.imagePrompt, "scene imagePrompt", MAX_TEXT_LENGTH),
    durationOverride: durationOverride as number | undefined,
    qualityTier: qualityTier as "hero" | "broll" | undefined,
    videoClipPrompt: boundedString(source.videoClipPrompt, "scene videoClipPrompt", MAX_TEXT_LENGTH),
  };
  if (!normalized.narration && !normalized.imagePath && !normalized.imagePrompt) {
    throw new Error(`chapter ${chapterIdx + 1}, scene ${sceneIdx + 1} needs narration, imagePath, or imagePrompt`);
  }
  return Object.fromEntries(Object.entries(normalized).filter(([, value]) => value !== undefined)) as MpegScene;
}

/** Makes a serializable, bounded copy of the chapter inputs required after a restart. */
export function normalizeRenderManifest(chapters: ChapterSpec[]): RenderManifest {
  if (!Array.isArray(chapters) || chapters.length === 0 || chapters.length > MAX_CHAPTERS) {
    throw new Error(`render plan must contain between 1 and ${MAX_CHAPTERS} chapters`);
  }
  const normalized = chapters.map((chapter, chapterIdx) => {
    if (!chapter || typeof chapter !== "object" || Array.isArray(chapter)) {
      throw new Error(`chapter ${chapterIdx + 1} must be an object`);
    }
    const chapterTitle = boundedString((chapter as any).chapterTitle, "chapter title", MAX_TITLE_LENGTH);
    if (!chapterTitle?.trim()) throw new Error(`chapter ${chapterIdx + 1} needs a title`);
    const scenes = (chapter as any).scenes;
    if (!Array.isArray(scenes) || scenes.length === 0 || scenes.length > MAX_SCENES_PER_CHAPTER) {
      throw new Error(`chapter ${chapterIdx + 1} needs at least one scene and no more than ${MAX_SCENES_PER_CHAPTER}`);
    }
    return {
      chapterTitle,
      scenes: scenes.map((scene, sceneIdx) => normalizeScene(scene, chapterIdx, sceneIdx)),
    };
  });
  return { version: 1, chapters: normalized };
}

export type RecoverableChapterState = {
  idx: number;
  title: string;
  scene_count: number;
  status: "queued" | "rendering" | "done" | "failed";
  file_path?: string;
  duration_sec?: number;
  error?: string;
  started_at?: number;
  completed_at?: number;
  attempts: number;
};

function expectedChapterPath(jobId: string, chapterIdx: number): string | null {
  if (!JOB_ID_RE.test(jobId) || !Number.isInteger(chapterIdx) || chapterIdx < 0) return null;
  return path.join(JOBS_ROOT, jobId, "chapters", `chapter_${String(chapterIdx + 1).padStart(3, "0")}.mp4`);
}

/**
 * A completed chapter is reusable only when it is exactly in this job's
 * canonical chapter slot, resolves inside that slot's directory, and contains
 * the minimum structural signature of an MP4. This rejects ghosts, DB path
 * tampering, symlink escapes, partial writes, and arbitrary files.
 */
export function verifyReusableChapterArtifact(
  jobId: string,
  chapterIdx: number,
  storedPath?: string,
): { valid: true; path: string } | { valid: false; reason: string } {
  const expected = expectedChapterPath(jobId, chapterIdx);
  if (!expected || !storedPath || path.resolve(storedPath) !== expected) {
    return { valid: false, reason: "chapter artifact is not in its expected job slot" };
  }

  try {
    const real = fs.realpathSync(expected);
    const chaptersRoot = path.join(JOBS_ROOT, jobId, "chapters");
    if (!real.startsWith(chaptersRoot + path.sep) || path.extname(real).toLowerCase() !== ".mp4") {
      return { valid: false, reason: "chapter artifact resolves outside the job chapter directory" };
    }
    const stat = fs.statSync(real);
    if (!stat.isFile() || stat.size < MIN_CHAPTER_BYTES) {
      return { valid: false, reason: "chapter artifact is missing or too small to be a video" };
    }
    const fd = fs.openSync(real, "r");
    try {
      const header = Buffer.alloc(12);
      fs.readSync(fd, header, 0, header.length, 0);
      if (header.slice(4, 8).toString("ascii") !== "ftyp") {
        return { valid: false, reason: "chapter artifact is not an MP4" };
      }
    } finally {
      fs.closeSync(fd);
    }
    return { valid: true, path: expected };
  } catch (error: any) {
    return { valid: false, reason: `chapter artifact is unreadable: ${error?.message || String(error)}` };
  }
}

/**
 * Converts persisted chapter state into a safe resumable queue. A stale
 * in-progress or failed chapter is retried; a completed chapter survives only
 * after its local artifact passes verification. The caller is responsible for
 * validating the render plan before it schedules the returned queue.
 */
export function prepareChaptersForRecovery(
  jobId: string,
  chapters: RecoverableChapterState[],
  expectedChapterCount: number,
): { ok: true; chapters: RecoverableChapterState[] } | { ok: false; reason: string } {
  if (!Array.isArray(chapters) || chapters.length !== expectedChapterCount) {
    return { ok: false, reason: "persisted chapter state does not match the recovery manifest" };
  }

  const recovered: RecoverableChapterState[] = [];
  for (let idx = 0; idx < expectedChapterCount; idx += 1) {
    const chapter = chapters[idx];
    if (!chapter || chapter.idx !== idx) {
      return { ok: false, reason: "persisted chapter order does not match the recovery manifest" };
    }
    const next: RecoverableChapterState = { ...chapter };
    if (next.status === "done") {
      const artifact = verifyReusableChapterArtifact(jobId, idx, next.file_path);
      if (artifact.valid) {
        next.file_path = artifact.path;
      } else {
        next.status = "queued";
        next.file_path = undefined;
        next.duration_sec = undefined;
        next.completed_at = undefined;
        next.error = `recovery will re-render this chapter: ${artifact.reason}`.slice(0, 500);
      }
    } else {
      next.status = "queued";
      next.file_path = undefined;
      next.duration_sec = undefined;
      next.completed_at = undefined;
      next.error = next.status === "queued" ? next.error : undefined;
    }
    recovered.push(next);
  }
  return { ok: true, chapters: recovered };
}