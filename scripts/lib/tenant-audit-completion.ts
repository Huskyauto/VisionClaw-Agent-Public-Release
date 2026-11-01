import { AUDIT_ROUTE_TIMEOUT_MS, completeAuditText, type AuditRoute } from "./tenant-audit-fallback";

type ResolveOptions = { providerLane?: Exclude<AuditRoute["providerLane"], "cheaperinference">; forbidMeteredFallback?: true };
type Resolved = { client: { chat: { completions: { create(body: any, options: any): Promise<any> } } }; actualModelId: string };
export class AuditRouteRefused extends Error {
  constructor() { super("Audit request refused; do not reformulate or retry this route in the cooldown window"); }
}
export function isAuditRefusal(raw: string): boolean {
  return /^\s*(?:sorry[,\s]+)?(?:I (?:cannot|can't|am unable)|I'm unable)\b/i.test(raw);
}

/** Same closed transport for source, precision and bounded operator probes. */
export async function invokeAuditRoute(route: AuditRoute, system: string, user: string, maxTokens: number, ports: {
  timeoutMs?: number;
  paidAllowed?: () => boolean;
  resolve?: (model: string, tenant: number, options: ResolveOptions) => Promise<Resolved>;
} = {}): Promise<{ raw: string; model: string }> {
  const timeoutMs = Math.min(AUDIT_ROUTE_TIMEOUT_MS, ports.timeoutMs ?? AUDIT_ROUTE_TIMEOUT_MS);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || !Number.isSafeInteger(maxTokens) || maxTokens < 1)
    throw new Error("Invalid bounded audit request");
  const paid = route.providerLane === "cheaperinference";
  if (paid) {
    const allowed = ports.paidAllowed ?? (await import("../../server/lib/cheaper-inference-automatic")).cheaperAutomaticAllowed.bind(null, 1);
    if (!allowed()) throw new Error("Audit paid fallback requires enabled automatic owner budget admission");
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`Audit ${route.providerLane} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  const work = (async () => {
    const resolve = ports.resolve ?? (await import("../../server/providers")).getClientForModel;
    // The named paid model enters ONLY its existing automatic reserve/settle path.
    // A free-only flag would reject that named lane before its budget guard.
    // Never supply explicitOwnerSelection/platformAdminVerified: those alter admission.
    const options: ResolveOptions = paid ? {} : { ...route, providerLane: route.providerLane as ResolveOptions["providerLane"] };
    const { client, actualModelId } = await resolve(route.model, 1, options);
    if (paid && actualModelId !== route.model.slice("cheaperinference/".length))
      throw new Error("Audit paid route identity changed; refusing substitute transport");
    if (controller.signal.aborted) throw new Error("Audit deadline expired before dispatch");
    const limit = Math.min(maxTokens, paid ? 8192 : maxTokens);
    const reasoning = /^(gpt-5|gpt-4\.1|o[1-9])/i.test(actualModelId);
    const response = await client.chat.completions.create({
      model: actualModelId, messages: [{ role: "system", content: system }, { role: "user", content: user }],
      ...(reasoning ? { max_completion_tokens: limit } : { max_tokens: limit, temperature: 0 }),
    }, { signal: controller.signal, maxRetries: 0, timeout: timeoutMs });
    const raw = completeAuditText(response);
    if (isAuditRefusal(raw)) throw new AuditRouteRefused();
    return { raw, model: actualModelId };
  })();
  try { return await Promise.race([work, deadline]); }
  finally { clearTimeout(timer); }
}

export function parseAuditObject(raw: string): unknown {
  const first = raw.indexOf("{"), last = raw.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("Audit response lacks complete JSON");
  return JSON.parse(raw.slice(first, last + 1));
}

/** Never print raw provider errors: they may contain request bodies or credentials. */
export function auditFailureSummary(error: unknown): string {
  const e = error as { status?: unknown; message?: unknown };
  if (Number.isInteger(e?.status) && Number(e.status) >= 100 && Number(e.status) <= 599) return `HTTP ${e.status}`;
  const message = typeof e?.message === "string" ? e.message : "";
  if (/automatic owner budget|spend|budget|reservation/i.test(message)) return "owner budget unavailable";
  if (/catalog/i.test(message)) return "provider catalog rejected";
  if (/disabled|unavailable|requires enabled/i.test(message)) return "provider disabled or unavailable";
  if (/timeout|timed out|deadline|abort/i.test(message)) return "deadline exceeded";
  if (/incomplete|refused|truncated|oversized/i.test(message)) return "response incomplete or refused";
  if (/findings|precision|JSON/i.test(message)) return "response failed audit validation";
  return "provider request failed";
}

export type AuditProviderHealth = Record<string, { until: number; failures: number }>;
export function readAuditProviderHealth(value: unknown): AuditProviderHealth {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).length > 32 ||
      !Object.values(value).every((r: any) => r && Number.isFinite(r.until) && r.until >= 0 &&
        Number.isSafeInteger(r.failures) && r.failures >= 1 && r.failures <= 12))
    throw new Error("Invalid audit provider health checkpoint");
  return value as AuditProviderHealth;
}
export function auditHealthKey(route: AuditRoute): string { return `${route.providerLane}:${route.model}`; }
export function auditProviderFailure(health: AuditProviderHealth, route: AuditRoute, error: unknown, now = Date.now()): AuditProviderHealth {
  const key = auditHealthKey(route);
  const failures = Math.min(12, (health[key]?.failures ?? 0) + 1);
  const ms = error instanceof AuditRouteRefused ? 3600_000 : Math.min(3600_000, 300_000 * 2 ** Math.min(4, failures - 1));
  return { ...health, [key]: { failures, until: now + ms } };
}
export async function auditRouteConfigured(route: AuditRoute): Promise<boolean> {
  if (route.providerLane === "profundo") return process.env.PROFUNDO_ENABLED !== "0";
  if (route.providerLane === "openference") return process.env.OPENFERENCE_ENABLED !== "0";
  if (route.providerLane === "standard-compute") return (await import("../../server/lib/standard-compute")).standardComputeReady();
  if (route.providerLane === "cheaperinference")
    return (await import("../../server/lib/cheaper-inference-automatic")).cheaperAutomaticAllowed(1);
  return true;
}
