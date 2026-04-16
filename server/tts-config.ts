import fs from "fs";
import path from "path";

export type TTSProvider = "elevenlabs" | "openai" | "edge";
export type TTSAutoMode = "off" | "always" | "inbound" | "tagged";

export interface TTSConfig {
  auto: TTSAutoMode;
  provider: TTSProvider;
  maxTextLength: number;
  summarize: boolean;
  timeoutMs: number;
  elevenlabs: {
    voiceId: string;
    modelId: string;
    stability: number;
    similarityBoost: number;
    speed: number;
  };
  openai: {
    model: string;
    voice: string;
  };
  edge: {
    enabled: boolean;
    voice: string;
    rate: string;
    pitch: string;
  };
}

const CONFIG_PATH = path.resolve(process.cwd(), "data", "tts-config.json");

const DEFAULT_CONFIG: TTSConfig = {
  auto: "off",
  provider: "openai",
  maxTextLength: 4000,
  summarize: true,
  timeoutMs: 30000,
  elevenlabs: {
    voiceId: "JBFqnCBsd6RMkjVDRZzb",
    modelId: "eleven_flash_v2_5",
    stability: 0.5,
    similarityBoost: 0.75,
    speed: 1.0,
  },
  openai: {
    model: "gpt-4o-mini-tts",
    voice: "onyx",
  },
  edge: {
    enabled: true,
    voice: "en-US-MichelleNeural",
    rate: "+0%",
    pitch: "+0%",
  },
};

let cachedConfig: TTSConfig | null = null;

export function loadTTSConfig(): TTSConfig {
  if (cachedConfig) return cachedConfig;

  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
      if (data.provider === "vibevoice") data.provider = "openai";
      cachedConfig = { ...DEFAULT_CONFIG, ...data };
      return cachedConfig;
    }
  } catch (err) {
    console.error("[tts-config] Failed to load:", err);
  }

  cachedConfig = { ...DEFAULT_CONFIG };
  return cachedConfig;
}

export function saveTTSConfig(config: Partial<TTSConfig>): TTSConfig {
  const current = loadTTSConfig();
  const updated: TTSConfig = {
    ...current,
    ...config,
    elevenlabs: { ...current.elevenlabs, ...(config.elevenlabs || {}) },
    openai: { ...current.openai, ...(config.openai || {}) },
    edge: { ...current.edge, ...(config.edge || {}) },
  };

  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2));
  cachedConfig = updated;
  return updated;
}

export function shouldAutoTTS(mode: TTSAutoMode, isInbound: boolean): boolean {
  switch (mode) {
    case "always": return true;
    case "inbound": return isInbound;
    case "tagged": return false;
    case "off": default: return false;
  }
}

export function isTextTooLong(text: string, config: TTSConfig): boolean {
  return text.length > config.maxTextLength;
}

export function shouldSkipTTS(text: string): boolean {
  if (text.length < 10) return true;
  if (/^HEARTBEAT_OK$/i.test(text.trim())) return true;
  if (/MEDIA:|!\[.*\]\(.*\)/.test(text)) return true;
  return false;
}

export function getProviderFallbackOrder(primary: TTSProvider): TTSProvider[] {
  const all: TTSProvider[] = ["elevenlabs", "openai", "edge"];
  return [primary, ...all.filter(p => p !== primary)];
}
