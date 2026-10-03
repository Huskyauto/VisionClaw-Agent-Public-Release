import fs from "fs";
import path from "path";

import { logSilentCatch } from "./lib/silent-catch";
const HF_ASR_MODEL = "microsoft/VibeVoice-ASR";

const GRADIO_ASR_ENDPOINT = "https://aka.ms/vibevoice-asr";

const MAX_AUDIO_SIZE = 100 * 1024 * 1024;
const ALLOWED_AUDIO_DIRS = ["/tmp", path.resolve(process.cwd(), "uploads"), path.resolve(process.cwd(), "project-assets"), path.resolve(process.cwd(), "data")];

function getHFToken(): string | undefined {
  return process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN;
}

function sanitizePath(filePath: string, allowedDirs: string[]): string | null {
  const resolved = path.resolve(filePath);
  if (resolved.includes("..")) return null;
  const isAllowed = allowedDirs.some(dir => resolved.startsWith(dir + path.sep) || resolved === dir);
  if (!isAllowed) return null;
  return resolved;
}

// R125+13.19+sec1 — architect HIGH-3: the local validateUrl() was missing
// DNS-rebinding resolution (host-string check only), missed cloud-metadata
// (169.254.169.254), IPv6 link-local (fe80::*), ULA (fc00::/7), and the
// 172.16.0.0/12 range (the .startsWith("172.") check matched 172.0–172.255).
// Routing through ssrfSafeFetchBytes (server/lib/ssrf-jail.ts) gives DNS-aware
// resolution + redirect refusal + body cap, matching the SSRF posture used by
// every other LLM-controlled fetch path in the platform.

export interface VibeVoiceASRResult {
  success: boolean;
  transcript?: string;
  speakers?: Array<{
    speaker: string;
    timestamp?: string;
    text: string;
  }>;
  language?: string;
  duration_seconds?: number;
  error?: string;
  provider: "vibevoice-asr";
}

export async function vibevoiceTranscribe(params: {
  audio_path?: string;
  audio_base64?: string;
  audio_url?: string;
  language?: string;
  hotwords?: string[];
  enable_diarization?: boolean;
  enable_timestamps?: boolean;
}): Promise<VibeVoiceASRResult> {
  try {
    let audioBuffer: Buffer;

    if (params.audio_path) {
      const safePath = sanitizePath(params.audio_path, ALLOWED_AUDIO_DIRS);
      if (!safePath) {
        return { success: false, error: "Audio path not allowed. Files must be in /tmp, uploads, project-assets, or data directories.", provider: "vibevoice-asr" };
      }
      if (!fs.existsSync(safePath)) {
        return { success: false, error: `Audio file not found: ${safePath}`, provider: "vibevoice-asr" };
      }
      audioBuffer = fs.readFileSync(safePath);
    } else if (params.audio_base64) {
      audioBuffer = Buffer.from(params.audio_base64, "base64");
    } else if (params.audio_url) {
      // R125+13.19+sec1 — route via DNS-aware SSRF jail (replaces local validateUrl).
      const { ssrfSafeFetchBytes } = await import("./lib/ssrf-jail");
      const fetched = await ssrfSafeFetchBytes(params.audio_url, {
        timeoutMs: 60000,
        maxBytes: MAX_AUDIO_SIZE,
        userAgent: "VisionClaw-VibeVoiceASR/1.0",
      });
      if (!fetched.ok) {
        return { success: false, error: `Audio URL rejected: ${fetched.reason}`, provider: "vibevoice-asr" };
      }
      audioBuffer = fetched.bytes;
    } else {
      return { success: false, error: "Provide audio_path, audio_base64, or audio_url", provider: "vibevoice-asr" };
    }

    if (audioBuffer.length > MAX_AUDIO_SIZE) {
      return { success: false, error: `Audio file too large (${Math.round(audioBuffer.length / 1024 / 1024)}MB). Maximum is ${MAX_AUDIO_SIZE / 1024 / 1024}MB.`, provider: "vibevoice-asr" };
    }

    const hfToken = getHFToken();

    const result = await transcribeViaHuggingFace(audioBuffer, {
      language: params.language,
      hotwords: params.hotwords,
      enableDiarization: params.enable_diarization !== false,
      enableTimestamps: params.enable_timestamps !== false,
      token: hfToken,
    });

    return result;
  } catch (err: any) {
    console.error("[vibevoice-asr] Transcription failed:", err.message);
    return { success: false, error: `VibeVoice ASR failed: ${err.message}`, provider: "vibevoice-asr" };
  }
}

