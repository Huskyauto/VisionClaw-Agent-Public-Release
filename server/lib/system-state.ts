import { existsSync, readFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { atomicWriteFileSync } from "./atomic-write";
import { logSilentCatch } from "./silent-catch";

const STATE_PATH = "data/system-state.json";
const CACHE_TTL_MS = 5_000;

export interface SystemState {
  haltBackground: boolean;
  haltReason?: string;
  haltedAt?: number;
  haltedBy?: string;
}

let _cache: { state: SystemState; loadedAt: number } | null = null;

function defaultState(): SystemState {
  return { haltBackground: false };
}

function loadFromDisk(): SystemState {
  try {
    if (!existsSync(STATE_PATH)) return defaultState();
    const raw = readFileSync(STATE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed?.haltBackground !== "boolean") return defaultState();
    return parsed as SystemState;
  } catch (e) {
    logSilentCatch("server/lib/system-state.ts", e);
    return defaultState();
  }
}

function getState(): SystemState {
  const now = Date.now();
  if (_cache && now - _cache.loadedAt < CACHE_TTL_MS) return _cache.state;
  const state = loadFromDisk();
  _cache = { state, loadedAt: now };
  return state;
}

export function isBackgroundHalted(): boolean {
  return getState().haltBackground === true;
}

export function getSystemState(): SystemState {
  return getState();
}

export function setBackgroundHalted(
  halted: boolean,
  opts: { reason?: string; actor?: string } = {},
): SystemState {
  const next: SystemState = halted
    ? {
        haltBackground: true,
        haltReason: opts.reason || "manual halt",
        haltedAt: Date.now(),
        haltedBy: opts.actor || "system",
      }
    : { haltBackground: false };
  // R98.19+sec — architect MEDIUM fix: previously a disk-write failure was
  // silently swallowed but the in-memory cache was still updated, leaving the
  // platform in a "halted but won't survive restart" state with no signal to
  // the admin. Now: apply the in-memory state immediately (so background loops
  // honor the halt RIGHT NOW), but if the disk write failed, rethrow so the
  // admin route returns 500 and the operator knows to retry to make it durable.
  let writeErr: any = null;
  try {
    mkdirSync(dirname(STATE_PATH), { recursive: true });
    atomicWriteFileSync(STATE_PATH, JSON.stringify(next, null, 2), { mode: 0o600 });
  } catch (e) {
    writeErr = e;
  }
  _cache = { state: next, loadedAt: Date.now() };
  console.warn(
    `[system-state] background ${halted ? "HALTED" : "RESUMED"} by=${opts.actor || "system"} reason="${opts.reason || ""}"${writeErr ? " (DISK WRITE FAILED — in-memory only, will not survive restart)" : ""}`,
  );
  if (writeErr) {
    throw new Error(
      `[system-state] in-memory halt=${halted} applied but disk persistence failed: ${writeErr?.message || String(writeErr)} — restart will lose state, retry to persist`,
    );
  }
  return next;
}

/** Throw an error if background work is currently halted. Use at start of background loops. */
export function assertNotHalted(label: string): void {
  if (isBackgroundHalted()) {
    const s = getState();
    throw new Error(
      `[halt] background work paused (${label}); reason="${s.haltReason || ""}" haltedBy=${s.haltedBy || "system"} — POST /api/admin/resume-background to clear`,
    );
  }
}
