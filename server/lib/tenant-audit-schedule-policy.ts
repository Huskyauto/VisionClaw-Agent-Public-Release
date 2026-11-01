import { existsSync } from "node:fs";
import { resolve } from "node:path";

export const TENANT_AUDIT_JOB_KIND = "tenant_isolation_audit";
export function isCompleteAuditReport(report: any): boolean {
  const c = report?.coverage;
  return report?.degraded === false && Number.isInteger(c?.scanned) && c.scanned > 0 &&
    c.filesAudited === c.scanned && Number.isInteger(c.chunksAttempted) && c.chunksAttempted > 0 &&
    c.chunksSucceeded === c.chunksAttempted && c.chunksFailed === 0 && c.chunksPending === 0 &&
    c.sourceChangedDuringRun === false && Array.isArray(c.unreadableFiles) && c.unreadableFiles.length === 0;
}
export interface AuditScheduleJob {
  status: string;
  createdAt: string;
  window: string;
  progressAt?: string;
  complete?: boolean;
  sourceHash?: string;
  findingsRequireAttention?: boolean;
}
export function auditScheduleDecision(now: Date, jobs: AuditScheduleJob[], sourceHash?: string) {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid audit schedule clock");
  const window = now.toISOString().slice(0, 10);
  const active = jobs.find(j => j.status === "pending" || j.status === "running");
  if (active) {
    const progress = Date.parse(active.progressAt || active.createdAt);
    return { window, enqueue: false, warning: !Number.isFinite(progress) || now.getTime() - progress > 2 * 3600_000
      ? "stalled" : "incomplete" } as const;
  }
  const today = jobs.find(j => j.window === window);
  if (today && sourceHash && today.sourceHash && today.sourceHash !== sourceHash)
    return { window, enqueue: true, warning: "source_changed" } as const;
  return { window, enqueue: !today, warning: !today ? "missing"
    : today.status === "succeeded" && today.complete === true
      ? today.findingsRequireAttention ? "findings" : null : "incomplete" } as const;
}
export function auditCommand(production: boolean, exists = existsSync) {
  if (!production) return { command: "npx", args: ["tsx", "scripts/tenant-isolation-audit.ts"] };
  const bundle = resolve("dist/tenant-isolation-audit.cjs");
  if (!exists(bundle)) throw new Error("Production tenant audit bundle missing; rebuild and republish");
  return { command: process.execPath, args: [bundle] };
}
