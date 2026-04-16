import { execFileSync, execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const OUTPUT_DIR = path.resolve(process.cwd(), "project-assets");
const MAX_PARALLEL_TTS = 4;

function getFFmpegPath(): string {
  try {
    return execSync("which ffmpeg 2>/dev/null", { encoding: "utf-8", timeout: 5000 }).trim().split("\n")[0] || "ffmpeg";
  } catch { return "ffmpeg"; }
}

function getFFprobePath(): string {
  return getFFmpegPath().replace(/ffmpeg$/, "ffprobe");
}

function probeDuration(filePath: string): number {
  try {
    return parseFloat(
      execFileSync(getFFprobePath(), ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", filePath], { encoding: "utf-8", timeout: 10000 }).trim()
    ) || 5;
  } catch { return 5; }
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function escapeFFmpegText(s: string): string {
  return s.replace(/[\\':;\[\]{}()%#=@&!<>^~`|"]/g, " ").replace(/\s+/g, " ").trim();
}

export interface MpegScene {
  narration?: string;
  title?: string;
  imagePath?: string;
  imagePrompt?: string;
  durationOverride?: number;
}

export interface MpegJobOptions {
  title: string;
  scenes: MpegScene[];
  voice?: string;
  voiceProvider?: "openai" | "elevenlabs";
  resolution?: "1080p" | "720p" | "4k";
  fps?: number;
  transition?: string;
  crossfadeMs?: number;
  kenBurns?: boolean;
  kenBurnsIntensity?: number;
  backgroundMusicPath?: string;
  musicVolume?: number;
  introText?: string;
  outroText?: string;
  tenantId?: number;
  projectId?: number;
  uploadToDrive?: boolean;
  emailTo?: string;
  _projectDriveFolderId?: string;
}

export interface MpegJobResult {
  success: boolean;
  filePath?: string;
  driveUrl?: string;
  durationSeconds?: number;
  sizeBytes?: number;
  scenesProcessed: number;
  steps: string[];
  error?: string;
}

export async function produceVideo(options: MpegJobOptions): Promise<MpegJobResult> {
  const startTime = Date.now();
  const steps: string[] = [];
  const ffmpeg = getFFmpegPath();
  const jobId = `mpeg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const jobDir = path.join(OUTPUT_DIR, jobId);
  ensureDir(jobDir);
  ensureDir(OUTPUT_DIR);

  const res = options.resolution || "1080p";
  const [width, height] = res === "4k" ? [3840, 2160] : res === "720p" ? [1280, 720] : [1920, 1080];
  const fps = options.fps || 30;
  const crossfadeMs = options.crossfadeMs ?? 500;
  const crossfadeSec = crossfadeMs / 1000;
  const transition = options.transition || "fade";
  const kenBurns = options.kenBurns ?? false;
  const kenBurnsIntensity = Math.min(1.5, Math.max(1.0, options.kenBurnsIntensity || 1.15));
  const musicVolume = Math.min(1.0, Math.max(0.0, options.musicVolume ?? 0.12));
  const safeTitle = options.title.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);

  let scenes = [...options.scenes];

  if (options.introText) {
    scenes.unshift({ title: options.introText, durationOverride: 4 });
  }
  if (options.outroText) {
    scenes.push({ title: options.outroText, durationOverride: 4 });
  }

  console.log(`[mpeg-engine] Job ${jobId}: ${scenes.length} scenes, ${res}, ${fps}fps, transition=${transition}`);
  steps.push(`Starting MPEG production: ${scenes.length} scenes @ ${res}`);

  let executeTool: any;
  try {
    const toolsMod = await import("./tools");
    executeTool = toolsMod.executeTool;
  } catch (err: any) {
    return { success: false, scenesProcessed: 0, steps: [`Failed to load tools: ${err.message}`], error: err.message };
  }

  const sceneData: { imagePath: string; audioPath: string; duration: number }[] = [];

  const generateTTSForScene = async (scene: MpegScene, index: number): Promise<{ audioPath: string; duration: number }> => {
    if (!scene.narration?.trim()) {
      return { audioPath: "", duration: scene.durationOverride || 3 };
    }
    try {
      const audioResult = await executeTool("generate_audio", {
        text: scene.narration,
        provider: options.voiceProvider || "openai",
        voice: options.voice || "onyx",
        filename: `${safeTitle}_scene_${index + 1}`,
        _tenantId: options.tenantId,
      }, options.tenantId);

      if (audioResult?.file_path && fs.existsSync(audioResult.file_path)) {
        const dur = probeDuration(audioResult.file_path);
        return { audioPath: audioResult.file_path, duration: dur + 0.3 };
      }
    } catch (err: any) {
      console.error(`[mpeg-engine] TTS failed for scene ${index + 1}: ${err.message?.slice(0, 100)}`);
    }
    const estDur = Math.max(3, (scene.narration || "").split(/\s+/).length / 2.5);
    return { audioPath: "", duration: estDur };
  };

  console.log(`[mpeg-engine] Phase 1: Parallel TTS generation (${MAX_PARALLEL_TTS} concurrent)...`);
  steps.push(`Phase 1: Generating narration audio (parallel batches of ${MAX_PARALLEL_TTS})...`);
  const ttsStartTime = Date.now();

  const ttsResults: { audioPath: string; duration: number }[] = new Array(scenes.length);
  for (let batch = 0; batch < scenes.length; batch += MAX_PARALLEL_TTS) {
    const batchSlice = scenes.slice(batch, batch + MAX_PARALLEL_TTS);
    const batchPromises = batchSlice.map((scene, i) => generateTTSForScene(scene, batch + i));
    const results = await Promise.all(batchPromises);
    results.forEach((r, i) => {
      ttsResults[batch + i] = r;
    });
  }

  const ttsTime = ((Date.now() - ttsStartTime) / 1000).toFixed(1);
  const audioCount = ttsResults.filter(r => r.audioPath).length;
  steps.push(`Phase 1 complete: ${audioCount}/${scenes.length} audio tracks in ${ttsTime}s`);

  console.log(`[mpeg-engine] Phase 2: Generating scene images (parallel, 4 concurrent)...`);
  steps.push(`Phase 2: Generating scene images (parallel)...`);
  const imageStartTime = Date.now();
  const MAX_PARALLEL_IMAGES = 4;

  const generateImageForScene = async (scene: MpegScene, i: number): Promise<string> => {
    if (scene.imagePath && fs.existsSync(scene.imagePath)) {
      return scene.imagePath;
    }
    if (scene.imagePrompt) {
      try {
        const imgResult = await executeTool("generate_social_image", {
          prompt: scene.imagePrompt,
          style: "cinematic",
          aspect_ratio: "16:9",
          _tenantId: options.tenantId,
        }, options.tenantId);
        const localFile = imgResult?.file_path || imgResult?.local_path;
        if (localFile && fs.existsSync(localFile)) {
          return localFile;
        }
        const remoteUrl = imgResult?.imageUrl || imgResult?.drive_url || imgResult?.url;
        if (remoteUrl) {
          try {
            const dlPath = path.join(jobDir, `scene_img_${String(i + 1).padStart(3, "0")}.png`);
            const resp = await fetch(remoteUrl);
            if (resp.ok) {
              const buf = Buffer.from(await resp.arrayBuffer());
              fs.writeFileSync(dlPath, buf);
              if (fs.existsSync(dlPath) && fs.statSync(dlPath).size > 1000) {
                console.log(`[mpeg-engine] Scene ${i + 1}: downloaded image from URL (${buf.length} bytes)`);
                return dlPath;
              }
            }
          } catch (dlErr: any) {
            console.warn(`[mpeg-engine] Scene ${i + 1}: failed to download image from URL: ${dlErr.message?.slice(0, 80)}`);
          }
        }
      } catch (err: any) {
        console.warn(`[mpeg-engine] Image generation failed for scene ${i + 1}: ${err.message?.slice(0, 80)}`);
      }
    }
    const slideFile = path.join(jobDir, `scene_${String(i + 1).padStart(3, "0")}.png`);
    const colors = ["#0f172a", "#1e1b4b", "#172554", "#1a1a2e", "#0c4a6e", "#1e3a5f", "#2c1654", "#164e63", "#1b263b", "#0d1b2a"];
    const bgColor = colors[i % colors.length];
    const displayTitle = escapeFFmpegText(scene.title || `Scene ${i + 1}`).slice(0, 50);
    const subtitle = scene.narration ? escapeFFmpegText(scene.narration).slice(0, 100) : "";
    const drawFilters: string[] = [];
    if (i === 0 && options.introText) {
      drawFilters.push(`drawtext=text='${escapeFFmpegText(options.title).slice(0, 40)}':fontsize=64:fontcolor=white:x=(w-text_w)/2:y=h/3`);
      if (subtitle) drawFilters.push(`drawtext=text='${subtitle.slice(0, 80)}':fontsize=28:fontcolor=#aaaaaa:x=(w-text_w)/2:y=h/2+60`);
    } else {
      drawFilters.push(`drawtext=text='${displayTitle}':fontsize=48:fontcolor=white:x=(w-text_w)/2:y=h/3`);
      if (subtitle) drawFilters.push(`drawtext=text='${subtitle.slice(0, 80)}':fontsize=24:fontcolor=#cccccc:x=(w-text_w)/2:y=h/2+50`);
    }
    try {
      execFileSync(ffmpeg, ["-y", "-f", "lavfi", "-i", `color=c=${bgColor}:s=${width}x${height}:d=1`, "-vf", drawFilters.join(","), "-frames:v", "1", "-update", "1", slideFile], { timeout: 10000, stdio: "pipe" });
    } catch (drawErr: any) {
      console.warn(`[mpeg-engine] Scene ${i + 1} drawtext failed (${drawErr.message?.slice(0, 60)}), trying plain color`);
      try {
        execFileSync(ffmpeg, ["-y", "-f", "lavfi", "-i", `color=c=${bgColor}:s=${width}x${height}:d=1`, "-frames:v", "1", "-update", "1", slideFile], { timeout: 5000, stdio: "pipe" });
      } catch (plainErr: any) {
        console.error(`[mpeg-engine] Scene ${i + 1} plain color fallback also failed: ${plainErr.message?.slice(0, 80)}`);
      }
    }
    return fs.existsSync(slideFile) ? slideFile : "";
  };

  const imageResults: string[] = new Array(scenes.length).fill("");
  for (let batch = 0; batch < scenes.length; batch += MAX_PARALLEL_IMAGES) {
    const batchSlice = scenes.slice(batch, batch + MAX_PARALLEL_IMAGES);
    const batchResults = await Promise.allSettled(
      batchSlice.map((scene, i) => generateImageForScene(scene, batch + i))
    );
    batchResults.forEach((r, i) => {
      imageResults[batch + i] = r.status === "fulfilled" ? r.value : "";
    });
  }

  for (let i = 0; i < scenes.length; i++) {
    const tts = ttsResults[i];
    sceneData.push({
      imagePath: imageResults[i] || "",
      audioPath: tts.audioPath,
      duration: scenes[i].durationOverride || tts.duration,
    });
  }

  const imageTime = ((Date.now() - imageStartTime) / 1000).toFixed(1);
  steps.push(`Phase 2 complete: ${sceneData.filter(s => s.imagePath).length} images in ${imageTime}s`);

  console.log(`[mpeg-engine] Phase 3: FFmpeg assembly...`);
  steps.push(`Phase 3: FFmpeg video assembly...`);
  const assemblyStart = Date.now();

  const segmentPaths: string[] = [];
  const tempFiles: string[] = [];

  for (let i = 0; i < sceneData.length; i++) {
    const s = sceneData[i];
    if (!s.imagePath || !fs.existsSync(s.imagePath)) {
      steps.push(`⚠️ Scene ${i + 1} skipped — no image`);
      continue;
    }

    const segPath = path.join(jobDir, `seg_${String(i + 1).padStart(3, "0")}.mp4`);
    tempFiles.push(segPath);

    const hasRealAudio = s.audioPath && fs.existsSync(s.audioPath);
    const audioDur = hasRealAudio ? probeDuration(s.audioPath) : 0;
    const dur = hasRealAudio ? Math.max(s.duration, audioDur + 1.5) : s.duration;
    const usedProvidedImage = scenes[i]?.imagePath && fs.existsSync(scenes[i].imagePath!);

    const ffArgs = ["-y", "-loop", "1", "-i", s.imagePath, "-t", String(dur)];

    if (hasRealAudio) {
      ffArgs.push("-i", s.audioPath, "-c:a", "aac", "-ar", "44100", "-ac", "2", "-shortest");
    } else {
      ffArgs.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100", "-t", String(dur), "-c:a", "aac");
    }

    let vf = usedProvidedImage
      ? `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`
      : `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
    if (kenBurns && !usedProvidedImage) {
      const totalFrames = Math.ceil(dur * fps);
      const directions = ["zoom-in", "zoom-out", "pan-left", "pan-right"];
      const direction = directions[i % directions.length];
      const zoomStart = direction === "zoom-out" ? kenBurnsIntensity : 1.0;
      const zoomEnd = direction === "zoom-out" ? 1.0 : kenBurnsIntensity;
      const superW = Math.ceil(width * 1.33);
      const superH = Math.ceil(height * 1.33);
      const panX = direction === "pan-left" ? `iw/2-(iw/zoom/2)+((iw/zoom)*on/${totalFrames})`
        : direction === "pan-right" ? `iw/2-(iw/zoom/2)-((iw/zoom)*0.1*on/${totalFrames})`
        : "iw/2-(iw/zoom/2)";
      vf = `scale=${superW}:${superH}:force_original_aspect_ratio=increase,crop=${superW}:${superH},zoompan=z='${zoomStart}+(${zoomEnd}-${zoomStart})*on/${totalFrames}':x='${panX}':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=${width}x${height}:fps=${fps}`;
    }

    ffArgs.push("-vf", vf, "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-r", String(fps), segPath);

    try {
      execFileSync(ffmpeg, ffArgs, { timeout: 90_000, stdio: "pipe" });
      segmentPaths.push(segPath);
    } catch (segErr: any) {
      const stderr = segErr.stderr ? segErr.stderr.toString().slice(-500) : "no stderr";
      console.error(`[mpeg-engine] Segment ${i + 1} failed.\n  CMD: ffmpeg ${ffArgs.join(" ").slice(0, 200)}\n  STDERR: ${stderr}`);
      steps.push(`⚠️ Scene ${i + 1} encoding failed — skipped`);
    }
  }

  if (segmentPaths.length === 0) {
    for (const tf of tempFiles) { try { fs.unlinkSync(tf); } catch {} }
    try { fs.rmSync(jobDir, { recursive: true, force: true }); } catch {}
    return { success: false, scenesProcessed: 0, steps: [...steps, "No segments were successfully encoded"], error: "All scene encodings failed" };
  }

  const outPath = path.join(OUTPUT_DIR, `${safeTitle}_${Date.now()}.mp4`);

  if (segmentPaths.length < 2 || crossfadeSec <= 0) {
    const concatFile = path.join(jobDir, "concat.txt");
    tempFiles.push(concatFile);
    fs.writeFileSync(concatFile, segmentPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));
    try {
      execFileSync(ffmpeg, [
        "-y", "-f", "concat", "-safe", "0", "-i", concatFile,
        "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-pix_fmt", "yuv420p", "-r", String(fps),
        "-c:a", "aac", "-ar", "44100", "-ac", "2",
        outPath
      ], { timeout: 300_000, stdio: "pipe" });
    } catch (err: any) {
      for (const tf of tempFiles) { try { fs.unlinkSync(tf); } catch {} }
      try { fs.rmSync(jobDir, { recursive: true, force: true }); } catch {}
      return { success: false, scenesProcessed: segmentPaths.length, steps: [...steps, `Concat failed: ${err.message?.slice(0, 150)}`], error: err.message };
    }
  } else {
    let currentPath = segmentPaths[0];
    for (let i = 1; i < segmentPaths.length; i++) {
      const fadedPath = path.join(jobDir, `faded_${i}.mp4`);
      tempFiles.push(fadedPath);
      const dur0 = probeDuration(currentPath);
      const offset = Math.max(0, dur0 - crossfadeSec);
      try {
        execFileSync(ffmpeg, [
          "-y", "-i", currentPath, "-i", segmentPaths[i],
          "-filter_complex", `[0:v][1:v]xfade=transition=${transition}:duration=${crossfadeSec}:offset=${offset}[vout];[0:a][1:a]acrossfade=d=${crossfadeSec}[aout]`,
          "-map", "[vout]", "-map", "[aout]",
          "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-pix_fmt", "yuv420p", "-r", String(fps), "-c:a", "aac", fadedPath
        ], { timeout: 120_000, stdio: "pipe" });
        currentPath = fadedPath;
      } catch {
        const concatFb = path.join(jobDir, `concat_fb_${i}.txt`);
        tempFiles.push(concatFb);
        fs.writeFileSync(concatFb, [currentPath, segmentPaths[i]].map(p => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));
        const fbPath = path.join(jobDir, `fb_${i}.mp4`);
        tempFiles.push(fbPath);
        try {
          execFileSync(ffmpeg, [
            "-y", "-f", "concat", "-safe", "0", "-i", concatFb,
            "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-pix_fmt", "yuv420p", "-r", String(fps),
            "-c:a", "aac", "-ar", "44100", "-ac", "2",
            fbPath
          ], { timeout: 120_000, stdio: "pipe" });
          currentPath = fbPath;
        } catch {
          steps.push(`⚠️ Transition at scene ${i + 1} failed, using hard cut`);
        }
      }
    }
    if (currentPath !== outPath) {
      fs.copyFileSync(currentPath, outPath);
    }
  }

  if (options.backgroundMusicPath && fs.existsSync(options.backgroundMusicPath)) {
    const mixedPath = path.join(jobDir, `mixed_final.mp4`);
    tempFiles.push(mixedPath);
    try {
      execFileSync(ffmpeg, [
        "-y", "-i", outPath, "-i", options.backgroundMusicPath,
        "-filter_complex", `[1:a]volume=${musicVolume}[bg];[0:a][bg]amix=inputs=2:duration=first:dropout_transition=3[aout]`,
        "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-shortest", mixedPath
      ], { timeout: 120_000, stdio: "pipe" });
      fs.copyFileSync(mixedPath, outPath);
      steps.push(`Background music mixed at ${(musicVolume * 100).toFixed(0)}% volume`);
    } catch (err: any) {
      steps.push(`⚠️ Music mixing failed (video still OK): ${err.message?.slice(0, 80)}`);
    }
  }

  const assemblyTime = ((Date.now() - assemblyStart) / 1000).toFixed(1);
  const stats = fs.statSync(outPath);
  const totalDuration = probeDuration(outPath);
  steps.push(`Phase 3 complete: ${(stats.size / 1024 / 1024).toFixed(1)}MB video in ${assemblyTime}s`);

  let driveUrl: string | undefined;
  if (options.uploadToDrive !== false) {
    try {
      const { uploadAndShare } = await import("./google-drive");
      const driveResult = await uploadAndShare({
        filePath: outPath,
        fileName: `${safeTitle}.mp4`,
        mimeType: "video/mp4",
        description: options.title,
        folderLabel: "VisionClaw Media/Videos",
        parentFolderId: options._projectDriveFolderId || undefined,
      });
      if (driveResult.success && driveResult.viewUrl) {
        driveUrl = driveResult.viewUrl;
        steps.push(`Uploaded to Google Drive: ${driveUrl}`);
      }
    } catch (err: any) {
      steps.push(`⚠️ Drive upload failed: ${err.message?.slice(0, 80)}`);
    }
  }

  if (options.projectId) {
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      await db.execute(sql`INSERT INTO project_files (project_id, file_name, file_path, file_url, file_type, file_size, uploaded_by) VALUES (${options.projectId}, ${safeTitle + ".mp4"}, ${outPath}, ${driveUrl || null}, ${"video"}, ${stats.size}, ${"mpeg-engine"})`);
    } catch {}
  }

  if (options.emailTo && driveUrl) {
    try {
      await executeTool("send_email", {
        to: options.emailTo,
        subject: `Your video is ready: ${options.title}`,
        text: `Your video "${options.title}" has been produced.\n\nWatch/download: ${driveUrl}\n\n— VisionClaw MPEG Engine`,
        _tenantId: options.tenantId,
      }, options.tenantId);
      steps.push(`Email sent to ${options.emailTo}`);
    } catch (err: any) {
      steps.push(`⚠️ Email failed: ${err.message?.slice(0, 80)}`);
    }
  }

  for (const tf of tempFiles) { try { fs.unlinkSync(tf); } catch {} }
  try { fs.rmSync(jobDir, { recursive: true, force: true }); } catch {}

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  steps.push(`Total production time: ${totalTime}s`);
  console.log(`[mpeg-engine] Job ${jobId} COMPLETE: ${totalDuration.toFixed(1)}s video, ${(stats.size / 1024 / 1024).toFixed(1)}MB, produced in ${totalTime}s`);

  return {
    success: true,
    filePath: outPath,
    driveUrl,
    durationSeconds: totalDuration,
    sizeBytes: stats.size,
    scenesProcessed: segmentPaths.length,
    steps,
  };
}

export async function concatenateClips(clipPaths: string[], outputName: string, transition?: string, crossfadeMs?: number): Promise<MpegJobResult> {
  const steps: string[] = [];
  const ffmpeg = getFFmpegPath();
  ensureDir(OUTPUT_DIR);

  const validClips = clipPaths.filter(p => fs.existsSync(p));
  if (validClips.length === 0) {
    return { success: false, scenesProcessed: 0, steps: ["No valid clip files found"], error: "No valid clips" };
  }

  const safeOutput = outputName.replace(/[^a-zA-Z0-9_-]/g, "_");
  const outPath = path.join(OUTPUT_DIR, `${safeOutput}_${Date.now()}.mp4`);
  const crossfadeSec = (crossfadeMs || 0) / 1000;

  if (crossfadeSec > 0 && transition && validClips.length >= 2) {
    let currentPath = validClips[0];
    const tempFiles: string[] = [];
    for (let i = 1; i < validClips.length; i++) {
      const fadedPath = path.join(OUTPUT_DIR, `${safeOutput}_xfade_${i}.mp4`);
      tempFiles.push(fadedPath);
      const dur0 = probeDuration(currentPath);
      const offset = Math.max(0, dur0 - crossfadeSec);
      try {
        execFileSync(ffmpeg, [
          "-y", "-i", currentPath, "-i", validClips[i],
          "-filter_complex", `[0:v][1:v]xfade=transition=${transition}:duration=${crossfadeSec}:offset=${offset}[vout];[0:a][1:a]acrossfade=d=${crossfadeSec}[aout]`,
          "-map", "[vout]", "-map", "[aout]",
          "-c:v", "libx264", "-preset", "fast", "-pix_fmt", "yuv420p", "-c:a", "aac", fadedPath
        ], { timeout: 120_000, stdio: "pipe" });
        currentPath = fadedPath;
      } catch {
        steps.push(`⚠️ Crossfade at clip ${i + 1} failed, using hard concat`);
      }
    }
    if (currentPath !== outPath) fs.copyFileSync(currentPath, outPath);
    for (const tf of tempFiles) { try { fs.unlinkSync(tf); } catch {} }
  } else {
    const concatFile = path.join(OUTPUT_DIR, `${safeOutput}_concat.txt`);
    fs.writeFileSync(concatFile, validClips.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));
    try {
      execFileSync(ffmpeg, [
        "-y", "-f", "concat", "-safe", "0", "-i", concatFile,
        "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-ar", "44100", "-ac", "2",
        outPath
      ], { timeout: 300_000, stdio: "pipe" });
    } catch (err: any) {
      return { success: false, scenesProcessed: 0, steps: [`Concat failed: ${err.message}`], error: err.message };
    }
    try { fs.unlinkSync(concatFile); } catch {}
  }

  const stats = fs.statSync(outPath);
  const duration = probeDuration(outPath);
  steps.push(`Concatenated ${validClips.length} clips: ${duration.toFixed(1)}s, ${(stats.size / 1024 / 1024).toFixed(1)}MB`);

  return { success: true, filePath: outPath, durationSeconds: duration, sizeBytes: stats.size, scenesProcessed: validClips.length, steps };
}

export async function addAudioToVideo(videoPath: string, audioPath: string, outputName?: string, replaceAudio?: boolean): Promise<MpegJobResult> {
  const steps: string[] = [];
  const ffmpeg = getFFmpegPath();
  ensureDir(OUTPUT_DIR);

  if (!fs.existsSync(videoPath)) return { success: false, scenesProcessed: 0, steps: ["Video file not found"], error: `Not found: ${videoPath}` };
  if (!fs.existsSync(audioPath)) return { success: false, scenesProcessed: 0, steps: ["Audio file not found"], error: `Not found: ${audioPath}` };

  const safeName = (outputName || "video_with_audio").replace(/[^a-zA-Z0-9_-]/g, "_");
  const outPath = path.join(OUTPUT_DIR, `${safeName}_${Date.now()}.mp4`);

  try {
    if (replaceAudio) {
      execFileSync(ffmpeg, ["-y", "-i", videoPath, "-i", audioPath, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-shortest", outPath], { timeout: 120_000, stdio: "pipe" });
    } else {
      execFileSync(ffmpeg, [
        "-y", "-i", videoPath, "-i", audioPath,
        "-filter_complex", "[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=3[aout]",
        "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-shortest", outPath
      ], { timeout: 120_000, stdio: "pipe" });
    }
  } catch (err: any) {
    return { success: false, scenesProcessed: 0, steps: [`Audio merge failed: ${err.message}`], error: err.message };
  }

  const stats = fs.statSync(outPath);
  steps.push(`Audio ${replaceAudio ? "replaced" : "mixed"}: ${(stats.size / 1024 / 1024).toFixed(1)}MB`);
  return { success: true, filePath: outPath, sizeBytes: stats.size, scenesProcessed: 1, steps };
}

export interface ChapterSpec {
  chapterTitle: string;
  scenes: MpegScene[];
}

export interface ParallelVideoOptions extends Omit<MpegJobOptions, "scenes"> {
  chapters: ChapterSpec[];
  maxParallelChapters?: number;
}

export async function produceVideoParallel(options: ParallelVideoOptions): Promise<MpegJobResult> {
  const startTime = Date.now();
  const steps: string[] = [];
  const maxParallel = Math.min(Math.max(1, options.maxParallelChapters || 4), 6);
  const chapters = options.chapters;

  if (!chapters || chapters.length === 0) {
    return { success: false, scenesProcessed: 0, steps: ["No chapters provided"], error: "No chapters" };
  }

  const totalScenes = chapters.reduce((sum, ch) => sum + ch.scenes.length, 0);
  console.log(`[mpeg-parallel] Starting parallel video: ${chapters.length} chapters, ${totalScenes} scenes, ${maxParallel} concurrent workers`);
  steps.push(`Parallel video: ${chapters.length} chapters, ${totalScenes} scenes, ${maxParallel} workers`);

  const chapterResults: { idx: number; result: MpegJobResult }[] = [];
  const cleanupAllChapters = () => {
    for (const cr of chapterResults) {
      try { if (cr.result.filePath && fs.existsSync(cr.result.filePath)) fs.unlinkSync(cr.result.filePath); } catch {}
    }
  };

  try {

  for (let batch = 0; batch < chapters.length; batch += maxParallel) {
    const batchChapters = chapters.slice(batch, batch + maxParallel);
    const batchLabel = `Batch ${Math.floor(batch / maxParallel) + 1}: chapters ${batch + 1}-${batch + batchChapters.length}`;
    console.log(`[mpeg-parallel] ${batchLabel} — launching ${batchChapters.length} parallel workers`);
    steps.push(`${batchLabel}: launching ${batchChapters.length} workers...`);

    const batchPromises = batchChapters.map(async (chapter, i) => {
      const chapterIdx = batch + i;
      const chapterStart = Date.now();
      console.log(`[mpeg-parallel] Chapter ${chapterIdx + 1}/${chapters.length}: "${chapter.chapterTitle}" (${chapter.scenes.length} scenes) — STARTED`);

      const chapterResult = await produceVideo({
        title: `${options.title}_ch${chapterIdx + 1}_${chapter.chapterTitle}`,
        scenes: chapter.scenes,
        voice: options.voice,
        voiceProvider: options.voiceProvider,
        resolution: options.resolution,
        fps: options.fps,
        transition: options.transition,
        crossfadeMs: options.crossfadeMs,
        kenBurns: options.kenBurns,
        kenBurnsIntensity: options.kenBurnsIntensity,
        tenantId: options.tenantId,
        uploadToDrive: false,
      });

      const elapsed = ((Date.now() - chapterStart) / 1000).toFixed(1);
      console.log(`[mpeg-parallel] Chapter ${chapterIdx + 1}: ${chapterResult.success ? "SUCCESS" : "FAILED"} in ${elapsed}s (${chapterResult.scenesProcessed} scenes)`);
      return { idx: chapterIdx, result: chapterResult };
    });

    const batchResults = await Promise.allSettled(batchPromises);
    for (const r of batchResults) {
      if (r.status === "fulfilled") {
        chapterResults.push(r.value);
        steps.push(`Chapter ${r.value.idx + 1} ("${chapters[r.value.idx].chapterTitle}"): ${r.value.result.success ? "OK" : "FAILED"} — ${r.value.result.scenesProcessed} scenes, ${r.value.result.durationSeconds?.toFixed(1) || 0}s`);
      } else {
        steps.push(`Chapter ${batch + batchResults.indexOf(r) + 1}: FAILED — ${(r as PromiseRejectedResult).reason?.message?.slice(0, 100)}`);
      }
    }
  }

  const successChapters = chapterResults
    .filter(cr => cr.result.success && cr.result.filePath && fs.existsSync(cr.result.filePath!))
    .sort((a, b) => a.idx - b.idx);

  if (successChapters.length === 0) {
    return { success: false, scenesProcessed: 0, steps: [...steps, "All chapter productions failed"], error: "All chapters failed" };
  }

  console.log(`[mpeg-parallel] Concatenating ${successChapters.length} chapter segments...`);
  steps.push(`Concatenating ${successChapters.length} chapter segments...`);

  const clipPaths = successChapters.map(cr => cr.result.filePath!);
  const concatResult = await concatenateClips(
    clipPaths,
    options.title.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50),
    options.transition || "fade",
    options.crossfadeMs ?? 400
  );

  if (!concatResult.success || !concatResult.filePath) {
    for (const cr of successChapters) {
      try { if (cr.result.filePath) fs.unlinkSync(cr.result.filePath); } catch {}
    }
    return { success: false, scenesProcessed: successChapters.reduce((s, cr) => s + cr.result.scenesProcessed, 0), steps: [...steps, ...concatResult.steps, "Concatenation failed"], error: concatResult.error };
  }

  steps.push(...concatResult.steps);

  if (options.backgroundMusicPath && fs.existsSync(options.backgroundMusicPath)) {
    const musicResult = await addAudioToVideo(concatResult.filePath, options.backgroundMusicPath, options.title.replace(/[^a-zA-Z0-9_-]/g, "_"), false);
    if (musicResult.success && musicResult.filePath) {
      fs.copyFileSync(musicResult.filePath, concatResult.filePath);
      try { fs.unlinkSync(musicResult.filePath); } catch {}
      steps.push("Background music added");
    }
  }

  let driveUrl: string | undefined;
  if (options.uploadToDrive !== false) {
    try {
      const { uploadAndShare } = await import("./google-drive");
      const safeTitle = options.title.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
      const driveResult = await uploadAndShare({
        filePath: concatResult.filePath,
        fileName: `${safeTitle}.mp4`,
        mimeType: "video/mp4",
        description: options.title,
        folderLabel: "VisionClaw Media/Videos",
        parentFolderId: options._projectDriveFolderId || undefined,
      });
      if (driveResult.success && driveResult.viewUrl) {
        driveUrl = driveResult.viewUrl;
        steps.push(`Uploaded to Google Drive: ${driveUrl}`);
      }
    } catch (err: any) {
      steps.push(`Drive upload failed: ${err.message?.slice(0, 80)}`);
    }
  }

  if (options.projectId) {
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const safeTitle = options.title.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
      await db.execute(sql`INSERT INTO project_files (project_id, file_name, file_path, file_url, file_type, file_size, uploaded_by) VALUES (${options.projectId}, ${safeTitle + ".mp4"}, ${concatResult.filePath}, ${driveUrl || null}, ${"video"}, ${concatResult.sizeBytes || 0}, ${"mpeg-engine-parallel"})`);
    } catch {}
  }

  if (options.emailTo && driveUrl) {
    try {
      const { executeTool } = await import("./tools");
      await executeTool("send_email", {
        to: options.emailTo,
        subject: `Your video is ready: ${options.title}`,
        text: `Your video "${options.title}" has been produced using parallel chapter rendering.\n\nChapters: ${chapters.length}\nTotal scenes: ${totalScenes}\n\nWatch/download: ${driveUrl}\n\n— VisionClaw MPEG Engine (Parallel)`,
        _tenantId: options.tenantId,
      }, options.tenantId);
      steps.push(`Email sent to ${options.emailTo}`);
    } catch {}
  }

  for (const cr of successChapters) {
    try { if (cr.result.filePath) fs.unlinkSync(cr.result.filePath); } catch {}
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  const finalDuration = probeDuration(concatResult.filePath);
  const finalSize = fs.statSync(concatResult.filePath).size;
  steps.push(`PARALLEL production complete: ${finalDuration.toFixed(1)}s video in ${totalTime}s (${chapters.length} chapters, ${successChapters.length} succeeded)`);
  console.log(`[mpeg-parallel] DONE: ${finalDuration.toFixed(1)}s video, ${(finalSize / 1024 / 1024).toFixed(1)}MB, ${chapters.length} chapters in ${totalTime}s`);

  return {
    success: true,
    filePath: concatResult.filePath,
    driveUrl,
    durationSeconds: finalDuration,
    sizeBytes: finalSize,
    scenesProcessed: successChapters.reduce((s, cr) => s + cr.result.scenesProcessed, 0),
    steps,
  };

  } catch (unexpectedErr: any) {
    console.error(`[mpeg-parallel] Unexpected error — cleaning up chapter files: ${unexpectedErr.message?.slice(0, 200)}`);
    cleanupAllChapters();
    return { success: false, scenesProcessed: 0, steps: [...steps, `Unexpected error: ${unexpectedErr.message?.slice(0, 150)}`], error: unexpectedErr.message };
  }
}
