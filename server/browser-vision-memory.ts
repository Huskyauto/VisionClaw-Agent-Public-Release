import crypto from "crypto";

export interface VisionDiffState {
  lastScreenshotHash: string;
  lastAction: { mark: number; actType: string; text?: string };
  consecutiveNoChangeCount: number;
  totalActions: number;
}

const tenantVisionState = new Map<string, VisionDiffState>();

export function computeScreenshotHash(buffer: Buffer): string {
  return crypto.createHash("md5").update(buffer).digest("hex");
}

export function getVisionState(tenantId: number): VisionDiffState | undefined {
  return tenantVisionState.get(`vision-${tenantId}`);
}

export function updateVisionState(tenantId: number, hash: string, action: { mark: number; actType: string; text?: string }, pageChanged: boolean): void {
  const key = `vision-${tenantId}`;
  const existing = tenantVisionState.get(key);
  tenantVisionState.set(key, {
    lastScreenshotHash: hash,
    lastAction: action,
    consecutiveNoChangeCount: pageChanged ? 0 : (existing?.consecutiveNoChangeCount || 0) + 1,
    totalActions: (existing?.totalActions || 0) + 1,
  });
}

export function resetVisionState(tenantId: number): void {
  tenantVisionState.delete(`vision-${tenantId}`);
}

// Rolling buffer of the last N vision actions per tenant.
// Gives the AI narrative context: "I already tried clicking Sign In and it failed."
const MEMORY_BUFFER_SIZE = 5;

export interface VisionMemoryEntry {
  step: number;
  timestamp: number;
  action: string;
  mark: number;
  elementTag: string;
  elementText: string;
  elementHref?: string;
  text?: string;
  pageChanged: boolean;
  urlBefore: string;
  urlAfter: string;
  outcome: "succeeded" | "failed_no_change" | "failed_error";
  errorMessage?: string;
}

const tenantActionMemory = new Map<string, VisionMemoryEntry[]>();

function memoryKey(tenantId: number): string {
  return `mem-${tenantId}`;
}

export function getActionMemory(tenantId: number): VisionMemoryEntry[] {
  return tenantActionMemory.get(memoryKey(tenantId)) || [];
}

export function recordActionMemory(tenantId: number, entry: VisionMemoryEntry): void {
  const key = memoryKey(tenantId);
  const existing = tenantActionMemory.get(key) || [];
  existing.push(entry);
  if (existing.length > MEMORY_BUFFER_SIZE) {
    existing.splice(0, existing.length - MEMORY_BUFFER_SIZE);
  }
  tenantActionMemory.set(key, existing);
}

export function clearActionMemory(tenantId: number): void {
  tenantActionMemory.delete(memoryKey(tenantId));
}

export function getNextStepNumber(tenantId: number): number {
  const mem = getActionMemory(tenantId);
  if (mem.length === 0) return 1;
  return mem[mem.length - 1].step + 1;
}

export function formatActionMemory(tenantId: number): string {
  const mem = getActionMemory(tenantId);
  if (mem.length === 0) return "";

  const lines = mem.map(entry => {
    const status = entry.outcome === "succeeded"
      ? "OK — page changed"
      : entry.outcome === "failed_no_change"
        ? "FAILED — page did NOT change (no-op)"
        : `ERROR — ${entry.errorMessage || "action threw exception"}`;
    const desc = [`Step ${entry.step}: ${entry.action.toUpperCase()} mark [${entry.mark}]`];
    desc.push(`${entry.elementTag} "${entry.elementText}"`);
    if (entry.text) desc.push(`text="${entry.text}"`);
    desc.push(`→ ${status}`);
    if (entry.urlBefore !== entry.urlAfter) desc.push(`(navigated: ${entry.urlAfter})`);
    return desc.join(" ");
  });

  const failedElements = mem
    .filter(e => e.outcome !== "succeeded")
    .map(e => `"${e.elementText}" (${e.action})`)
    .filter((v, i, a) => a.indexOf(v) === i);

  let summary = `RECENT ACTION HISTORY (last ${mem.length} steps):\n${lines.join("\n")}`;
  if (failedElements.length > 0) {
    summary += `\n⚠ ELEMENTS THAT DID NOT WORK: ${failedElements.join(", ")} — do NOT retry these.`;
  }
  return summary;
}