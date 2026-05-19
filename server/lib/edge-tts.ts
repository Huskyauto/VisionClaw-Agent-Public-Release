import WebSocket from "ws";
import { logSilentCatch } from "./silent-catch";
import { createHash, randomUUID } from "crypto";

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const SEC_MS_GEC_VERSION = "1-130.0.2849.68";
const CHROMIUM_FULL_VERSION = "130.0.2849.68";
const CHROMIUM_MAJOR_VERSION = CHROMIUM_FULL_VERSION.split(".")[0];

// DRM token Microsoft started requiring on the anonymous read-aloud endpoint
// in early 2024. Algorithm reverse-engineered from the open-source `edge-tts`
// Python library (pure SHA-256 of windowed Win32 ticks + the public token).
function computeSecMsGec(): string {
  const winEpochOffsetSeconds = 11644473600; // 1601-01-01 → 1970-01-01
  const nowSec = Math.floor(Date.now() / 1000) + winEpochOffsetSeconds;
  // Round DOWN to the nearest 5-minute (300s) window.
  const windowedSec = nowSec - (nowSec % 300);
  // Win32 file-time ticks are 100ns intervals → multiply seconds by 1e7.
  const ticks = BigInt(windowedSec) * 10000000n;
  return createHash("sha256").update(`${ticks.toString()}${TRUSTED_CLIENT_TOKEN}`).digest("hex").toUpperCase();
}

function buildSynthUrl(connectionId: string): string {
  return `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&ConnectionId=${connectionId}`;
}

const OPENAI_TO_EDGE_VOICE: Record<string, string> = {
  onyx: "en-US-GuyNeural",
  alloy: "en-US-AndrewNeural",
  echo: "en-US-DavisNeural",
  fable: "en-GB-RyanNeural",
  nova: "en-US-JennyNeural",
  shimmer: "en-US-AvaNeural",
  ash: "en-US-EricNeural",
  coral: "en-US-EmmaNeural",
  sage: "en-US-MichelleNeural",
};

export const EDGE_DEFAULT_VOICE = "en-US-GuyNeural";

export function mapVoiceToEdge(voice: string | undefined | null): string {
  if (!voice) return EDGE_DEFAULT_VOICE;
  if (/^[a-z]{2}-[A-Z]{2}-[A-Za-z]+Neural$/.test(voice)) return voice;
  return OPENAI_TO_EDGE_VOICE[voice.toLowerCase()] || EDGE_DEFAULT_VOICE;
}

function escapeSsml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildSsml(text: string, voice: string, rate: string, pitch: string, volume: string): string {
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">` +
    `<voice name="${voice}">` +
    `<prosody rate="${rate}" pitch="${pitch}" volume="${volume}">${escapeSsml(text)}</prosody>` +
    `</voice></speak>`;
}

function nowDateString(): string {
  return new Date().toUTCString().replace(/GMT$/, "GMT+0000 (Coordinated Universal Time)");
}

export interface EdgeTtsOptions {
  voice?: string;
  rate?: string;
  pitch?: string;
  volume?: string;
  timeoutMs?: number;
}

export async function synthesizeEdgeTts(text: string, opts: EdgeTtsOptions = {}): Promise<Buffer> {
  const trimmed = (text || "").trim();
  if (!trimmed) throw new Error("Edge TTS: empty text");
  if (trimmed.length > 8000) throw new Error(`Edge TTS: text too long (${trimmed.length} > 8000 chars)`);

  const voice = mapVoiceToEdge(opts.voice);
  const rate = opts.rate || "+0%";
  const pitch = opts.pitch || "+0Hz";
  const volume = opts.volume || "+0%";
  const timeoutMs = opts.timeoutMs || 60000;

  const requestId = randomUUID().replace(/-/g, "");
  const ssml = buildSsml(trimmed, voice, rate, pitch, volume);

  return await new Promise<Buffer>((resolve, reject) => {
    const ws = new WebSocket(buildSynthUrl(requestId), {
      headers: {
        "Pragma": "no-cache",
        "Cache-Control": "no-cache",
        "Accept-Encoding": "gzip, deflate, br",
        "Accept-Language": "en-US,en;q=0.9",
        "Sec-MS-GEC": computeSecMsGec(),
        "Sec-MS-GEC-Version": SEC_MS_GEC_VERSION,
        "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_FULL_VERSION} Safari/537.36 Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
      },
    });

    const audioChunks: Buffer[] = [];
    let finished = false;
    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        try { ws.terminate(); } catch (_silentErr) { logSilentCatch("server/lib/edge-tts.ts", _silentErr); }
        reject(new Error(`Edge TTS: timeout after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    const finish = (err: Error | null, buf?: Buffer) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { ws.close(); } catch (_silentErr) { logSilentCatch("server/lib/edge-tts.ts", _silentErr); }
      if (err) reject(err); else resolve(buf!);
    };

    ws.on("open", () => {
      try {
        const configMsg =
          `X-Timestamp:${nowDateString()}\r\n` +
          `Content-Type:application/json; charset=utf-8\r\n` +
          `Path:speech.config\r\n\r\n` +
          `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`;
        ws.send(configMsg);

        const ssmlMsg =
          `X-RequestId:${requestId}\r\n` +
          `Content-Type:application/ssml+xml\r\n` +
          `X-Timestamp:${nowDateString()}\r\n` +
          `Path:ssml\r\n\r\n${ssml}`;
        ws.send(ssmlMsg);
      } catch (e: any) {
        finish(new Error(`Edge TTS: send failed — ${e.message}`));
      }
    });

    ws.on("message", (data: Buffer, isBinary: boolean) => {
      try {
        if (isBinary) {
          if (data.length < 2) return;
          const headerLen = data.readUInt16BE(0);
          if (headerLen + 2 > data.length) return;
          const audio = data.subarray(2 + headerLen);
          if (audio.length > 0) audioChunks.push(audio);
        } else {
          const msg = data.toString("utf-8");
          if (msg.includes("Path:turn.end")) {
            if (audioChunks.length === 0) {
              finish(new Error("Edge TTS: turn ended with zero audio bytes"));
            } else {
              finish(null, Buffer.concat(audioChunks));
            }
          }
        }
      } catch (e: any) {
        finish(new Error(`Edge TTS: message parse failed — ${e.message}`));
      }
    });

    ws.on("error", (err: Error) => finish(new Error(`Edge TTS: ws error — ${err.message}`)));
    ws.on("close", (code: number, reason: Buffer) => {
      if (!finished) finish(new Error(`Edge TTS: ws closed prematurely (code=${code}, reason=${reason?.toString().slice(0, 80) || "none"}, ${audioChunks.length} chunks)`));
    });
  });
}

export function isEdgeFallbackEligibleError(msg: string): boolean {
  if (!msg) return false;
  const m = msg.toLowerCase();
  return m.includes("429") || m.includes("rate limit") || m.includes("rate-limit") || m.includes("rate_limit") ||
    m.includes("quota") || m.includes("too many requests") || m.includes("overload") ||
    m.includes("temporarily unavailable") || m.includes("service unavailable") ||
    / 5\d\d/.test(m) || m.includes("etimedout") || m.includes("econnreset");
}
