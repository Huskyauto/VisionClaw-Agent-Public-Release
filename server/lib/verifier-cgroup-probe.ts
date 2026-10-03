import path from "node:path";
import { MAX_KERNEL_TEXT_BYTES } from "./bounded-kernel-text";

export type CgroupRead = (name: string) => string;
export type CgroupState = "available" | "missing" | "unresolved" | "unbounded" | "invalid" | "read_error" | "ambiguous";
export interface CgroupProbe {
  mounts: number;
  resolved: boolean;
  state: CgroupState;
  snapshot: { maxBytes: number; currentBytes: number } | null;
  blocking: boolean;
}

const MAX_DEPTH = 32;
const SYSFS_ROOT = "/sys/fs/cgroup";

function boundedRead(read: CgroupRead, name: string): string {
  const value = read(name);
  if (typeof value !== "string" || value.length > MAX_KERNEL_TEXT_BYTES) throw new Error("Invalid kernel metadata");
  return value;
}

function segments(value: string): string[] | null {
  if (!value.startsWith("/")) return null;
  const parts = value.slice(1).split("/").filter(Boolean);
  if (parts.length > MAX_DEPTH || parts.some(part => !/^[A-Za-z0-9_.@:-]+$/.test(part) || part === "." || part === "..")) return null;
  return parts;
}

function bytes(text: string): number {
  if (!/^\d+$/.test(text.trim())) throw new Error("Malformed accounting");
  const number = Number(text.trim());
  if (!Number.isSafeInteger(number) || number < 0) throw new Error("Malformed accounting");
  return number;
}

function limit(text: string, version: 1 | 2): number | null {
  const value = text.trim();
  if (version === 2 && value === "max") return null;
  // Linux's 64-bit v1 unlimited sentinels are not finite admission limits.
  if (version === 1 && ["9223372036854771712", "9223372036854775807", "18446744073709551615"].includes(value)) return null;
  const number = bytes(value);
  if (number <= 0) throw new Error("Malformed accounting");
  return number;
}

/** Kernel-only paths, bounded ancestry, and no host-memory or caller fallback. */
export function probeVerifierCgroup(read: CgroupRead, version: 1 | 2): CgroupProbe {
  const result: CgroupProbe = { mounts: 0, resolved: false, state: "missing", snapshot: null, blocking: false };
  try {
    const underlying = read;
    let readCount = 0;
    let readBytes = 0;
    read = (name) => {
      if (++readCount > 160) throw new Error("Kernel read budget exceeded");
      const text = boundedRead(underlying, name);
      readBytes += text.length;
      if (readBytes > 1024 * 1024) throw new Error("Kernel read budget exceeded");
      return text;
    };
    const mountLines = boundedRead(read, "/proc/self/mountinfo").trim().split("\n");
    const groupLines = boundedRead(read, "/proc/self/cgroup").trim().split("\n");
    if (mountLines.length > 2048 || groupLines.length > 128) throw new Error("Malformed accounting");
    const mounts = mountLines.map(line => {
      const [left, right, extra] = line.split(" - ");
      const fields = left.split(" ");
      const fs = right?.split(" ");
      if (extra !== undefined || fields.length < 6 || !fs || fs.length < 3
        || !/^\d+$/.test(fields[0]) || !/^\d+$/.test(fields[1])
        || !/^\d+:\d+$/.test(fields[2])) throw new Error("Malformed mount accounting");
      return !extra && fields.length >= 6 && fs && fs.length >= 3
        && (version === 2 ? fs[0] === "cgroup2" : fs[0] === "cgroup" && fs[2].split(",").includes("memory"))
        ? { root: fields[3], mount: fields[4] } : null;
    }).filter((mount): mount is { root: string; mount: string } => mount !== null);
    const groups = groupLines.map(line => {
      const fields = line.split(":");
      if (fields.length !== 3 || !/^\d+$/.test(fields[0])) throw new Error("Malformed group accounting");
      return fields;
    })
      .filter(fields => fields.length === 3 && /^\d+$/.test(fields[0])
        && (version === 2 ? fields[0] === "0" && fields[1] === "" : fields[1].split(",").includes("memory")));
    result.mounts = mounts.length;
    if (mounts.length === 0) return groups.length
      ? { ...result, state: "unresolved", blocking: true } : result;
    result.blocking = true;
    if (mounts.length !== 1) return { ...result, state: "ambiguous" };
    if (groups.length !== 1) return { ...result, state: "unresolved" };
    const mount = mounts[0];
    const root = segments(mount.root);
    const group = segments(groups[0][2]);
    if (!root || !group || !segments(mount.mount)
      || !(mount.mount === SYSFS_ROOT || mount.mount.startsWith(`${SYSFS_ROOT}/`))
      || root.some((part, i) => group[i] !== part)) return { ...result, state: "unresolved" };
    const relative = group.slice(root.length);
    const directories = Array.from({ length: relative.length + 1 }, (_, index) =>
      path.posix.join(mount.mount, ...relative.slice(0, relative.length - index)));
    result.resolved = true;
    // A subtree bind mount conceals parent headroom, even when v1's effective
    // limit equals a visible limit. Limits alone cannot reveal sibling usage.
    if (root.length !== 0) return { ...result, state: "unresolved" };
    let lowestLimit = Infinity;
    let lowestFree = Infinity;
    let missing = false;
    let present = 0;
    const hierarchy: Array<{ max: number | null; effective: number | null }> = [];
    for (const directory of directories) {
      let text: string;
      try { text = boundedRead(read, `${directory}/${version === 2 ? "memory.max" : "memory.limit_in_bytes"}`); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        missing = true;
        continue;
      }
      present++;
      const max = limit(text, version);
      if (version === 1) {
        if (boundedRead(read, `${directory}/memory.use_hierarchy`).trim() !== "1") {
          return { ...result, state: "invalid" };
        }
        const stat = boundedRead(read, `${directory}/memory.stat`);
        const entries = stat.split("\n").filter(line => line.startsWith("hierarchical_memory_limit "));
        if (entries.length !== 1) return { ...result, state: "invalid" };
        hierarchy.push({ max, effective: limit(entries[0].slice("hierarchical_memory_limit ".length), 1) });
      }
      if (max === null) continue;
      let usage: number;
      try { usage = bytes(boundedRead(read, `${directory}/${version === 2 ? "memory.current" : "memory.usage_in_bytes"}`)); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        missing = true;
        continue;
      }
      lowestLimit = Math.min(lowestLimit, max);
      lowestFree = Math.min(lowestFree, Math.max(0, max - usage));
    }
    if (missing) return { ...result, state: "missing", blocking: version === 1 || present > 0 };
    // Validate EACH node against its readable ancestors, not merely the
    // smallest limit anywhere in the tree. Otherwise a hidden parent whose
    // cap equals the leaf cap can conceal sibling usage and unsafe headroom.
    let visibleLimit = Infinity;
    for (const node of hierarchy.reverse()) {
      visibleLimit = Math.min(visibleLimit, node.max ?? Infinity);
      if ((node.effective ?? Infinity) !== visibleLimit) return { ...result, state: "unresolved" };
    }
    if (!Number.isFinite(lowestLimit)) return { ...result, state: "unbounded", blocking: false };
    return {
      ...result, state: "available", blocking: false,
      snapshot: { maxBytes: lowestLimit, currentBytes: lowestLimit - Math.min(lowestLimit, lowestFree) },
    };
  } catch (error) {
    return { ...result, blocking: true, state: (error as NodeJS.ErrnoException).code ? "read_error" : "invalid" };
  }
}