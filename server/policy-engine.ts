import { db } from "./db";
import { sql, eq, and, or, gt, isNull, asc } from "drizzle-orm";
import { toolPolicies, policyAudit, type ToolPolicy } from "@shared/schema";

export type PolicyDecision = "allow" | "deny" | "require_approval";

// R76 review fix (CRITICAL #1) — these tools mutate the security posture itself
// and MUST NEVER be auto-approved by a policy. Even owner-tenant rules cannot
// shortcut HITL for these. evaluatePolicy returns require_approval immediately
// regardless of any matching allow rule.
const NEVER_AUTO_APPROVE = new Set<string>([
  "set_policy",
  "create_tool",
  "delete_custom_tool",
  "manage_skills",
  "exec",
  "lobster",
]);

// R79.3c — Owner-self-email auto-approve.
// HITL itself emails the owner (escalateHITL → sendEmail to OWNER_ALERT_EMAIL)
// asking for approval. So if the agent wants to email the owner, requiring
// HITL approval is a self-loop that produces noise (the agent emails the owner
// asking permission to email the owner, then if approved, sends a second email
// to the owner). Bob got spammed by this during the Felix HVAC Test workflow
// where Felix emails admin@visionclaw.ai to deliver test artifacts. Auto-
// approve any send_email whose recipient is an owner-controlled address —
// the threat model HITL exists to block (agent emailing OUTSIDE the org
// without owner sign-off) is unaffected.
function getOwnerEmails(): Set<string> {
  const emails = new Set<string>();
  const env = (process.env as any) || {};
  for (const key of [
    "OWNER_EMAIL",
    "OWNER_ALERT_EMAIL",
    "SITE_OWNER_EMAIL",
    "SITE_CONTACT_EMAIL",
    "OUTPUT_DELIVERY_OVERRIDE_EMAIL",
  ]) {
    const v = String(env[key] || "").toLowerCase().trim();
    if (v && v.includes("@")) emails.add(v);
  }
  // R125+137.27 (Kimi-K3 external-review fix): owner identity is 100%
  // env-driven — NO hardcoded personal fallback. A fork without owner env
  // vars must NOT auto-approve sends to the original author's address.
  // Fail CLOSED: with no owner emails configured, nothing auto-approves
  // (HITL still gates every send) — warn loudly so the operator knows.
  if (emails.size === 0) {
    console.warn(
      "[policy-engine] No owner email env vars set (OWNER_EMAIL / OWNER_ALERT_EMAIL / " +
        "SITE_OWNER_EMAIL / SITE_CONTACT_EMAIL) — send_email owner auto-approve is DISABLED; " +
        "all sends require HITL approval.",
    );
  }
  // R98.25 — admin@visionclaw.ai removed from the auto-approve fallback. SES
  // hard-bounces it (recipient blocklist). Auto-approving sends to a bouncing
  // address just generated noise (24/24 fails on the tool_drift counter).
  // sendEmail's R98.25 pre-flight gate now refuses the address explicitly so
  // any stale Felix test that targets it gets a clear error instead of a 403
  // bounce. If the address is re-verified at the provider, restore here AND
  // remove from EMAIL_BOUNCED_RECIPIENTS / the BOUNCED_DEFAULT set.
  return emails;
}

// Normalize recipient field to a flat string[] of trimmed lowercase addresses.
// Handles: undefined, "", "a@b.com", "a@b.com, c@d.com", ["a@b.com"], [{email:"a@b.com"}, ...].
function normalizeRecipients(field: unknown): string[] {
  if (field == null) return [];
  const out: string[] = [];
  const push = (s: unknown) => {
    if (typeof s === "string") {
      // split comma/semicolon-separated lists too — agents sometimes flatten
      for (const piece of s.split(/[,;]/)) {
        const v = piece.trim().toLowerCase();
        if (v) out.push(v);
      }
    } else if (s && typeof s === "object") {
      const e = (s as any).email || (s as any).address;
      if (typeof e === "string") push(e);
    }
  };
  if (Array.isArray(field)) field.forEach(push);
  else push(field);
  return out;
}

