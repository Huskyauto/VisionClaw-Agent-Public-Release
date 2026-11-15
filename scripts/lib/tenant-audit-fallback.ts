/** Explicit owner audit ladder. Paid recovery only through the existing capped owner lane. */
export type AuditRoute = {
  providerLane: "profundo" | "standard-compute" | "openference" | "replit" | "cheaperinference";
  model: string;
  forbidMeteredFallback: true;
};
export const AUDIT_UNIT_CHARS = 30_000;
export const AUDIT_ROUTE_TIMEOUT_MS = 55_000;
export const AUDIT_PASS_BUDGET_MS = 170_000; // Three full 55s calls plus overhead; below 4-minute child.
/** A scheduling yield is not a provider failure and must never dispatch backups. */
export class AuditWorkDeferred extends Error {}
export class AuditContentError extends Error {}
export class AuditAdmissionError extends Error {}
export function auditRoutes(primary = "profundo", model?: string): AuditRoute[] {
  if (!["profundo", "standard-compute", "openference", "replit"].includes(primary))
    throw new Error("Unsupported tenant audit primary provider");
  const defaults: AuditRoute[] = [
    { providerLane: "profundo", model: "claude-sonnet-5", forbidMeteredFallback: true },
    { providerLane: "standard-compute", model: "gemini-3.1-pro-preview", forbidMeteredFallback: true },
    { providerLane: "openference", model: "openference/deepseek-v4-pro", forbidMeteredFallback: true },
    { providerLane: "replit", model: "gpt-5.4", forbidMeteredFallback: true },
    { providerLane: "cheaperinference", model: "cheaperinference/gpt-5.6-luna", forbidMeteredFallback: true },
  ];
  const first = defaults.find(r => r.providerLane === primary)!;
  return [{ ...first, model: model ?? first.model }, ...defaults.filter(r => r !== first)];
}
export class AuditProvidersExhausted extends Error {
  constructor() { super("Audit recovery pass exhausted; saved progress and next provider retained for delayed recovery"); }
}
export async function runAuditFallback<T>(ports: {
  routes: readonly AuditRoute[];
  cursor: number;
  beforeAttempt(next: number): Promise<void>;
  invoke(route: AuditRoute): Promise<T>;
  available?(route: AuditRoute): Promise<boolean>;
  failed?(route: AuditRoute, error: unknown): void | Promise<void>;
  beforeDispatch?(route: AuditRoute): Promise<void>;
  now?(): number;
}): Promise<T> {
  if (ports.routes.length !== 5 || new Set(ports.routes.map(r => r.providerLane)).size !== 5 ||
      !ports.routes.every(r => auditRoutes().some(a => a.providerLane === r.providerLane) && r.forbidMeteredFallback === true) ||
      !Number.isInteger(ports.cursor) || ports.cursor < 0 || ports.cursor >= ports.routes.length)
    throw new Error("Invalid audit fallback routes or cursor");
  const now = ports.now ?? Date.now;
  const deadline = now() + AUDIT_PASS_BUDGET_MS;
  let contentFailed = false, transportFailed = false, dispatched = 0;
  for (let n = 0; n < ports.routes.length; n++) {
    // Do not start a paid/slow call with only a partial timeout window left.
    // Keep the last persisted cursor on this not-yet-dispatched provider.
    if (deadline - now() < AUDIT_ROUTE_TIMEOUT_MS) break;
    const index = (ports.cursor + n) % ports.routes.length;
    // Outside catch: failed persistence/authority must NEVER dispatch a backup.
    await ports.beforeAttempt((index + 1) % ports.routes.length);
    if (ports.available && !await ports.available(ports.routes[index])) continue;
    if (deadline - now() < AUDIT_ROUTE_TIMEOUT_MS) {
      await ports.beforeAttempt(index); // Persistence was slow; this provider remains untried.
      break;
    }
    try { await ports.beforeDispatch?.(ports.routes[index]); }
    catch (error) {
      if (error instanceof AuditWorkDeferred) await ports.beforeAttempt(index);
      throw error; // Admission/storage/authority failures never become a fallback.
    }
    try { dispatched++; return await ports.invoke(ports.routes[index]); }
    catch (error) {
      if (error instanceof AuditAdmissionError) throw error;
      if (error instanceof AuditWorkDeferred) {
        await ports.beforeAttempt(index); // Proven pre-dispatch yield, not an uncertain paid attempt.
        throw error;
      }
      if (error instanceof AuditContentError || (error instanceof AuditResponseError && error.code !== "refused"))
        contentFailed = true;
      else transportFailed = true;
      await ports.failed?.(ports.routes[index], error);
    }
  }
  if (dispatched === ports.routes.length && contentFailed && !transportFailed)
    throw new AuditContentError("Audit content validation exhausted; source unit unresolved");
  throw new AuditProvidersExhausted();
}
export class AuditResponseError extends Error {
  constructor(readonly code: "shape" | "refused" | "truncated" | "unfinished" | "empty" | "oversized") {
    super(`Audit response rejected: ${code}`);
  }
}
export function completeAuditText(response: any): string {
  const choices = response?.choices;
  if (!Array.isArray(choices) || choices.length !== 1 || !choices[0]?.message)
    throw new AuditResponseError("shape");
  if (choices[0].message.refusal || choices[0].finish_reason === "content_filter")
    throw new AuditResponseError("refused");
  if (choices[0].finish_reason === "length") throw new AuditResponseError("truncated");
  if (choices[0].finish_reason !== "stop") throw new AuditResponseError("unfinished");
  if (typeof choices[0].message.content !== "string") throw new AuditResponseError("shape");
  if (!choices[0].message.content.trim()) throw new AuditResponseError("empty");
  if (Buffer.byteLength(choices[0].message.content) > 512 * 1024) throw new AuditResponseError("oversized");
  return choices[0].message.content;
}

