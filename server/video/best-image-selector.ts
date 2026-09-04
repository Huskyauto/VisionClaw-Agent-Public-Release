/**
 * R99 — Felix Visual Continuity (ViMax nugget #2)
 *
 * Given N candidate images (typically 3-4), all generated for the same target
 * frame, plus the reference pool that was supposed to anchor them, ask a vision
 * LLM to grade each on three axes and pick the winner. Cost is N× the per-image
 * cost; gated to "hero" frames in the engine wiring.
 *
 * Grading axes (lifted from ViMax):
 *   - character_consistency  — does the character match the reference portraits
 *   - spatial_consistency    — does the environment match the prior frames
 *   - description_accuracy   — does the candidate depict what was asked
 */
import * as fs from "fs";
import { logSilentCatch } from "../lib/silent-catch";
import { isPathInAllowedRoots } from "../lib/image-ref-jail";

export interface BestImageScores {
  character_consistency: number; // 0-10
  spatial_consistency: number;   // 0-10
  description_accuracy: number;  // 0-10
}

export interface BestImageResult {
  winnerIndex: number;
  winnerPath: string;
  reason: string;
  scores: BestImageScores;
  source: "llm" | "first_fallback";
  perCandidate?: { index: number; path: string; scores: BestImageScores; total: number }[];
}

function fileToDataUrl(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const buf = fs.readFileSync(filePath);
    if (buf.length === 0 || buf.length > 12 * 1024 * 1024) return null;
    const ext = (filePath.split(".").pop() || "png").toLowerCase();
    const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch (err: any) {
    logSilentCatch("server/video/best-image-selector.ts:fileToDataUrl", err);
    return null;
  }
}

export async function selectBestImage(args: {
  candidates: string[];
  references?: string[];
  targetDescription: string;
  tenantId: number;
}): Promise<BestImageResult> {
  // R99.1 +sec hardening (post-review fix): vision LLM is a second exfiltration
  // sink — bytes get base64'd into the multimodal prompt. Apply the same path
  // jail as generate_social_image so a tenant who somehow registered a
  // sensitive path (e.g. via a future direct-DB write) can't smuggle it out
  // through the grader.
  const candidates = (args.candidates || []).filter(p => p && isPathInAllowedRoots(p) && fs.existsSync(p));
  const references = (args.references || []).filter(p => p && isPathInAllowedRoots(p) && fs.existsSync(p)).slice(0, 4);
  const candRejected = (args.candidates || []).length - candidates.length;
  const refRejected = (args.references || []).length - references.length;
  if (candRejected > 0 || refRejected > 0) {
    console.warn(`[best-image-selector] +sec: rejected ${candRejected} candidate(s) + ${refRejected} reference(s) outside allowed roots`);
  }
  const targetDescription = String(args.targetDescription || "").slice(0, 500);

  if (candidates.length === 0) {
    throw new Error("selectBestImage: no valid candidate paths");
  }

  // Single candidate is already the winner.
  if (candidates.length === 1) {
    return {
      winnerIndex: 0,
      winnerPath: candidates[0],
      reason: "only one candidate",
      scores: { character_consistency: 7, spatial_consistency: 7, description_accuracy: 7 },
      source: "first_fallback",
    };
  }

  const firstFallback = (reason: string): BestImageResult => ({
    winnerIndex: 0,
    winnerPath: candidates[0],
    reason: `fell back to first candidate: ${reason}`,
    scores: { character_consistency: 6, spatial_consistency: 6, description_accuracy: 6 },
    source: "first_fallback",
  });

  try {
    const { runLlmTask } = await import("../llm-task");
    const candDataUrls = candidates.map(fileToDataUrl).filter(Boolean) as string[];
    const refDataUrls = references.map(fileToDataUrl).filter(Boolean) as string[];

    if (candDataUrls.length !== candidates.length) return firstFallback("candidate file read failed");

    const refLine = refDataUrls.length > 0
      ? `The first ${refDataUrls.length} image(s) below are REFERENCE shots (the character/environment that the candidates should look consistent with). The next ${candDataUrls.length} image(s) are the CANDIDATES to grade (in order — index 0 is the first candidate).\n\n`
      : `The ${candDataUrls.length} image(s) below are the CANDIDATES to grade in order (index 0 is the first). There are no reference shots.\n\n`;

    const allImages = [...refDataUrls, ...candDataUrls];

    const prompt = `${refLine}Target frame description: "${targetDescription}"

Grade each CANDIDATE on three axes from 0 to 10:
  - character_consistency: how well the people in the candidate match the reference portraits (10 = same person, 0 = totally different; use 7 if no people)
  - spatial_consistency: how well the environment/lighting/composition matches the reference frames (10 = same world, 0 = totally different)
  - description_accuracy: how well the candidate depicts the target frame description (10 = exact, 0 = unrelated)

Return STRICT JSON only:
{"candidates":[{"index":0,"character_consistency":<0-10>,"spatial_consistency":<0-10>,"description_accuracy":<0-10>,"reason":"<short>"}, ...], "winner_index":<int>, "winner_reason":"<short>"}`;

    const resp = await runLlmTask({
      model: "gpt-5-mini",
      prompt,
      images: allImages,
      maxTokens: 600,
      timeoutMs: 15000,
      tenantId: args.tenantId,
    });

    if (!resp.success) return firstFallback(`LLM call failed: ${resp.error?.slice(0, 80)}`);
    const parsed: any = resp.json || {};

    const perCandidate: { index: number; path: string; scores: BestImageScores; total: number }[] = (parsed.candidates || []).map((c: any) => {
      const idx = Number.isInteger(c.index) ? c.index : -1;
      const cc = Math.max(0, Math.min(10, Number(c.character_consistency) || 0));
      const sc = Math.max(0, Math.min(10, Number(c.spatial_consistency) || 0));
      const da = Math.max(0, Math.min(10, Number(c.description_accuracy) || 0));
      return idx >= 0 && idx < candidates.length ? { index: idx, path: candidates[idx], scores: { character_consistency: cc, spatial_consistency: sc, description_accuracy: da }, total: cc + sc + da } : null;
    }).filter(Boolean);

    if (perCandidate.length === 0) return firstFallback("LLM grade list empty");

    let winnerIndex = Number.isInteger(parsed.winner_index) && parsed.winner_index >= 0 && parsed.winner_index < candidates.length
      ? parsed.winner_index
      : -1;

    if (winnerIndex < 0) {
      // Fallback: highest total score wins.
      const sorted = [...perCandidate].sort((a, b) => b.total - a.total);
      winnerIndex = sorted[0].index;
    }

    const winnerScores = perCandidate.find(c => c.index === winnerIndex)?.scores
      || { character_consistency: 7, spatial_consistency: 7, description_accuracy: 7 };

    return {
      winnerIndex,
      winnerPath: candidates[winnerIndex],
      reason: String(parsed.winner_reason || "").slice(0, 240) || "selected by total score",
      scores: winnerScores,
      source: "llm",
      perCandidate,
    };
  } catch (err: any) {
    logSilentCatch("server/video/best-image-selector.ts:selectBestImage", err);
    return firstFallback(String(err?.message || err).slice(0, 120));
  }
}