function isOwnerSelfEmail(toolName: string, params: Record<string, unknown> | null | undefined): string | null {
  if (toolName !== "send_email") return null;
  const to = normalizeRecipients((params as any)?.to);
  const cc = normalizeRecipients((params as any)?.cc);
  const bcc = normalizeRecipients((params as any)?.bcc);
  const all = [...to, ...cc, ...bcc];
  if (all.length === 0) return null;
  const owners = getOwnerEmails();
  // Architect review (R79.3c): every recipient (to + cc + bcc) must be owner-
  // controlled. Otherwise an agent could bypass HITL by sending
  // to=admin@visionclaw.ai, cc=victim@outside.com.
  if (!all.every((r) => owners.has(r))) return null;
  return to[0] || cc[0] || bcc[0] || null;
}

export interface PolicyEvalInput {
  tenantId: number;
  toolName: string;
  action?: string;
  params?: Record<string, unknown> | null;
  amountCents?: number;
}

export interface PolicyEvalResult {
  decision: PolicyDecision;
  matchedPolicyId?: number;
  reason: string;
}

let cache: { rows: ToolPolicy[]; loadedAt: number; tenantId: number } | null = null;
const CACHE_TTL_MS = 30_000;

async function loadPolicies(tenantId: number): Promise<ToolPolicy[]> {
  if (cache && cache.tenantId === tenantId && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
    return cache.rows;
  }
  const rows = await db
    .select()
    .from(toolPolicies)
    .where(
      and(
        eq(toolPolicies.tenantId, tenantId),
        eq(toolPolicies.enabled, true),
        or(isNull(toolPolicies.expiresAt), gt(toolPolicies.expiresAt, new Date())),
      ),
    )
    .orderBy(asc(toolPolicies.id));
  cache = { rows, loadedAt: Date.now(), tenantId };
  return cache.rows;
}

export function invalidatePolicyCache(): void {
  cache = null;
}

function matchPattern(pattern: string, value: string): boolean {
  if (pattern === "*") return true;
  if (!pattern.includes("*")) return pattern === value;
  const regex = new RegExp(
    "^" +
      pattern
        .split("*")
        .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*") +
      "$",
    "i",
  );
  return regex.test(value);
}

function matchesScope(policy: ToolPolicy, input: PolicyEvalInput): boolean {
  const tool = input.toolName.toLowerCase();
  const action = (input.action || "").toLowerCase();
  switch (policy.scopeKind) {
    case "tool":
      return matchPattern(policy.scopeValue.toLowerCase(), tool);
    case "tool_action": {
      const [pTool, pAction] = policy.scopeValue.toLowerCase().split(":");
      return matchPattern(pTool, tool) && matchPattern(pAction || "*", action);
    }
    case "tool_recipient_pattern": {
      const [pTool, pRecipient] = policy.scopeValue.toLowerCase().split("|");
      if (!matchPattern(pTool, tool)) return false;
      const recipient = String(input.params?.to || input.params?.recipient || "").toLowerCase();
      if (!recipient) return false;
      return matchPattern(pRecipient || "*", recipient);
    }
    default:
      return false;
  }
}

// R76 (review fix) — Most-specific match wins. Higher score = more specific.
// scopeKind base: tool=1, tool_action=2, tool_recipient_pattern=3.
// +2 if scope value has no wildcards (exact match), +1 if wildcards but not pure "*".
// +1 if maxAmountCents is set (amount-bound is more specific than unbounded).
// Deterministic tiebreak: higher id (newer) wins.
function specificityScore(policy: ToolPolicy): number {
  let score = 0;
  switch (policy.scopeKind) {
    case "tool": score += 1; break;
    case "tool_action": score += 2; break;
    case "tool_recipient_pattern": score += 3; break;
  }
  const sv = policy.scopeValue || "";
  if (!sv.includes("*")) score += 2;
  else if (sv !== "*") score += 1;
  if (policy.maxAmountCents != null) score += 1;
  return score;
}

