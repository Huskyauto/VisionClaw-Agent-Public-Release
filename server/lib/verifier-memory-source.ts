import { totalmem } from "node:os";
import { probeVerifierCgroup, type CgroupProbe } from "./verifier-cgroup-probe";
import { readBoundedKernelText } from "./bounded-kernel-text";
import { reportDiagnostic } from "./safe-diagnostic";

export interface VerifierMemorySnapshot {
  currentBytes: number;
  maxBytes: number;
}

type ReadText = (name: string) => string;
const readText: ReadText = readBoundedKernelText;
const CGROUP_MOUNT = "/sys/fs/cgroup";

export interface VerifierMemoryDiagnostic {
  available: boolean;
  source: "cgroup-v2" | "cgroup-v1" | null;
  snapshot: VerifierMemorySnapshot | null;
  reason: "available" | "no-authoritative-limit" | "cgroup-unresolved" | "cgroup-read-failed";
  v2: { mounts: number; resolved: boolean; state: string };
  v1: { mounts: number; resolved: boolean; state: string };
}

export function readVerifierMemoryDiagnostic(read: ReadText = readText): VerifierMemoryDiagnostic {
  const v2 = probeVerifierCgroup(read, 2);
  const v1 = probeVerifierCgroup(read, 1);
  const candidates = [v2, v1].filter(probe => probe.snapshot !== null);
  const failed = [v2, v1].some(probe => probe.blocking);
  const selected = !failed && candidates.length === 1 ? candidates[0] : null;
  const project = (probe: CgroupProbe) => ({ mounts: probe.mounts, resolved: probe.resolved, state: probe.state });
  return {
    available: selected !== null,
    source: selected === null ? null : selected === v2 ? "cgroup-v2" : "cgroup-v1",
    snapshot: selected?.snapshot ?? null,
    reason: selected ? "available" : failed
      ? [v2, v1].some(probe => probe.state === "invalid" || probe.state === "read_error")
        ? "cgroup-read-failed" : "cgroup-unresolved"
      : "no-authoritative-limit",
    v2: project(v2),
    v1: project(v1),
  };
}

/** The same authoritative source powers admission, in-flight checks and diagnostics. */
export function readEffectiveVerifierMemory(read: ReadText = readText): VerifierMemorySnapshot | null {
  return readVerifierMemoryDiagnostic(read).snapshot;
}

function safeSegments(value: string): string[] | null {
  if (!value.startsWith("/")) return null;
  const segments = value.slice(1).split("/").filter(Boolean);
  // Kernel-supplied paths still must not be able to escape the fixed mount.
  if (segments.length > 32 || segments.some((segment) => segment === "." || segment === ".."
    || !/^[a-zA-Z0-9_.@:-]+$/.test(segment))) return null;
  return segments;
}

function currentCgroupDirectories(read: ReadText): string[] | null {
  const mounts = read("/proc/self/mountinfo").split("\n")
    .filter((line) => line.includes(" - cgroup2 "))
    .map((line) => line.split(" "))
    .filter((fields) => fields[4] === CGROUP_MOUNT);
  const groups = read("/proc/self/cgroup").trim().split("\n")
    .filter((line) => line.startsWith("0::"));
  if (mounts.length !== 1 || groups.length !== 1) return null;
  const mountRoot = safeSegments(mounts[0][3]);
  const groupPath = safeSegments(groups[0].slice(3));
  if (!mountRoot || !groupPath
    || mountRoot.some((segment, i) => groupPath[i] !== segment)) return null;
  const relative = groupPath.slice(mountRoot.length);
  return Array.from({ length: relative.length + 1 }, (_, index) => {
    const segments = relative.slice(0, relative.length - index);
    return segments.length ? `${CGROUP_MOUNT}/${segments.join("/")}` : CGROUP_MOUNT;
  });
}

/**
 * Every readable cgroup from the process to the mounted root constrains the
 * child. Use the lowest *limit* and lowest *free headroom* of those ancestors.
 * A leaf `max` is not proof that its parent is unlimited, and a finite root
 * alone is not proof that a tighter leaf has room.
 */
export function readEffectiveCgroupV2Memory(read: ReadText = readText): VerifierMemorySnapshot | null {
  const probe = probeVerifierCgroup(read, 2);
  if (probe.state === "invalid") throw new Error("Verifier cgroup memory value is malformed");
  if (probe.state === "read_error") throw new Error("Verifier cgroup memory could not be read");
  return probe.snapshot;
}

function fileState(read: ReadText, name: string, unlimited: string): string {
  try {
    const text = read(name).trim();
    if (text === unlimited) return "unbounded";
    if (!/^\d+$/.test(text)) return "invalid";
    const number = Number(text);
    return Number.isSafeInteger(number) && number > 0 ? "finite" : "invalid_or_unbounded";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "read_error";
  }
}

/** Fixed labels and aggregate numbers only; never include raw proc/cgroup text. */
export function summarizeUnavailableVerifierMemory(
  read: ReadText = readText,
  physicalTotal: () => number = totalmem,
): string {
  const v2 = fileState(read, `${CGROUP_MOUNT}/memory.max`, "max");
  const v1 = fileState(read, `${CGROUP_MOUNT}/memory/memory.limit_in_bytes`, "max");
  let mount = "unavailable";
  let processPath = "unresolved";
  let leaf = "unknown";
  try {
    const text = read("/proc/self/mountinfo");
    mount = text.includes(" - cgroup2 ") ? "v2_present" : "v2_absent";
    const directories = currentCgroupDirectories(read);
    if (directories) {
      processPath = "resolved";
      leaf = fileState(read, `${directories[0]}/memory.max`, "max");
    }
  } catch { reportDiagnostic("[verifier-memory] Optional cgroup path diagnostic unavailable"); }
  let hostTotal = "unknown";
  let hostAvailable = "unknown";
  try {
    const bytes = physicalTotal();
    if (Number.isSafeInteger(bytes) && bytes > 0) hostTotal = (bytes / 1024 ** 3).toFixed(2);
    const match = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(read("/proc/meminfo"));
    if (match) {
      const available = Number(match[1]) * 1024;
      if (Number.isSafeInteger(available) && available >= 0) {
        hostAvailable = (available / 1024 ** 3).toFixed(2);
      }
    }
  } catch { reportDiagnostic("[verifier-memory] Optional host memory diagnostic unavailable"); }
  const diagnostic = readVerifierMemoryDiagnostic(read);
  return `v2_root=${v2} v2_mount=${mount} v2_path=${processPath} v2_leaf=${leaf}`
    + ` v1_fixed=${v1} host_total_gib=${hostTotal} host_available_gib=${hostAvailable}`
    + ` v2_state=${diagnostic.v2.state} v1_mounts=${diagnostic.v1.mounts}`
    + ` v1_state=${diagnostic.v1.state} authority=${diagnostic.reason}`;
}