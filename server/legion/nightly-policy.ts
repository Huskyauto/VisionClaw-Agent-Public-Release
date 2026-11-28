import { LEGION_RUNBOOKS, LegionSourceChanged } from "./runbook-source";
import { LegionAdmissionDeferred } from "./background";
import { SURFACE_MODEL } from "./local-router";
import { LEGION_MODEL, LEGION_REASONING_MODEL } from "./model-policy";
import { HostedRunbookWaiting } from "./runbook-hosted";

export const LEGION_RUNBOOK_JOB = "legion_runbook_compile";
export const SURFACE_RULE_JOB = "surface_runbook_rule";
export class LegionJobWaiting extends Error {}
export class LegionJobRejected extends Error {}

export function legionNightWindow(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid Legion schedule time");
  const fields = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const part = (name: string) => Number(fields.find(f => f.type === name)?.value);
  const calendar = new Date(Date.UTC(part("year"), part("month") - 1, part("day")));
  if (part("hour") < 2) calendar.setUTCDate(calendar.getUTCDate() - 1);
  return calendar.toISOString().slice(0, 10);
}

interface ClaimedJob {
  id: number; kind: string; tenantId: number | null; attempts: number;
  payload: Record<string, unknown>;
}
interface Compilation {
  concepts: { key: string; title: string; quotes: string[] }[];
  sourceSha256: string; model: string;
  hostedFallback?: boolean;
}
export interface NightlyDependencies {
  enabled(): boolean;
  ready(): boolean;
  hostedEnabled?(): boolean;
  environment(): string;
  read(path: string): Promise<{ sha256: string; text?: string }>;
  health(): Promise<unknown>;
  compile(path: string, expectedSha256: string): Promise<Compilation>;
}

/** One source/bounded provider ladder; the existing queue owns fenced completion.
 * Returning source excerpts does not promote a skill or authorize any action. */
export async function runLocalRunbookJob(job: ClaimedJob, deps: NightlyDependencies,
  kind: typeof LEGION_RUNBOOK_JOB | typeof SURFACE_RULE_JOB = LEGION_RUNBOOK_JOB) {
  const p = job.payload;
  if (job.kind !== kind || job.tenantId !== 1 || p.tenantId !== 1 ||
      (p.priority !== undefined && p.priority !== "daytime" && p.priority !== "overnight") ||
      !Number.isSafeInteger(job.id) || job.id < 1 || !Number.isSafeInteger(job.attempts) || job.attempts < 1 ||
      !["development", "production"].includes(String(p.environment)) || p.environment !== deps.environment() ||
      typeof p.sourcePath !== "string" || !(LEGION_RUNBOOKS as readonly string[]).includes(p.sourcePath) ||
      typeof p.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(p.sourceSha256) ||
      typeof p.window !== "string" || !/^\d{4}-\d\d-\d\d$/.test(p.window)) {
    throw new LegionJobRejected("Legion queued job has invalid owner/environment/source identity");
  }
  const hostedAllowed = deps.hostedEnabled?.() === true;
  if (!deps.enabled() || (!deps.ready() && !hostedAllowed)) {
    throw new LegionJobWaiting("Legion is disabled or not ready; work retained");
  }
  const source = await deps.read(p.sourcePath);
  if (source.sha256 !== p.sourceSha256) {
    return { status: "superseded", reason: "source_changed", sourceSha256: p.sourceSha256 };
  }
  // A health GET is capacity admission, not a generation attempt.
  try { await deps.health(); }
  catch {
    if (!hostedAllowed) throw new LegionJobWaiting("Local laptop service unavailable; no model dispatched");
    // The compiler must exhaust local routes before its budget-gated hosted
    // attempt. Laptop availability cannot prevent reaching that recovery.
  }
  if (!deps.enabled()) throw new LegionJobWaiting("Legion stopped before dispatch");
  let result: Compilation;
  try { result = await deps.compile(p.sourcePath, p.sourceSha256); }
  catch (error) {
    if (error instanceof LegionSourceChanged) return { status: "superseded", reason: "source_changed", sourceSha256: p.sourceSha256 };
    if (error instanceof HostedRunbookWaiting && !error.generationStarted) {
      throw new LegionJobWaiting(error.message);
    }
    if (error instanceof LegionAdmissionDeferred) {
      if (!error.generationStarted) throw new LegionJobWaiting(error.message);
      throw Error("Local backup busy after a real attempt; retry remains charged to attempt limit");
    }
    throw error; // Real generation failures consume attempts, never refunded.
  }
  if (result.sourceSha256 !== p.sourceSha256 || (await deps.read(p.sourcePath)).sha256 !== p.sourceSha256) {
    return { status: "superseded", reason: "source_changed", sourceSha256: p.sourceSha256 };
  }
  const hosted = result.hostedFallback === true;
  const validModel = hosted
    ? deps.hostedEnabled?.() === true && /^hosted:[^\r\n]{1,200}$/.test(result.model)
    : [`legion-local:${LEGION_MODEL}`, `legion-local:${LEGION_REASONING_MODEL}`, `surface-local:${SURFACE_MODEL}`].includes(result.model);
  if (!validModel ||
      !Array.isArray(result.concepts) ||
      result.concepts.length < 1 || result.concepts.length > (kind === SURFACE_RULE_JOB ? 1 : 4) ||
      typeof source.text !== "string" ||
      result.concepts.some(c => typeof c.key !== "string" || !/^[a-z][a-z0-9-]{2,79}$/.test(c.key) ||
        typeof c.title !== "string" || c.title.length < 3 || c.title.length > 120 ||
        !Array.isArray(c.quotes) || c.quotes.length < 1 || c.quotes.length > (kind === SURFACE_RULE_JOB ? 1 : 3) ||
        c.quotes.some(q => typeof q !== "string" || q.length < 10 || q.length > 800 || !source.text!.includes(q)))) {
    throw new Error("Legion queued result failed local-model/source-grounding validation");
  }
  return { status: "compiled", sourcePath: p.sourcePath, sourceSha256: result.sourceSha256,
    model: result.model, concepts: result.concepts, hostedFallback: hosted,
    inferenceCostUsd: hosted ? null : 0, advisoryOnly: true };
}