function rankPolicies(policies: ToolPolicy[]): ToolPolicy[] {
  return [...policies].sort((a, b) => {
    const sa = specificityScore(a);
    const sb = specificityScore(b);
    if (sa !== sb) return sb - sa;
    return b.id - a.id;
  });
}

function violatesAmountCap(policy: ToolPolicy, input: PolicyEvalInput): boolean {
  if (policy.maxAmountCents == null) return false;
  const amount =
    input.amountCents ??
    (typeof input.params?.amount_cents === "number" ? (input.params.amount_cents as number) : null) ??
    (typeof input.params?.amount === "number" ? Math.round((input.params.amount as number) * 100) : null);
  if (amount == null) return false;
  return amount > policy.maxAmountCents;
}

export async function evaluatePolicy(input: PolicyEvalInput): Promise<PolicyEvalResult> {
  if (!input.tenantId || input.tenantId < 1) {
    return { decision: "require_approval", reason: "no-tenant" };
  }

  // R79.3c — Auto-approve send_email to the owner BEFORE any other check.
  // See getOwnerEmails() above for rationale (HITL self-loop). Note: this
  // intentionally bypasses NEVER_AUTO_APPROVE — send_email is not in that
  // set anyway, and if it were, the same self-loop reasoning would apply.
  const selfEmailRecipient = isOwnerSelfEmail((input.toolName || "").trim().toLowerCase(), input.params);
  if (selfEmailRecipient) {
    return { decision: "allow", reason: `owner-self-email:${selfEmailRecipient}` };
  }

  // R76 review fix (CRITICAL #1) — security-sensitive tools always go through
  // HITL regardless of policy state. Explicit deny rules still take effect.
  // Architect re-review: normalize tool name to lowercase before veto check
  // so casing variants ("Set_Policy", "SET_POLICY") cannot bypass the gate.
  const normalizedTool = (input.toolName || "").trim().toLowerCase();
  if (NEVER_AUTO_APPROVE.has(normalizedTool)) {
    const policies = await loadPolicies(input.tenantId);
    const denyMatch = policies.find(
      (p) => matchesScope(p, input) && p.action === "deny",
    );
    if (denyMatch) {
      return {
        decision: "deny",
        matchedPolicyId: denyMatch.id,
        reason: `policy-deny:${denyMatch.reason || denyMatch.scopeValue}`,
      };
    }
    return { decision: "require_approval", reason: "never-auto-approve" };
  }

  const policies = await loadPolicies(input.tenantId);
  if (!policies.length) return { decision: "require_approval", reason: "no-policies" };

  const matches = policies.filter((p) => matchesScope(p, input));
  if (!matches.length) return { decision: "require_approval", reason: "no-match" };

  // R76 (review fix) — most-specific wins. Within the top specificity tier,
  // deny beats allow beats require_approval (so a tied deny is honored).
  const ranked = rankPolicies(matches);
  const topScore = specificityScore(ranked[0]);
  const topTier = ranked.filter((p) => specificityScore(p) === topScore);

  const tieredDeny = topTier.find((p) => p.action === "deny");
  if (tieredDeny) {
    return { decision: "deny", matchedPolicyId: tieredDeny.id, reason: `policy-deny:${tieredDeny.reason || tieredDeny.scopeValue}` };
  }

  const tieredAllowOk = topTier.find((p) => p.action === "allow" && !violatesAmountCap(p, input));
  if (tieredAllowOk) {
    return { decision: "allow", matchedPolicyId: tieredAllowOk.id, reason: `policy-allow:${tieredAllowOk.reason || tieredAllowOk.scopeValue}` };
  }

  // R76 review fix (HIGH #3) — if the most-specific tier had an allow rule whose
  // amount cap was exceeded, the user's intent for THIS scope was to cap
  // spending. Falling through to a less-specific unbounded allow would defeat
  // that cap. Force HITL instead. A specific deny still wins (handled above).
  const tieredCappedAllow = topTier.find((p) => p.action === "allow" && violatesAmountCap(p, input));
  if (tieredCappedAllow) {
    return {
      decision: "require_approval",
      matchedPolicyId: tieredCappedAllow.id,
      reason: `policy-cap-exceeded:${tieredCappedAllow.reason || tieredCappedAllow.scopeValue}`,
    };
  }

  const tieredRequire = topTier.find((p) => p.action === "require_approval");
  if (tieredRequire) {
    return { decision: "require_approval", matchedPolicyId: tieredRequire.id, reason: `policy-require:${tieredRequire.reason || tieredRequire.scopeValue}` };
  }

  // Top tier matched only with rules that didn't decisively allow/deny — fall
  // through to lower-specificity rules.
  for (const p of ranked) {
    if (p.action === "deny") {
      return { decision: "deny", matchedPolicyId: p.id, reason: `policy-deny:${p.reason || p.scopeValue}` };
    }
    if (p.action === "allow" && !violatesAmountCap(p, input)) {
      return { decision: "allow", matchedPolicyId: p.id, reason: `policy-allow:${p.reason || p.scopeValue}` };
    }
  }

  return { decision: "require_approval", reason: "matched-but-amount-cap-exceeded" };
}

