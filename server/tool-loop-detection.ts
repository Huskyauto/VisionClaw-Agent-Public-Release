import crypto from "crypto";
import fs from "fs";
import path from "path";

const CONFIG_PATH = path.join(process.cwd(), "data", "loop-detection-config.json");

export interface LoopDetectionConfig {
  enabled: boolean;
  historySize: number;
  warningThreshold: number;
  criticalThreshold: number;
  globalCircuitBreakerThreshold: number;
  detectors: {
    genericRepeat: boolean;
    knownPollNoProgress: boolean;
    pingPong: boolean;
  };
}

const DEFAULT_CONFIG: LoopDetectionConfig = {
  enabled: true,
  historySize: 30,
  warningThreshold: 3,
  criticalThreshold: 5,
  globalCircuitBreakerThreshold: 20,
  detectors: {
    genericRepeat: true,
    knownPollNoProgress: true,
    pingPong: true,
  },
};

export function loadLoopDetectionConfig(): LoopDetectionConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_CONFIG,
        ...parsed,
        detectors: { ...DEFAULT_CONFIG.detectors, ...(parsed.detectors || {}) },
      };
    }
  } catch {}
  return { ...DEFAULT_CONFIG };
}

export function saveLoopDetectionConfig(updates: Partial<LoopDetectionConfig>): LoopDetectionConfig {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const current = loadLoopDetectionConfig();
  const merged = {
    ...current,
    ...updates,
    detectors: {
      ...current.detectors,
      ...(updates.detectors || {}),
    },
  };
  if (merged.warningThreshold >= merged.criticalThreshold) {
    throw new Error("warningThreshold must be less than criticalThreshold");
  }
  if (merged.criticalThreshold >= merged.globalCircuitBreakerThreshold) {
    throw new Error("criticalThreshold must be less than globalCircuitBreakerThreshold");
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
  return merged;
}

export type LoopDetectorKind = "generic_repeat" | "ping_pong" | "known_poll_no_progress" | "global_circuit_breaker";

export type LoopDetectionResult =
  | { stuck: false }
  | {
      stuck: true;
      level: "warning" | "critical";
      detector: LoopDetectorKind;
      count: number;
      message: string;
    };

interface ToolCallRecord {
  name: string;
  argsHash: string;
  resultHash: string;
}

function hashValue(value: unknown): string {
  const str = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return crypto.createHash("sha256").update(str).digest("hex").slice(0, 16);
}

function detectGenericRepeat(history: ToolCallRecord[], config: LoopDetectionConfig): LoopDetectionResult {
  if (!config.detectors.genericRepeat) return { stuck: false };
  if (history.length < config.warningThreshold) return { stuck: false };

  const last = history[history.length - 1];
  let repeatCount = 0;

  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    if (entry.name === last.name && entry.argsHash === last.argsHash) {
      repeatCount++;
    } else {
      break;
    }
  }

  if (repeatCount >= config.criticalThreshold) {
    return {
      stuck: true,
      level: "critical",
      detector: "generic_repeat",
      count: repeatCount,
      message: `Tool "${last.name}" called ${repeatCount} times with identical arguments. Breaking loop.`,
    };
  }

  if (repeatCount >= config.warningThreshold) {
    return {
      stuck: true,
      level: "warning",
      detector: "generic_repeat",
      count: repeatCount,
      message: `Tool "${last.name}" called ${repeatCount} times with identical arguments. Consider a different approach.`,
    };
  }

  return { stuck: false };
}

function detectPingPong(history: ToolCallRecord[], config: LoopDetectionConfig): LoopDetectionResult {
  if (!config.detectors.pingPong) return { stuck: false };
  if (history.length < 4) return { stuck: false };

  const recent = history.slice(-6);
  if (recent.length < 4) return { stuck: false };

  const uniqueTools = new Set(recent.map((r) => r.name));
  if (uniqueTools.size !== 2) return { stuck: false };

  const tools = Array.from(uniqueTools);
  let alternating = true;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i].name === recent[i - 1].name) {
      alternating = false;
      break;
    }
  }

  if (alternating && recent.length >= 4) {
    return {
      stuck: true,
      level: "warning",
      detector: "ping_pong",
      count: recent.length,
      message: `Detected ping-pong loop between "${tools[0]}" and "${tools[1]}". Try a different strategy.`,
    };
  }

  return { stuck: false };
}

function detectKnownPollNoProgress(history: ToolCallRecord[], config: LoopDetectionConfig): LoopDetectionResult {
  if (!config.detectors.knownPollNoProgress) return { stuck: false };
  if (history.length < config.warningThreshold) return { stuck: false };

  const last = history[history.length - 1];
  let sameResultCount = 0;

  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    if (entry.name === last.name && entry.resultHash === last.resultHash) {
      sameResultCount++;
    } else {
      break;
    }
  }

  if (sameResultCount >= config.criticalThreshold) {
    return {
      stuck: true,
      level: "critical",
      detector: "known_poll_no_progress",
      count: sameResultCount,
      message: `Tool "${last.name}" returned identical results ${sameResultCount} times. No progress detected.`,
    };
  }

  if (sameResultCount >= config.warningThreshold) {
    return {
      stuck: true,
      level: "warning",
      detector: "known_poll_no_progress",
      count: sameResultCount,
      message: `Tool "${last.name}" returned identical results ${sameResultCount} times. Consider a different approach.`,
    };
  }

  return { stuck: false };
}

function detectGlobalCircuitBreaker(history: ToolCallRecord[], config: LoopDetectionConfig): LoopDetectionResult {
  if (history.length < config.globalCircuitBreakerThreshold) return { stuck: false };

  const slice = history.slice(-config.globalCircuitBreakerThreshold);
  const uniqueOutcomes = new Set(
    slice.map((r) => `${r.name}:${r.resultHash}`)
  );

  if (uniqueOutcomes.size <= 3) {
    return {
      stuck: true,
      level: "critical",
      detector: "global_circuit_breaker",
      count: config.globalCircuitBreakerThreshold,
      message: `${config.globalCircuitBreakerThreshold} tool calls with only ${uniqueOutcomes.size} unique outcomes. Circuit breaker triggered.`,
    };
  }

  return { stuck: false };
}

export class ToolLoopDetector {
  private history: ToolCallRecord[] = [];
  private config: LoopDetectionConfig;

  constructor(config?: LoopDetectionConfig) {
    this.config = config || loadLoopDetectionConfig();
  }

  record(name: string, args: unknown, result: unknown): void {
    this.history.push({
      name,
      argsHash: hashValue(args),
      resultHash: hashValue(result),
    });

    if (this.history.length > this.config.historySize) {
      this.history = this.history.slice(-this.config.historySize);
    }
  }

  check(): LoopDetectionResult {
    if (!this.config.enabled) return { stuck: false };

    const genericRepeat = detectGenericRepeat(this.history, this.config);
    if (genericRepeat.stuck && genericRepeat.level === "critical") return genericRepeat;

    const pingPong = detectPingPong(this.history, this.config);
    if (pingPong.stuck) return pingPong;

    const knownPoll = detectKnownPollNoProgress(this.history, this.config);
    if (knownPoll.stuck && knownPoll.level === "critical") return knownPoll;

    const circuitBreaker = detectGlobalCircuitBreaker(this.history, this.config);
    if (circuitBreaker.stuck) return circuitBreaker;

    if (genericRepeat.stuck) return genericRepeat;
    if (knownPoll.stuck) return knownPoll;

    return { stuck: false };
  }

  reset(): void {
    this.history = [];
  }

  get size(): number {
    return this.history.length;
  }
}
