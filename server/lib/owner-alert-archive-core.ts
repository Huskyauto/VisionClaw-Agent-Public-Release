import { randomUUID } from "node:crypto";
import { redactSensitiveText } from "../log-redactor";
import { ADMIN_TENANT_ID } from "../tenant-constants";

export const MAX_ALERT_BYTES = 8 * 1024 * 1024;
export const validAlertId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
/** Rotating cursor prevents persistent failures monopolizing a recovery batch. */
export function pendingAlertBatch(names: string[], cursor: string) {
  const sorted = names.filter(n => n.endsWith(".json") && validAlertId(n.slice(0, -5))).sort();
  const start = sorted.findIndex(n => n > cursor);
  const offset = start < 0 ? 0 : start;
  return [...sorted.slice(offset), ...sorted.slice(0, offset)].slice(0, 10);
}
export interface AlertInput {
  subject?: string; text?: string; html?: string; source?: string;
  reports?: Array<{ name: string; content: string }>;
}
export interface AlertRecord {
  version: 1; id: string; tenantId: number; createdAt: string;
  subject: string; source: string; severity: "critical" | "high" | "warning" | "info";
  text: string; html: string; reports: Array<{ name: string; content: string }>;
}
export interface AlertArchivePorts {
  persist(row: AlertRecord): Promise<void>;
  mirror(row: AlertRecord, pending: boolean): Promise<void>;
}
const clean = (value: string) => redactSensitiveText(value, { force: true })
  .replace(/(authorization\s*:\s*)(?:Basic|Bearer)\s+\S+/gi, "$1[REDACTED]")
  .replace(/(?<![A-Za-z0-9_-])(["']?[A-Za-z0-9_-]{0,80}(?:secret|token|password|passwd|credential|api[_-]?key|private[_-]?key|authorization|cookie)[A-Za-z0-9_-]{0,80}["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}<]+)/gi, '$1"[REDACTED]"')
  .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
  .replace(/(https?:\/\/)[^/\s:@]+:[^@\s/]+@/gi, "$1[REDACTED]@")
  .replace(/((?:cookie|set-cookie):)[^\r\n]*/gi, "$1 [REDACTED]")
  .replace(/([?&](?:token|key|secret|signature|access_token)=)[^&\s"'<>]+/gi, "$1[REDACTED]");

export function prepareOwnerAlert(input: AlertInput): AlertRecord {
  if (Buffer.byteLength(JSON.stringify(input), "utf8") > MAX_ALERT_BYTES) throw new Error("Alert exceeds 8 MiB archive limit");
  if ((input.reports?.length || 0) > 20) throw new Error("Too many diagnostic snapshots");
  const subject = clean(String(input.subject || "(no subject)"));
  if (subject.length > 1000 || String(input.source || "").length > 160) throw new Error("Alert metadata exceeds limit");
  const reports = (input.reports || []).map(r => {
    if (typeof r.name !== "string" || !r.name || r.name.length > 160 || /[/\\\u0000-\u001f]/.test(r.name) ||
        typeof r.content !== "string") throw new Error("Invalid diagnostic snapshot");
    return { name: clean(r.name), content: clean(r.content) };
  });
  const record: AlertRecord = {
    version: 1, id: randomUUID(), tenantId: ADMIN_TENANT_ID, createdAt: new Date().toISOString(),
    subject, source: clean(input.source || "owner-email"),
    severity: /critical|urgent/i.test(subject) ? "critical" : /\bhigh\b/i.test(subject) ? "high"
      : /warn|degraded|failed|error|\bred\b/i.test(subject) ? "warning" : "info",
    text: clean(input.text || ""), html: clean(input.html || ""), reports,
  };
  if (Buffer.byteLength(JSON.stringify(record), "utf8") > MAX_ALERT_BYTES) throw new Error("Prepared alert exceeds archive limit");
  return record;
}

/** DB is authoritative. Mirror failures cannot turn a committed archive into failure. */
export async function archiveOwnerAlert(input: AlertInput, ports: AlertArchivePorts) {
  const warnings: string[] = [];
  let row: AlertRecord;
  try { row = prepareOwnerAlert(input); }
  catch { return { id: null, durability: "failed" as const, warnings: ["Full alert could not be prepared; archive size/shape limit exceeded."] }; }
  let local = false;
  try { await ports.mirror(row, true); local = true; }
  catch { warnings.push("Private local mirror unavailable."); }
  try { await ports.persist(row); }
  catch {
    warnings.push("Durable alert save FAILED; details are not yet protected against republishing.");
    return { id: row.id, durability: local ? "local_only" as const : "failed" as const, warnings };
  }
  try { await ports.mirror(row, false); }
  catch { warnings.push("Durable details saved; private local mirror refresh failed."); }
  return { id: row.id, durability: "durable" as const, warnings };
}
