// Tool Retirement (eviction loop) — pure classification logic.
// Contract: data/feature-contracts/tool-forge-eviction/. Flag-only: this module
// decides which tools are retirement CANDIDATES; it never deletes anything.
// The driver (scripts/tool-retirement-pass.ts) queues candidates into the HITL
// approval queue. Kept DB-free so tests stay query-free (pg-pool-hang rule).

export interface RetirementToolInfo {
  name: string;
  categories: string[];
}

export interface RetirementUsage {
  successCount: number;
  failCount: number;
  /** Most recent activity (success or failure) across ALL tenants; null = never invoked. */
  lastActivityAt: Date | null;
}

export interface RetirementExemptions {
  tools: Set<string>;
  categories: Set<string>;
}

export interface RetirementCandidate {
  tool: string;
  reason: "zero_invocations" | "high_failure";
  evidence: {
    successCount: number;
    failCount: number;
    lastActivityAt: string | null;
    windowDays: number;
    failRate?: number;
  };
}

export interface ClassifyRetirementInput {
  tools: RetirementToolInfo[];
  /** Aggregated tool_performance rows keyed by tool name. Absent key = zero telemetry ever. */
  usage: Map<string, RetirementUsage>;
  exemptions: RetirementExemptions;
  /** Zero-invocation window in days. */
  windowDays: number;
  /** Minimum invocation sample before a high-failure flag is allowed. */
  minSample: number;
  /** Fail-rate threshold (0..1) for the high-failure flag. */
  failRateThreshold: number;
  /** Hard cap on candidates returned per run. */
  maxCandidates: number;
  now: Date;
}

/**
 * Strict, fail-closed parser for the exemptions file contents.
 * Throws on ANY shape mismatch (missing keys, non-array, non-string entries,
 * empty strings) so a typoed exemptions file aborts the run instead of
 * silently classifying with zero protections.
 */
export function parseExemptions(raw: unknown): RetirementExemptions {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("exemptions file must be a JSON object with 'tools' and 'categories' arrays");
  }
  const obj = raw as Record<string, unknown>;
  for (const key of ["tools", "categories"] as const) {
    const v = obj[key];
    if (!Array.isArray(v)) {
      throw new Error(`exemptions.${key} must be an array of strings (got ${v === undefined ? "missing" : typeof v})`);
    }
    for (const entry of v) {
      if (typeof entry !== "string" || entry.trim() === "") {
        throw new Error(`exemptions.${key} contains a non-string or empty entry: ${JSON.stringify(entry)}`);
      }
    }
  }
  return {
    tools: new Set<string>(obj.tools as string[]),
    categories: new Set<string>(obj.categories as string[]),
  };
}

export function isExempt(tool: RetirementToolInfo, exemptions: RetirementExemptions): boolean {
  if (exemptions.tools.has(tool.name)) return true;
  for (const c of tool.categories) {
    if (exemptions.categories.has(c)) return true;
  }
  return false;
}

/**
 * Classify retirement candidates. Deterministic: sorted stalest-first for
 * zero-invocation (never-invoked before stale-invoked), then highest fail-rate,
 * then name — so repeat runs produce a stable, dedupe-friendly ordering.
 */
export function classifyRetirementCandidates(input: ClassifyRetirementInput): RetirementCandidate[] {
  const cutoffMs = input.now.getTime() - input.windowDays * 24 * 3600 * 1000;
  const zero: RetirementCandidate[] = [];
  const failing: RetirementCandidate[] = [];

  for (const tool of input.tools) {
    if (isExempt(tool, input.exemptions)) continue;
    const u = input.usage.get(tool.name) ?? { successCount: 0, failCount: 0, lastActivityAt: null };
    const total = u.successCount + u.failCount;
    const lastMs = u.lastActivityAt ? u.lastActivityAt.getTime() : null;

    if (total === 0 || lastMs === null || lastMs < cutoffMs) {
      zero.push({
        tool: tool.name,
        reason: "zero_invocations",
        evidence: {
          successCount: u.successCount,
          failCount: u.failCount,
          lastActivityAt: u.lastActivityAt ? u.lastActivityAt.toISOString() : null,
          windowDays: input.windowDays,
        },
      });
      continue;
    }

    if (total >= input.minSample) {
      const failRate = u.failCount / total;
      if (failRate >= input.failRateThreshold) {
        failing.push({
          tool: tool.name,
          reason: "high_failure",
          evidence: {
            successCount: u.successCount,
            failCount: u.failCount,
            lastActivityAt: u.lastActivityAt ? u.lastActivityAt.toISOString() : null,
            windowDays: input.windowDays,
            failRate: Math.round(failRate * 1000) / 1000,
          },
        });
      }
    }
  }

  // Stalest first: never-invoked (null) sorts before stale timestamps; ties by name.
  zero.sort((a, b) => {
    const am = a.evidence.lastActivityAt ? Date.parse(a.evidence.lastActivityAt) : -Infinity;
    const bm = b.evidence.lastActivityAt ? Date.parse(b.evidence.lastActivityAt) : -Infinity;
    if (am !== bm) return am - bm;
    return a.tool.localeCompare(b.tool);
  });
  failing.sort((a, b) => {
    const d = (b.evidence.failRate ?? 0) - (a.evidence.failRate ?? 0);
    if (d !== 0) return d;
    return a.tool.localeCompare(b.tool);
  });

  // High-failure candidates are the stronger signal (live but broken) — they
  // take priority in the capped output over the long zero-invocation tail.
  const cap = Math.max(0, input.maxCandidates);
  return [...failing, ...zero].slice(0, cap);
}