/** File-labelled, line-number-preserving windows with 150-line context overlap. */
export function splitAuditUnits(text: string): string[] {
  const matches = [...text.matchAll(/\n===== FILE: [^\n]+ =====\n/g)];
  if (!matches.length || matches[0].index !== 0)
    throw new Error("Audit source lacks file identity");
  const sections: string[] = [];
  for (let i = 0; i < matches.length; i++) {
    const header = matches[i][0];
    const body = text.slice(matches[i].index! + header.length, matches[i + 1]?.index ?? text.length);
    const lines = body.split("\n");
    const sectionLength = header.length + body.length;
    if (sectionLength <= AUDIT_UNIT_CHARS) {
      sections.push(text.slice(matches[i].index!, matches[i + 1]?.index ?? text.length));
      continue;
    }
    const windows: string[] = [];
    let start = 0;
    while (start < lines.length) {
      let end = start, size = header.length;
      while (end < lines.length && size + lines[end].length + 1 <= AUDIT_UNIT_CHARS) {
        size += lines[end].length + 1; end++;
      }
      if (end === start) throw new Error("Source line exceeds bounded audit unit size");
      windows.push(header + lines.slice(start, end).join("\n"));
      if (end === lines.length) break;
      start = end - Math.min(150, Math.floor((end - start) / 2));
    }
    sections.push(...windows);
  }

  // Retain every original label and source byte while packing adjacent small
  // file sections together. Large files still use their original overlapped
  // windows above, and no unit may exceed the transport's character bound.
  const units: string[] = [];
  let current = "";
  for (const section of sections) {
    if (current && current.length + section.length > AUDIT_UNIT_CHARS) {
      units.push(current);
      current = "";
    }
    if (section.length > AUDIT_UNIT_CHARS)
      throw new Error("Audit source section exceeds bounded audit unit size");
    current += section;
  }
  if (current) units.push(current);
  return units;
}

export function auditUnitLocationMatches(source: string, file: string, line?: number): boolean {
  const headers = [...source.matchAll(/\n===== FILE: (.+?)(?: \(lines \d+-\d+ of \d+\))? =====\n/g)];
  if (!headers.length || headers[0].index !== 0) return false;
  for (let i = 0; i < headers.length; i++) {
    if (headers[i][1] !== file) continue;
    if (line === undefined) return false;
    if (!Number.isSafeInteger(line) || line <= 0) return false;
    const bodyStart = headers[i].index! + headers[i][0].length;
    const bodyEnd = headers[i + 1]?.index ?? source.length;
    const body = source.slice(bodyStart, bodyEnd);
    if (new RegExp(`^ *${line}\\| `, "m").test(body)) return true;
  }
  return false;
}

export interface AuditPendingUnits<T> {
  chunk: number;
  completed: Record<string, { findings: T[]; provider: string; model: string }>;
  nextRoute: number;
}

/** Only completed, committed units are reusable. A hung current unit changes writer. */
export async function resumeAuditUnits<T>(ports: {
  units: readonly string[];
  pending: AuditPendingUnits<T>;
  routes: readonly AuditRoute[];
  persist(): Promise<void>;
  invoke(route: AuditRoute, source: string): Promise<{ findings: T[]; provider: string; model: string }>;
  available?(route: AuditRoute, source: string): Promise<boolean>;
  failed?(route: AuditRoute, error: unknown): void | Promise<void>;
  reuse?(source: string): { findings: T[]; provider: string; model: string } | undefined;
  committed?(source: string, receipt: { findings: T[]; provider: string; model: string }): void;
  beforeDispatch?(route: AuditRoute, source: string): Promise<void>;
  succeeded?(source: string, receipt: { findings: T[]; provider: string; model: string }): Promise<void>;
}): Promise<T[]> {
  const keys = Object.keys(ports.pending.completed).sort((a,b) => Number(a)-Number(b));
  if (keys.length > ports.units.length || keys.some((k,i) => k !== String(i)))
    throw new Error("Non-contiguous audit unit checkpoint");
  for (let u = 0; u < ports.units.length; u++) {
    if (ports.pending.completed[String(u)]) continue;
    const cached = ports.reuse?.(ports.units[u]);
    const receipt = cached ?? await runAuditFallback({
      routes: ports.routes, cursor: ports.pending.nextRoute,
      beforeAttempt: async next => { ports.pending.nextRoute = next; await ports.persist(); },
      invoke: route => ports.invoke(route, ports.units[u]),
      failed: ports.failed,
      available: route => ports.available?.(route, ports.units[u]) ?? Promise.resolve(true),
      beforeDispatch: route => ports.beforeDispatch?.(route, ports.units[u]) ?? Promise.resolve(),
    });
    ports.committed?.(ports.units[u], receipt);
    ports.pending.completed[String(u)] = receipt;
    ports.pending.nextRoute = 0;
    await ports.persist();
    if (!cached) await ports.succeeded?.(ports.units[u], receipt);
  }
  return Object.values(ports.pending.completed).flatMap(r => r.findings);
}
