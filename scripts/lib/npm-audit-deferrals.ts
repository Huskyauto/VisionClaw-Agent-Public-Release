/**
 * npm-audit-deferrals — advisory-id-scoped deferral classification for the
 * weekly-maintenance Pass 1 (npm dependency audit).
 *
 * SECURITY CONTRACT (fail closed everywhere):
 *   - Deferrals are keyed on EXACT advisory ids (GHSA-…), never package names.
 *     A newly disclosed severe advisory — even in a package already affected by
 *     a deferred advisory — has a new GHSA id and therefore stays RED.
 *   - Each deferral carries a mandatory `reviewBy` date; an expired entry is
 *     ignored (treated as not deferred).
 *   - A malformed/missing deferral file yields an empty allowlist (nothing
 *     deferred).
 *   - A severe package whose advisory closure cannot be resolved to at least
 *     one severe advisory object is NOT considered deferred (parse weirdness
 *     must never look like coverage).
 *
 * Pure logic, no I/O — the caller reads the audit JSON and the deferral file.
 */

export interface DeferralEntry {
  /** Exact advisory id, e.g. "GHSA-mh99-v99m-4gvg". */
  advisory: string;
  reason: string;
  /** Where the deferral decision is documented (doc path / section). */
  reference: string;
  /** ISO date the deferral was made. */
  deferredAt: string;
  /** ISO date after which the deferral EXPIRES and stops applying. */
  reviewBy: string;
}

const GHSA_RE = /GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i;

/**
 * Strict-parse the deferral file contents. Any shape mismatch on an entry
 * drops THAT entry (and a non-object / non-array root drops everything).
 * Expired entries (reviewBy < now) are dropped.
 */
export function parseDeferrals(raw: unknown, now: Date): DeferralEntry[] {
  if (typeof raw !== "object" || raw === null) return [];
  const list = (raw as { deferrals?: unknown }).deferrals;
  if (!Array.isArray(list)) return [];
  const out: DeferralEntry[] = [];
  for (const e of list) {
    if (typeof e !== "object" || e === null) continue;
    const d = e as Record<string, unknown>;
    if (
      typeof d.advisory !== "string" || !GHSA_RE.test(d.advisory) ||
      typeof d.reason !== "string" || !d.reason.trim() ||
      typeof d.reference !== "string" || !d.reference.trim() ||
      typeof d.deferredAt !== "string" ||
      typeof d.reviewBy !== "string"
    ) continue;
    const reviewBy = new Date(d.reviewBy);
    if (Number.isNaN(reviewBy.getTime()) || reviewBy.getTime() < now.getTime()) continue; // expired or unparseable ⇒ not deferred
    out.push({
      advisory: normGhsa(d.advisory)!,
      reason: d.reason,
      reference: d.reference,
      deferredAt: d.deferredAt,
      reviewBy: d.reviewBy,
    });
  }
  return out;
}

function normGhsa(s: string): string | null {
  const m = s.match(GHSA_RE);
  if (!m) return null;
  // Canonical form: "GHSA-" prefix uppercase, suffix lowercase (GitHub's form).
  const parts = m[0].split("-");
  return ["GHSA", ...parts.slice(1).map((p) => p.toLowerCase())].join("-");
}

interface AuditVia {
  name?: string;
  severity?: string;
  url?: string;
  source?: unknown;
}

interface AuditVuln {
  severity?: string;
  via?: Array<AuditVia | string>;
}

export interface SevereClassification {
  /** Packages npm reports as high/critical. */
  severePackages: string[];
  /** Distinct severe advisory ids found in those packages' closures. */
  severeAdvisories: string[];
  /** Severe advisory ids NOT covered by an active deferral. */
  undeferredAdvisories: string[];
  /** Severe packages whose closure resolved to zero severe advisory objects (fail closed: never deferred). */
  unresolvedPackages: string[];
  /** True iff there IS severe fallout and EVERY severe advisory + package is covered. */
  allSevereDeferred: boolean;
}

/**
 * Classify severe (high/critical) audit fallout against the active deferrals.
 *
 * For each severe package, resolves its `via` closure (following string vias to
 * other packages, cycle-safe) and collects every advisory OBJECT with severity
 * high/critical, keyed by GHSA id. Downgrade is allowed only when:
 *   - at least one severe package exists, AND
 *   - every severe package resolved to ≥1 severe advisory, AND
 *   - every distinct severe advisory id is on the active deferral list.
 */
export function classifySevere(
  vulnerabilities: Record<string, AuditVuln> | undefined,
  deferrals: DeferralEntry[]
): SevereClassification {
  const vulns = vulnerabilities ?? {};
  const allow = new Set(deferrals.map((d) => normGhsa(d.advisory)).filter(Boolean) as string[]);

  const severePackages = Object.entries(vulns)
    .filter(([, v]) => v?.severity === "high" || v?.severity === "critical")
    .map(([name]) => name);

  const severeAdvisories = new Set<string>();
  const unresolvedPackages: string[] = [];

  for (const pkg of severePackages) {
    const found = new Set<string>();
    const visited = new Set<string>();
    const stack = [pkg];
    while (stack.length) {
      const cur = stack.pop()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      const v = vulns[cur];
      for (const via of v?.via ?? []) {
        if (typeof via === "string") {
          stack.push(via);
        } else if (via && typeof via === "object") {
          if (via.severity === "high" || via.severity === "critical") {
            const id = normGhsa(String(via.url ?? "")) ?? normGhsa(String(via.source ?? ""));
            if (id) found.add(id);
            else unresolvedPackages.push(cur); // severe advisory with no resolvable id ⇒ fail closed
          }
        }
      }
    }
    if (found.size === 0) unresolvedPackages.push(pkg);
    for (const id of found) severeAdvisories.add(id);
  }

  const severeAdvisoryList = [...severeAdvisories];
  const undeferredAdvisories = severeAdvisoryList.filter((id) => !allow.has(id));
  const allSevereDeferred =
    severePackages.length > 0 &&
    unresolvedPackages.length === 0 &&
    severeAdvisoryList.length > 0 &&
    undeferredAdvisories.length === 0;

  return {
    severePackages,
    severeAdvisories: severeAdvisoryList,
    undeferredAdvisories,
    unresolvedPackages: [...new Set(unresolvedPackages)],
    allSevereDeferred,
  };
}