async function transcribeViaHuggingFace(audioBuffer: Buffer, options: {
  language?: string;
  hotwords?: string[];
  enableDiarization?: boolean;
  enableTimestamps?: boolean;
  token?: string;
}): Promise<VibeVoiceASRResult> {
  const hfToken = options.token;

  const apiUrl = `https://router.huggingface.co/hf-inference/models/${HF_ASR_MODEL}`;

  const headers: Record<string, string> = {
    "Content-Type": "audio/wav",
  };
  if (hfToken) {
    headers["Authorization"] = `Bearer ${hfToken}`;
  }

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers,
      body: audioBuffer,
      signal: AbortSignal.timeout(120000),
    });

    if (response.ok) {
      const result = await response.json() as any;
      return parseHFASRResponse(result);
    }

    const errorText = await response.text();

    if (response.status === 503 || response.status === 429) {
      console.log("[vibevoice-asr] HF Inference API unavailable, trying Gradio endpoint...");
      return await transcribeViaGradio(audioBuffer, options);
    }

    if (response.status === 401 || response.status === 403) {
      console.log("[vibevoice-asr] HF auth issue, trying Gradio endpoint...");
      return await transcribeViaGradio(audioBuffer, options);
    }

    return { success: false, error: `HF API error (${response.status}): ${errorText}`, provider: "vibevoice-asr" };
  } catch (err: any) {
    if (err.name === "AbortError" || err.name === "TimeoutError") {
      return { success: false, error: "Transcription timed out (120s limit)", provider: "vibevoice-asr" };
    }
    console.log("[vibevoice-asr] HF API failed, trying Gradio endpoint...");
    return await transcribeViaGradio(audioBuffer, options);
  }
}

async function transcribeViaGradio(audioBuffer: Buffer, options: {
  language?: string;
  hotwords?: string[];
  enableDiarization?: boolean;
  enableTimestamps?: boolean;
}): Promise<VibeVoiceASRResult> {
  try {
    // @ts-ignore - @gradio/client types not bundled
    const { Client } = await import("@gradio/client");

    const client = await Client.connect(GRADIO_ASR_ENDPOINT, {
      hf_token: getHFToken() as any,
    });

    const tmpPath = `/tmp/vibevoice_input_${Date.now()}.wav`;
    fs.writeFileSync(tmpPath, audioBuffer);

    try {
      const blob = new Blob([audioBuffer], { type: "audio/wav" });

      const hotwordsStr = options.hotwords?.join(", ") || "";

      const result = await client.predict("/run", {
        audio: blob,
        hotwords: hotwordsStr,
      });

      const data = result.data as any;

      if (typeof data === "string" || (Array.isArray(data) && typeof data[0] === "string")) {
        const transcript = Array.isArray(data) ? data[0] : data;
        return parseStructuredTranscript(transcript);
      }

      return {
        success: true,
        transcript: JSON.stringify(data),
        provider: "vibevoice-asr",
      };
    } finally {
      try { fs.unlinkSync(tmpPath); } catch (_silentErr) { logSilentCatch("server/vibevoice.ts", _silentErr); }
    }
  } catch (err: any) {
    console.error("[vibevoice-asr] Gradio fallback failed:", err.message);
    return { success: false, error: `Gradio ASR failed: ${err.message}`, provider: "vibevoice-asr" };
  }
}

function parseHFASRResponse(result: any): VibeVoiceASRResult {
  if (typeof result === "string") {
    return parseStructuredTranscript(result);
  }

  if (result.text) {
    return {
      success: true,
      transcript: result.text,
      speakers: result.chunks?.map((c: any) => ({
        speaker: c.speaker || "unknown",
        timestamp: c.timestamp ? `${c.timestamp[0]}s-${c.timestamp[1]}s` : undefined,
        text: c.text,
      })),
      provider: "vibevoice-asr",
    };
  }

  if (Array.isArray(result)) {
    const transcript = result.map((r: any) => r.text || r).join(" ");
    return { success: true, transcript, provider: "vibevoice-asr" };
  }

  return { success: true, transcript: JSON.stringify(result), provider: "vibevoice-asr" };
}

function parseStructuredTranscript(raw: string): VibeVoiceASRResult {
  const speakers: Array<{ speaker: string; timestamp?: string; text: string }> = [];
  const lines = raw.split("\n").filter(l => l.trim());

  const speakerPattern = /\[?(Speaker\s*\d+|SPEAKER_\d+)\]?\s*[\[(]?([\d:.]+\s*[-–]\s*[\d:.]+)[\])]?\s*:?\s*(.*)/i;

  let hasStructure = false;
  for (const line of lines) {
    const match = line.match(speakerPattern);
    if (match) {
      hasStructure = true;
      speakers.push({
        speaker: match[1].trim(),
        timestamp: match[2].trim(),
        text: match[3].trim(),
      });
    }
  }

  return {
    success: true,
    transcript: raw,
    speakers: hasStructure ? speakers : undefined,
    provider: "vibevoice-asr",
  };
}

export function isVibeVoiceAvailable(): boolean {
  return true;
}

export const VIBEVOICE_ASR_INFO = {
  model: HF_ASR_MODEL,
  features: ["60-minute single-pass processing", "Speaker diarization (Who, When, What)", "50+ languages", "Custom hotwords", "Timestamped output"],
  maxDuration: "60 minutes",
  languages: "50+",
};
