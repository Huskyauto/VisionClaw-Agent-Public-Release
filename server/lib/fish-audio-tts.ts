const FISH_AUDIO_BASE = "https://api.fish.audio";

import { logSilentCatch } from "./silent-catch";

export const FISH_DEFAULT_MODEL = "s2-pro";

const OPENAI_TO_FISH_REFERENCE: Record<string, string | undefined> = {
  onyx: process.env.FISH_VOICE_ONYX,
  alloy: process.env.FISH_VOICE_ALLOY,
  echo: process.env.FISH_VOICE_ECHO,
  fable: process.env.FISH_VOICE_FABLE,
  nova: process.env.FISH_VOICE_NOVA,
  shimmer: process.env.FISH_VOICE_SHIMMER,
};

export interface FishTtsOptions {
  voice?: string;
  model?: "s1" | "s2-pro";
  format?: "mp3" | "wav" | "opus";
  bitrate?: 64 | 128 | 192;
  speed?: number;
  timeoutMs?: number;
  /**
   * Brand-voice lock. When true, an empty/unknown voice must NOT silently
   * resolve to the generic onyx clone — synthesis throws instead, so the caller
   * fails loud rather than shipping a wrong-voice render. (This closes the
   * mid-narration voice-switch footgun where a lost voice param became onyx and
   * Fish "succeeded," so the strictVoice failure path never tripped.)
   */
  strictVoice?: boolean;
}

export interface FishTtsResult {
  buffer: Buffer;
  format: "mp3" | "wav" | "opus";
  modelUsed: string;
  referenceUsed?: string;
  bytes: number;
}

export function isFishFallbackEligibleError(msg: string): boolean {
  if (!msg) return false;
  const m = msg.toLowerCase();
  return m.includes("429") || m.includes("rate limit") || m.includes("rate-limit") || m.includes("rate_limit") ||
    m.includes("quota") || m.includes("too many requests") || m.includes("overload") ||
    m.includes("temporarily unavailable") || m.includes("service unavailable") ||
    / 5\d\d/.test(m) || m.includes("etimedout") || m.includes("econnreset");
}

function resolveFishReferenceId(voice: string | undefined | null, strict = false): string | undefined {
  // If caller passed a Fish model id directly (24- or 32-hex; Fish uses both
  // mongodb-objectid-style 24-char and 32-char model ids), pass it through.
  if (voice && (/^[a-f0-9]{24}$/i.test(voice) || /^[a-f0-9]{32}$/i.test(voice))) return voice;
  if (voice && /^fish:/i.test(voice)) return voice.replace(/^fish:/i, "");
  if (voice) {
    const mapped = OPENAI_TO_FISH_REFERENCE[voice.toLowerCase()];
    if (mapped) return mapped;
  }
  // Unresolved: voice was empty or unrecognized. Under strict brand-voice mode we
  // MUST NOT silently fall back to the generic onyx clone — return undefined so
  // the caller throws rather than rendering in the wrong voice.
  if (strict) return undefined;
  return process.env.FISH_VOICE_ONYX || undefined;
}

export async function synthesizeFishAudio(text: string, opts: FishTtsOptions = {}): Promise<FishTtsResult> {
  const apiKey = process.env.FISH_AUDIO_API_KEY;
  if (!apiKey) throw new Error("FISH_AUDIO_API_KEY not configured");

  const trimmed = (text || "").trim();
  if (!trimmed) throw new Error("Fish Audio TTS: empty text");

  const model = opts.model || FISH_DEFAULT_MODEL;
  const format = opts.format || "mp3";
  const bitrate = opts.bitrate || 128;
  const timeoutMs = opts.timeoutMs || 90000;
  const referenceId = resolveFishReferenceId(opts.voice, opts.strictVoice === true);
  if (opts.strictVoice && !referenceId) {
    throw new Error(
      `Fish Audio TTS: strictVoice set but voice "${opts.voice ?? ""}" did not resolve to an explicit ` +
        `reference id (refusing to fall back to the generic onyx clone)`,
    );
  }

  const body: Record<string, any> = {
    text: trimmed,
    format,
    sample_rate: format === "mp3" ? 44100 : (format === "opus" ? 48000 : 44100),
    normalize: true,
    latency: "normal",
    chunk_length: 300,
    prosody: { speed: opts.speed ?? 1, volume: 0, normalize_loudness: true },
  };
  if (format === "mp3") body.mp3_bitrate = bitrate;
  if (referenceId) body.reference_id = referenceId;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${FISH_AUDIO_BASE}/v1/tts`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "model": model,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e: any) {
    clearTimeout(timer);
    if (e.name === "AbortError") throw new Error(`Fish Audio TTS: timeout after ${timeoutMs}ms`);
    throw new Error(`Fish Audio TTS: network error — ${e.message}`);
  }
  clearTimeout(timer);

  if (!res.ok) {
    let errBody = "";
    try { errBody = (await res.text()).slice(0, 300); } catch (_silentErr) { logSilentCatch("server/lib/fish-audio-tts.ts", _silentErr); }
    throw new Error(`Fish Audio TTS HTTP ${res.status}: ${errBody}`);
  }

  const ab = await res.arrayBuffer();
  const buffer = Buffer.from(ab);
  if (buffer.length < 200) {
    throw new Error(`Fish Audio TTS: response too small (${buffer.length} bytes), likely a JSON error envelope`);
  }
  return { buffer, format, modelUsed: model, referenceUsed: referenceId, bytes: buffer.length };
}
