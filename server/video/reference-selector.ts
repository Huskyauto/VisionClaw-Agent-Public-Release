/**
 * R99 — Felix Visual Continuity (ViMax nugget #1, second half)
 *
 * For a given target frame description, pick the ≤8 most-relevant references
 * from the pool (tenant portraits + recent prior frames in this job) AND write
 * the explicit prompt prefix that names them ("Image 0 = bob's face, Image 2 =
 * the gym, generate a new image where bob is doing X..."). This is what tells
 * gpt-image-2 to actually use the references instead of inventing fresh.
 */
import { db } from "../db";
import { characterPortraitRegistry, videoJobFramePool, type CharacterPortrait, type VideoJobFrame } from "@shared/schema";
import { and, desc, eq } from "drizzle-orm";
import { logSilentCatch } from "../lib/silent-catch";

const REFERENCE_MAX_DEFAULT = 8;
const RECENT_FRAMES_WINDOW = 12;

export interface SelectedReferences {
  indices: number[];
  imagePaths: string[];
  promptPrefix: string;
  refDescriptions: string[];
  source: "llm" | "recency_fallback" | "none";
}

export async function logFrame(args: {
  tenantId: number;
  jobId: string;
  frameIdx: number;
  imagePath: string;
  description?: string;
}): Promise<void> {
  const { tenantId, jobId, frameIdx, imagePath, description } = args;
  if (!Number.isInteger(tenantId) || tenantId < 1) return;
  if (!jobId || !imagePath) return;
  try {
    await db.insert(videoJobFramePool).values({
      tenantId,
      jobId,
      frameIdx,
      imagePath,
      description: description || "",
    });
  } catch (err: any) {
    logSilentCatch("server/video/reference-selector.ts:logFrame", err);
  }
}

export async function listFrames(args: { tenantId: number; jobId: string; limit?: number }): Promise<VideoJobFrame[]> {
  const { tenantId, jobId } = args;
  const lim = Math.min(50, Math.max(1, args.limit || RECENT_FRAMES_WINDOW));
  return await db
    .select()
    .from(videoJobFramePool)
    .where(and(eq(videoJobFramePool.tenantId, tenantId), eq(videoJobFramePool.jobId, jobId)))
    .orderBy(desc(videoJobFramePool.frameIdx))
    .limit(lim);
}

export async function selectReferencesForFrame(args: {
  tenantId: number;
  jobId: string;
  frameDescription: string;
  maxReferences?: number;
}): Promise<SelectedReferences> {
  const tenantId = args.tenantId;
  const jobId = args.jobId || "";
  const frameDescription = args.frameDescription || "";
  const maxRefs = Math.min(8, Math.max(1, args.maxReferences || REFERENCE_MAX_DEFAULT));

  const portraits: CharacterPortrait[] = await db
    .select()
    .from(characterPortraitRegistry)
    .where(eq(characterPortraitRegistry.tenantId, tenantId));

  const recent: VideoJobFrame[] = jobId
    ? await listFrames({ tenantId, jobId, limit: RECENT_FRAMES_WINDOW })
    : [];

  // Build the candidate pool. Portraits always come first (they are anchors),
  // then recent frames in reverse-chronological order so the most recent are
  // earliest in the list (= LLM has them in front).
  const pool: { kind: "portrait" | "frame"; identifier: string; view?: string; description: string; imagePath: string }[] = [];
  for (const p of portraits) {
    pool.push({ kind: "portrait", identifier: p.identifier, view: p.view, description: p.description || "", imagePath: p.imagePath });
  }
  for (const f of recent) {
    pool.push({ kind: "frame", identifier: `frame_${f.frameIdx}`, description: f.description || "", imagePath: f.imagePath });
  }

  if (pool.length === 0) {
    return { indices: [], imagePaths: [], promptPrefix: "", refDescriptions: [], source: "none" };
  }

  // Recency-fallback selection: take all portraits + most recent frames up to maxRefs.
  // Used both as the LLM-skip fallback AND as the deterministic answer when no
  // frame description is provided.
  const recencyPick = (): SelectedReferences => {
    const picked = pool.slice(0, maxRefs);
    const promptPrefix = buildPromptPrefix(picked, frameDescription);
    return {
      indices: picked.map((_, i) => i),
      imagePaths: picked.map(p => p.imagePath),
      promptPrefix,
      refDescriptions: picked.map(p => `${p.identifier}${p.view ? `(${p.view})` : ""}: ${p.description || "(no description)"}`),
      source: "recency_fallback",
    };
  };

  if (!frameDescription.trim()) return recencyPick();

  // LLM selection: ask gpt-5-mini to pick the indices most relevant to the
  // target frame description. Single short call; on any failure fall back to
  // recency.
  try {
    const { runLlmTask } = await import("../llm-task");
    const poolListing = pool.map((p, i) => `[${i}] ${p.kind} ${p.identifier}${p.view ? `(${p.view})` : ""}: ${p.description || "(no description)"}`).join("\n");
    const prompt = `You are picking visual references for an AI image generator. Given this candidate pool:

${poolListing}

The next frame to generate: "${frameDescription}"

Pick up to ${maxRefs} indices from the pool that are MOST RELEVANT to generating this next frame. Prefer portraits of any character that appears in the description, plus 2-3 most recent frames that establish the visual continuity (location, lighting, costume). Return STRICT JSON only: {"indices":[<int>, ...]}`;

    const resp = await runLlmTask({
      model: "gpt-5-mini",
      prompt,
      maxTokens: 200,
      timeoutMs: 8000,
      tenantId,
      schema: { type: "object", properties: { indices: { type: "array" } }, required: ["indices"] },
    });

    if (!resp.success) return recencyPick();
    const parsed: any = resp.json || {};
    const idxList: number[] = Array.isArray(parsed?.indices) ? parsed.indices : [];
    const valid = idxList
      .filter(n => Number.isInteger(n) && n >= 0 && n < pool.length)
      .filter((n, i, self) => self.indexOf(n) === i)
      .slice(0, maxRefs);

    if (valid.length === 0) return recencyPick();

    const picked = valid.map(i => pool[i]);
    return {
      indices: valid,
      imagePaths: picked.map(p => p.imagePath),
      promptPrefix: buildPromptPrefix(picked, frameDescription),
      refDescriptions: picked.map(p => `${p.identifier}${p.view ? `(${p.view})` : ""}: ${p.description || "(no description)"}`),
      source: "llm",
    };
  } catch (err: any) {
    logSilentCatch("server/video/reference-selector.ts:selectReferencesForFrame:llm", err);
    return recencyPick();
  }
}

function buildPromptPrefix(picked: { kind: string; identifier: string; view?: string; description: string }[], targetDesc: string): string {
  if (picked.length === 0) return "";
  const lines = picked.map((p, i) => {
    const tag = p.kind === "portrait"
      ? `${p.identifier}${p.view ? ` (${p.view} view)` : ""}`
      : `prior frame ${p.identifier}`;
    const desc = p.description ? `: ${p.description.slice(0, 200)}` : "";
    return `Image ${i} = ${tag}${desc}`;
  });
  return `Use the provided reference images for visual consistency:\n${lines.join("\n")}\n\nGenerate a new image consistent with those references where: ${targetDesc}`;
}
