// ─────────────────────────────────────────────────────────────────────────────
// R90 — Auxiliary cheap-model client (ported from Hermes Alpha auxiliary_client.py)
// ─────────────────────────────────────────────────────────────────────────────
// Keep the expensive primary model for what the user is actually trying to do.
// Side tasks (context compression, web extraction, vision OCR, summarization)
// run on a cheap/fast model resolved by task type.
//
// Per-task overrides via env:
//   VISIONCLAW_AUX_COMPRESSION_MODEL=gemini-3-flash-preview
//   VISIONCLAW_AUX_WEB_EXTRACT_MODEL=glm-4.5-air:free
//   VISIONCLAW_AUX_VISION_MODEL=xiaomi/mimo-v2-omni
// Falls back to a default cheap chain if the override isn't available.
// ─────────────────────────────────────────────────────────────────────────────

import { getClientForModel, getAvailableModels } from "./providers";

export type AuxiliaryTask =
  | "compression"
  | "web_extract"
  | "vision"
  | "summarization"
  | "classification"
  | "general";

const DEFAULT_CHAINS: Record<AuxiliaryTask, string[]> = {
  compression: [
    "gemini-3-flash-preview",
    "z-ai/glm-4.5-air:free",
    "deepseek/deepseek-v4-flash",
    "gemini-2.5-flash",
  ],
  web_extract: [
    "z-ai/glm-4.5-air:free",
    "gemini-3-flash-preview",
    "deepseek/deepseek-v4-flash",
  ],
  vision: [
    "xiaomi/mimo-v2-omni",
    "gemini-3-flash-preview",
    "gemini-2.5-flash",
  ],
  summarization: [
    "gemini-3-flash-preview",
    "z-ai/glm-4.5-air:free",
    "deepseek/deepseek-v4-flash",
  ],
  classification: [
    "z-ai/glm-4.5-air:free",
    "gemini-3-flash-preview",
    "deepseek/deepseek-v4-flash",
  ],
  general: [
    "gemini-3-flash-preview",
    "z-ai/glm-4.5-air:free",
    "deepseek/deepseek-v4-flash",
    "gemini-2.5-flash",
  ],
};

const ENV_OVERRIDE_KEY: Record<AuxiliaryTask, string> = {
  compression: "VISIONCLAW_AUX_COMPRESSION_MODEL",
  web_extract: "VISIONCLAW_AUX_WEB_EXTRACT_MODEL",
  vision: "VISIONCLAW_AUX_VISION_MODEL",
  summarization: "VISIONCLAW_AUX_SUMMARIZATION_MODEL",
  classification: "VISIONCLAW_AUX_CLASSIFICATION_MODEL",
  general: "VISIONCLAW_AUX_GENERAL_MODEL",
};

export interface AuxiliaryCallOpts {
  task: AuxiliaryTask;
  messages: Array<{ role: string; content: any }>;
  model?: string;                // explicit override
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  tenantId?: number;
}

export interface AuxiliaryResult {
  content: string;
  modelUsed: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  durationMs: number;
}

async function resolveChain(task: AuxiliaryTask, explicit?: string): Promise<string[]> {
  const envOverride = process.env[ENV_OVERRIDE_KEY[task]];
  const candidates: string[] = [];
  if (explicit) candidates.push(explicit);
  if (envOverride) candidates.push(envOverride);
  candidates.push(...DEFAULT_CHAINS[task]);

  const available = await getAvailableModels();
  const availableIds = new Set(available.map((m) => m.id));
  return candidates.filter((id, i, arr) => arr.indexOf(id) === i && availableIds.has(id));
}

export async function callAuxiliary(opts: AuxiliaryCallOpts): Promise<AuxiliaryResult> {
  const start = Date.now();
  const chain = await resolveChain(opts.task, opts.model);

  if (chain.length === 0) {
    throw new Error(
      `[auxiliary-client] No available auxiliary model for task=${opts.task}. ` +
      `Tried: ${[opts.model, process.env[ENV_OVERRIDE_KEY[opts.task]], ...DEFAULT_CHAINS[opts.task]].filter(Boolean).join(", ")}`,
    );
  }

  let lastErr: any = null;
  for (const modelId of chain) {
    try {
      const { client, actualModelId } = await getClientForModel(modelId, opts.tenantId);
      const completion = await client.chat.completions.create({
        model: actualModelId,
        messages: opts.messages as any,
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.maxTokens ?? 2048,
      });
      const content = completion.choices?.[0]?.message?.content || "";
      return {
        content,
        modelUsed: actualModelId,
        usage: completion.usage as any,
        durationMs: Date.now() - start,
      };
    } catch (e: any) {
      lastErr = e;
      console.warn(`[auxiliary-client] task=${opts.task} model=${modelId} failed: ${e?.message?.slice(0, 120)}`);
    }
  }

  throw new Error(
    `[auxiliary-client] All models failed for task=${opts.task}. Last error: ${lastErr?.message || lastErr}`,
  );
}
