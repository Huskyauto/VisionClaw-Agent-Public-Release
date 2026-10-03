import { readFileSync } from "node:fs";

export interface CgroupMemoryMetrics {
  currentBytes: number;
  maxBytes: number | null;
  events: { high: number; oom: number; oomKill: number } | null;
}

type ReadText = (path: string) => string;

function nonnegativeInteger(text: string): number {
  const value = text.trim();
  if (!/^\d+$/.test(value)) throw new Error("Invalid cgroup memory value");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("Cgroup memory value exceeds safe range");
  return parsed;
}

function memoryEvents(text: string): CgroupMemoryMetrics["events"] {
  const counters = new Map<string, number>();
  for (const line of text.trim().split("\n")) {
    const match = /^([a-z_]+) (\d+)$/.exec(line.trim());
    if (!match || counters.has(match[1])) return null;
    try { counters.set(match[1], nonnegativeInteger(match[2])); }
    catch { return null; }
  }
  if (!["high", "oom", "oom_kill"].every((key) => counters.has(key))) return null;
  return { high: counters.get("high")!, oom: counters.get("oom")!, oomKill: counters.get("oom_kill")! };
}

/** Null means cgroup v2 is unavailable/malformed, never zero memory usage. */
export function readCgroupMemoryMetrics(read: ReadText = (name) => readFileSync(name, "utf8")): CgroupMemoryMetrics | null {
  try {
    const currentBytes = nonnegativeInteger(read("/sys/fs/cgroup/memory.current"));
    const limit = read("/sys/fs/cgroup/memory.max").trim();
    const maxBytes = limit === "max" ? null : nonnegativeInteger(limit);
    if (maxBytes !== null && maxBytes <= 0) return null;
    let events: CgroupMemoryMetrics["events"] = null;
    try { events = memoryEvents(read("/sys/fs/cgroup/memory.events")); }
    catch { /* Usage can still be reported without event counters. */ }
    return { currentBytes, maxBytes, events };
  } catch {
    return null;
  }
}