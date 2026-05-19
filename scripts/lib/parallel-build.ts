/**
 * Parallel build helper — chunk-and-parallel pattern for any job that risks
 * blowing the subagent StartToClose timeout (~10–15 min on Replit's Temporal).
 *
 * Use this whenever a job's wall-clock work would exceed the budget of a
 * single subagent. The helper:
 *   1. Chunks an input array into N batches sized to fit comfortably.
 *   2. Generates a per-chunk task brief for each batch.
 *   3. Returns the list of briefs ready to fire as parallel subagents.
 *   4. Provides a stitch-task brief that assembles the per-chunk artifacts.
 *
 * The actual subagent firing still happens via `startAsyncSubagent` from the
 * agent runtime — this module only generates the briefs and bookkeeping.
 *
 * Why this exists: Replit's subagent runner has a hard StartToClose timeout
 * around 10–15 minutes. Any job that takes longer (long videos, multi-section
 * PDFs, large image batches, podcast episodes, etc.) MUST be split. This is a
 * platform constraint, not a code constraint — fighting it wastes wall clock.
 */

export interface ChunkOptions<T> {
  /** Items to split (scenes, sections, pages, etc.) */
  items: T[];
  /** Target items per chunk. Pick a number where one chunk fits in ~5 min. */
  chunkSize: number;
  /** Friendly job name (used in task IDs and stitch brief) */
  jobName: string;
  /** Where each chunk's intermediate artifact should be written */
  artifactPathFor: (chunkIndex: number) => string;
  /** Where the final stitched artifact should be written */
  finalArtifactPath: string;
  /** Builds the per-chunk subagent task brief (must include item details inline so the subagent doesn't need to re-read state) */
  chunkTaskBrief: (chunkItems: T[], chunkIndex: number, totalChunks: number, artifactPath: string) => string;
  /** Builds the final stitch subagent task brief */
  stitchTaskBrief: (chunkArtifacts: string[], finalPath: string) => string;
}

export interface BuildPlan {
  jobName: string;
  totalChunks: number;
  chunkBriefs: { taskId: string; brief: string; artifactPath: string }[];
  stitchBrief: { taskId: string; brief: string; artifactPath: string };
}

/**
 * Build a chunk-and-parallel plan. The caller fires `chunkBriefs[].brief`
 * via N parallel `startAsyncSubagent` calls, waits for all of them with
 * `wait_for_background_tasks`, then fires `stitchBrief.brief` as a final
 * (much shorter) subagent.
 */
export function planParallelBuild<T>(opts: ChunkOptions<T>): BuildPlan {
  const chunks: T[][] = [];
  for (let i = 0; i < opts.items.length; i += opts.chunkSize) {
    chunks.push(opts.items.slice(i, i + opts.chunkSize));
  }
  const total = chunks.length;
  const chunkBriefs = chunks.map((items, idx) => {
    const artifactPath = opts.artifactPathFor(idx);
    return {
      taskId: `${opts.jobName}-chunk-${idx + 1}-of-${total}`,
      artifactPath,
      brief: opts.chunkTaskBrief(items, idx, total, artifactPath),
    };
  });
  const chunkArtifacts = chunkBriefs.map((c) => c.artifactPath);
  const stitchBrief = {
    taskId: `${opts.jobName}-stitch`,
    artifactPath: opts.finalArtifactPath,
    brief: opts.stitchTaskBrief(chunkArtifacts, opts.finalArtifactPath),
  };
  return { jobName: opts.jobName, totalChunks: total, chunkBriefs, stitchBrief };
}

/* ──────── R106 N2 — Findings-bus client helpers (LuaN1aoAgent, Apache-2.0) ────────
 * Lightweight HTTP-free helpers chunk subagents call to share findings mid-
 * flight via the parallel_job_findings table. No new imports — the chunk-
 * subagent calls these by way of the `findings_publish` / `findings_read`
 * tools (server/tools.ts), so this section is documentation + naming
 * convention only. Each chunk gets a stable subtaskId built from jobName +
 * chunk index that callers should reuse on every publish/read.
 */
export function makeFindingsContext(jobName: string, chunkIndex: number, totalChunks: number): {
  jobId: string;
  subtaskId: string;
  totalChunks: number;
} {
  return {
    jobId: jobName,
    subtaskId: `${jobName}-chunk-${chunkIndex + 1}-of-${totalChunks}`,
    totalChunks,
  };
}