function summarizeParams(params?: Record<string, unknown> | null): Record<string, unknown> {
  if (!params) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (k.startsWith("_")) continue;
    if (typeof v === "string") out[k] = v.length > 120 ? v.slice(0, 120) + "..." : v;
    else if (typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (Array.isArray(v)) out[k] = `[array len=${v.length}]`;
    else if (v && typeof v === "object") out[k] = `[object keys=${Object.keys(v as object).length}]`;
  }
  return out;
}

export async function recordPolicyAudit(input: PolicyEvalInput, result: PolicyEvalResult): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO policy_audit (tenant_id, tool_name, action, decision, matched_policy_id, reason, params_summary)
      VALUES (${input.tenantId}, ${input.toolName}, ${input.action || null}, ${result.decision}, ${result.matchedPolicyId || null}, ${result.reason}, ${JSON.stringify(summarizeParams(input.params))}::jsonb)
    `);
  } catch (e) {
    console.warn(`[policy-engine] audit insert failed: ${(e as Error).message}`);
  }
}

export async function listPoliciesForTenant(tenantId: number): Promise<ToolPolicy[]> {
  return loadPolicies(tenantId);
}

export async function createPolicy(input: {
  tenantId: number;
  scopeKind: "tool" | "tool_action" | "tool_recipient_pattern";
  scopeValue: string;
  action: "allow" | "deny" | "require_approval";
  maxAmountCents?: number;
  reason?: string;
  createdBy?: string;
  expiresAt?: Date;
}): Promise<{ id: number }> {
  const result = await db.execute(sql`
    INSERT INTO tool_policies (tenant_id, scope_kind, scope_value, action, max_amount_cents, reason, created_by, expires_at)
    VALUES (${input.tenantId}, ${input.scopeKind}, ${input.scopeValue}, ${input.action},
            ${input.maxAmountCents ?? null}, ${input.reason ?? ""}, ${input.createdBy ?? "owner"},
            ${input.expiresAt ?? null})
    RETURNING id
  `);
  const id = ((result as any).rows?.[0]?.id ?? (result as any)[0]?.id) as number;
  invalidatePolicyCache();
  return { id };
}

export async function deletePolicy(tenantId: number, policyId: number): Promise<boolean> {
  const result = await db.execute(sql`
    DELETE FROM tool_policies WHERE id = ${policyId} AND tenant_id = ${tenantId}
  `);
  invalidatePolicyCache();
  return ((result as any).rowCount ?? 0) > 0;
}
