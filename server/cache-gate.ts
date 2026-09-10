/**
 * cache-gate.ts — gate-before-compress pre-flight cache for expensive API calls
 *
 * Pattern (R63.7, inspired by Claw Compactor's gate-before-compress design):
 * Every expensive call (image gen, TTS, code review) checks a content-hash
 * keyed file-system cache BEFORE making the call. Cache hit → ~1ms, $0.
 * Cache miss → call API normally, cache the result.
 *
 * Safety: file-system only (no DB), keyed on SHA256 of normalized input,
 * fully isolated under .api-cache/ which is gitignored. Cache miss is the
 * default — the cache exists to save money on REPEATED identical calls
 * (template iteration, retries, regenerated scenes, etc).
 *
 * Used by:
 *   - server/replit_integrations/image/client.ts → generateImage()
 *   - server/voice.ts                            → synthesizeSpeech()
 *
 * Stats: GET /api/cache/stats returns hit/miss/savings counters.
 */

import { promises as fs } from "fs";
import * as path from "path";
import * as crypto from "crypto";

const CACHE_ROOT = path.join(process.cwd(), ".api-cache");

// Per-namespace approximate cost-per-call (USD). Used for savings estimates.
// Conservative numbers — better to under-claim savings than over-claim.
const COST_PER_CALL_USD: Record<string, number> = {
  "images-gemini":   0.039,   // Gemini 2.5 Flash Image
  "images-dalle":    0.040,   // DALL-E 3 standard 1792x1024
  "tts-openai":      0.015,   // gpt-4o-mini-tts ~ $15/1M chars (avg 1K char call)
  "tts-elevenlabs":  0.300,   // ElevenLabs ~ $0.30 per 1K chars (Creator plan)
  "tts-edge":        0.000,   // Google translate_tts is free
  "default":         0.010,
};

interface CacheStats {
  hits: number;
  misses: number;
  savedUsd: number;
  byNamespace: Record<string, { hits: number; misses: number; savedUsd: number }>;
}

const stats: CacheStats = {
  hits: 0,
  misses: 0,
  savedUsd: 0,
  byNamespace: {},
};

function bumpStat(ns: string, kind: "hit" | "miss") {
  if (!stats.byNamespace[ns]) {
    stats.byNamespace[ns] = { hits: 0, misses: 0, savedUsd: 0 };
  }
  if (kind === "hit") {
    stats.hits++;
    stats.byNamespace[ns].hits++;
    const saving = COST_PER_CALL_USD[ns] ?? COST_PER_CALL_USD.default;
    stats.savedUsd += saving;
    stats.byNamespace[ns].savedUsd += saving;
  } else {
    stats.misses++;
    stats.byNamespace[ns].misses++;
  }
}

export function getCacheStats(): CacheStats {
  return JSON.parse(JSON.stringify(stats));
}

export function resetCacheStats(): void {
  stats.hits = 0;
  stats.misses = 0;
  stats.savedUsd = 0;
  stats.byNamespace = {};
}

function hashKey(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 32);
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/**
 * Cache a string-returning call. Used for generateImage (returns data: URL).
 *
 * @param namespace cost-tracking bucket (e.g. "images-gemini", "tts-openai")
 * @param keyInput  raw input that fully determines the output (e.g. prompt)
 * @param fn        the expensive call to make on miss
 * @returns the cached or freshly-computed value
 */
export async function cachedString(
  namespace: string,
  keyInput: string,
  fn: () => Promise<string>,
): Promise<string> {
  if (process.env.CACHE_GATE_DISABLED === "1") {
    bumpStat(namespace, "miss");
    return fn();
  }
  const dir = path.join(CACHE_ROOT, namespace);
  const file = path.join(dir, hashKey(keyInput) + ".txt");
  try {
    const cached = await fs.readFile(file, "utf8");
    bumpStat(namespace, "hit");
    console.log(`[cache-gate] HIT  ${namespace} (~$${(COST_PER_CALL_USD[namespace] ?? COST_PER_CALL_USD.default).toFixed(3)} saved)`);
    return cached;
  } catch {
    bumpStat(namespace, "miss");
    const result = await fn();
    try {
      await ensureDir(dir);
      await fs.writeFile(file, result, "utf8");
    } catch (writeErr: any) {
      console.warn(`[cache-gate] write fail ${namespace}: ${writeErr?.message?.slice(0, 80)}`);
    }
    return result;
  }
}

/**
 * Cache a Buffer-returning call. Used for synthesizeSpeech (returns audio bytes).
 *
 * @param namespace cost-tracking bucket
 * @param keyInput  raw input that fully determines the output
 * @param fn        the expensive call to make on miss
 * @returns the cached or freshly-computed buffer + sidecar metadata
 */
export async function cachedBuffer<M extends Record<string, any>>(
  namespace: string,
  keyInput: string,
  fn: () => Promise<{ buffer: Buffer; meta: M }>,
): Promise<{ buffer: Buffer; meta: M }> {
  if (process.env.CACHE_GATE_DISABLED === "1") {
    bumpStat(namespace, "miss");
    return fn();
  }
  const dir = path.join(CACHE_ROOT, namespace);
  const hash = hashKey(keyInput);
  const binFile = path.join(dir, hash + ".bin");
  const metaFile = path.join(dir, hash + ".meta.json");
  try {
    const [buf, metaText] = await Promise.all([
      fs.readFile(binFile),
      fs.readFile(metaFile, "utf8"),
    ]);
    bumpStat(namespace, "hit");
    console.log(`[cache-gate] HIT  ${namespace} (~$${(COST_PER_CALL_USD[namespace] ?? COST_PER_CALL_USD.default).toFixed(3)} saved)`);
    return { buffer: buf, meta: JSON.parse(metaText) as M };
  } catch {
    bumpStat(namespace, "miss");
    const result = await fn();
    try {
      await ensureDir(dir);
      await Promise.all([
        fs.writeFile(binFile, result.buffer),
        fs.writeFile(metaFile, JSON.stringify(result.meta), "utf8"),
      ]);
    } catch (writeErr: any) {
      console.warn(`[cache-gate] write fail ${namespace}: ${writeErr?.message?.slice(0, 80)}`);
    }
    return result;
  }
}

/**
 * Manual eviction (mostly for tests/admin). Clears one namespace.
 */
export async function clearNamespace(namespace: string): Promise<{ cleared: number }> {
  const dir = path.join(CACHE_ROOT, namespace);
  try {
    const files = await fs.readdir(dir);
    await Promise.all(files.map(f => fs.unlink(path.join(dir, f)).catch(() => {})));
    return { cleared: files.length };
  } catch {
    return { cleared: 0 };
  }
}