/** Inline brief snippet a stitch caller can append into chunk briefs so the
 * subagent KNOWS to publish high-confidence discoveries to siblings. */
export function findingsBusBriefSnippet(jobId: string, subtaskId: string): string {
  return `\n\nFINDINGS BUS (R106 N2): you and your sibling chunks share a bulletin board. Job: ${jobId}, your subtask: ${subtaskId}.\n` +
    `- At the top of each iteration call \`findings_read\` with job_id="${jobId}", caller_subtask_id="${subtaskId}", since_id=<last id you saw>. If a sibling has confirmed a working format, asset, or fix, USE IT instead of re-discovering.\n` +
    `- When YOU discover something high-confidence (working brand prompt, validated asset URL, ruled-out approach), call \`findings_publish\` with confidence ≥0.7 so siblings can pick it up.\n` +
    `- Anything <0.6 confidence is filtered as scratch noise and won't be visible to siblings.`;
}

/* ─────────────────────────── PRESET: VIDEO ─────────────────────────── */

export interface VideoScene {
  narration: string;
  imagePrompt?: string;
  imagePath?: string;
}

/**
 * Convenience preset for video production. Each chunk gets rendered to its
 * own MP4 via mpeg_produce_parallel; the stitch step concats them with
 * mpeg_concat. Recommended chunkSize: 3–5 scenes (each chunk renders in
 * ~3–5 min on typical content).
 *
 * IMAGE QUALITY: scenes with imagePrompt (no imagePath) MUST be pre-baked
 * via the internal `generate_image` tool with purpose:"customer_video_scene"
 * so they hit gpt-image-2. The sandbox generateImage callback uses Replit's
 * default routing which is not guaranteed. Pre-bake then pass imagePath.
 */
export function planVideoBuild(args: {
  scenes: VideoScene[];
  jobName: string;
  outputDir: string;
  finalMp4: string;
  chunkSize?: number;
  channelContext?: string;
}): BuildPlan {
  const unbakedScenes = args.scenes.filter((s) => !s.imagePath);
  if (unbakedScenes.length > 0) {
    console.warn(
      `[planVideoBuild] WARNING: ${unbakedScenes.length}/${args.scenes.length} scenes have no imagePath. ` +
        `Pre-bake them via generate_image with purpose:"customer_video_scene" to guarantee gpt-image-2 quality. ` +
        `Falling back to in-mpeg image gen of unknown routing.`,
    );
  }
  const channelLine = args.channelContext ? `\nCONTEXT: ${args.channelContext}\n` : "";
  return planParallelBuild<VideoScene>({
    items: args.scenes,
    chunkSize: args.chunkSize ?? 4,
    jobName: args.jobName,
    artifactPathFor: (i) => `${args.outputDir}/${args.jobName}-part-${i + 1}.mp4`,
    finalArtifactPath: args.finalMp4,
    chunkTaskBrief: (items, idx, total, artifactPath) => {
      const sceneBlocks = items
        .map(
          (s, j) =>
            `Scene ${j + 1}:\nnarration: "${s.narration.replace(/"/g, '\\"')}"\n${s.imagePath ? `imagePath: "${s.imagePath}"` : `imagePrompt: "${(s.imagePrompt || "").replace(/"/g, '\\"')}"`}`
        )
        .join("\n\n");
      return `Render part ${idx + 1} of ${total} for ${args.jobName}.${channelLine}
Use mpeg_produce_parallel with the ${items.length} scenes below. Settings: crossfadeMs:0, no introText/outroText. Output to ${artifactPath}.

${sceneBlocks}

When the MP4 is on disk, exit. Do NOT upload, do NOT email, do NOT register in DB — those happen after the stitch step.`;
    },
    stitchTaskBrief: (parts, final) => `Concat ${parts.length} MP4 parts into ${final} for ${args.jobName}.${channelLine}
Use mpeg_concat with these parts in order:
${parts.map((p, i) => `  ${i + 1}. ${p}`).join("\n")}

Output: ${final}

After the final MP4 exists, INSERT into project_files (caller will tell you which project_id, file_type 'video/mp4', file_size from fs.statSync, uploaded_by 'Felix Subagent') and email a one-paragraph completion summary. Then exit.`,
  });
}
