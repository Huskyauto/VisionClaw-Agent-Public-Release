import { Request, Response } from "express";
import fs from "fs";
import path from "path";

import { logSilentCatch } from "./lib/silent-catch";
const VOICE_WAKE_PATH = path.join(process.cwd(), "data", "voicewake.json");
const DEFAULT_TRIGGERS = ["visionclaw", "hey claw", "computer"];
const MAX_TRIGGERS = 10;
const MAX_TRIGGER_LENGTH = 30;

interface VoiceWakeData {
  triggers: string[];
  updatedAtMs: number;
}

function ensureDataDir() {
  const dir = path.dirname(VOICE_WAKE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadWakeData(): VoiceWakeData {
  try {
    if (fs.existsSync(VOICE_WAKE_PATH)) {
      const raw = fs.readFileSync(VOICE_WAKE_PATH, "utf-8");
      const data = JSON.parse(raw);
      if (Array.isArray(data.triggers) && data.triggers.length > 0) {
        return data;
      }
    }
  } catch (_silentErr) { logSilentCatch("server/voice-wake.ts", _silentErr); }
  return { triggers: [...DEFAULT_TRIGGERS], updatedAtMs: Date.now() };
}

function saveWakeData(data: VoiceWakeData) {
  ensureDataDir();
  fs.writeFileSync(VOICE_WAKE_PATH, JSON.stringify(data, null, 2));
}

function normalizeTriggers(raw: string[]): string[] {
  const normalized = raw
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0 && t.length <= MAX_TRIGGER_LENGTH)
    .slice(0, MAX_TRIGGERS);
  return [...new Set(normalized)];
}

export function handleVoiceWakeGet(_req: Request, res: Response) {
  const data = loadWakeData();
  res.json({ triggers: data.triggers });
}

export function handleVoiceWakeSet(req: Request, res: Response) {
  const { triggers } = req.body;
  if (!Array.isArray(triggers) || !triggers.every((t: any) => typeof t === "string")) {
    return res.status(400).json({ error: "triggers must be an array of strings" });
  }

  let normalized = normalizeTriggers(triggers);
  if (normalized.length === 0) {
    normalized = [...DEFAULT_TRIGGERS];
  }

  const data: VoiceWakeData = {
    triggers: normalized,
    updatedAtMs: Date.now(),
  };
  saveWakeData(data);

  res.json({ triggers: data.triggers });
}

export function getVoiceWakeTriggers(): string[] {
  return loadWakeData().triggers;
}
