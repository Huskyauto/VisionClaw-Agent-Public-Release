import { logSilentCatch } from "./lib/silent-catch";
import { escalateHITL } from "./escalation-channels";
import { evaluatePolicy, recordPolicyAudit } from "./policy-engine";

const MUTATING_TOOLS = new Set([
  "create_memory",
  "update_memory",
  "write_daily_note",
  "create_knowledge",
  "delegate_task",
  "send_email",
  "sessions_send",
  "sessions_spawn",
  "browser",
  "stealth_browse",
  "stealth_browse_camofox",
  "lobster",
  "manage_skills",
  "create_tool",
  "delete_custom_tool",
  "create_pdf",
  "fill_pdf",
  "edit_pdf",
  "google_drive",
  "deliver_product",
  // R74.13z-quint+7 SECURITY (Tier-1 #7): google_workspace was completely
  // missing from the mutation classifier, so gmail send / calendar create &
  // delete / sheets update / docs create / contacts create all bypassed the
  // approval gate. Mark the umbrella tool mutating; the sub-action map below
  // upgrades the high-impact verbs to high_risk.
  "google_workspace",
  // R76 review fix (CRITICAL #1) — set_policy mutates the security posture
  // itself; classify as mutating so the HITL pipeline always engages. The
  // policy engine NEVER_AUTO_APPROVE list is the second line of defense.
  "set_policy",
]);

// R74.13z-quint+7 SECURITY (Tier-1 #7): umbrella tools whose true risk depends
// on a `service`/`action` pair carried in args. Anything matched here is
// promoted to high_risk and forced through HITL approval.
const HIGH_RISK_SUB_ACTIONS: Record<string, Set<string>> = {
  google_workspace: new Set([
    "gmail.send",
    "calendar.create",
    "calendar.delete",
    "sheets.update",
    "sheets.append",
    "sheets.clear",
    "docs.create",
    "docs.update",
    "contacts.create",
    "drive.delete",
    "drive.upload",
  ]),
  // R96 — Camofox stealth browser actions that cause real external side
  // effects (form submits, post-navigation state changes on third-party
  // sites) get promoted to high_risk so HITL approval engages.
  // R96.1+architect-CRITICAL-#1 fix: added `open` to the high-risk set —
  // opening an LLM-controlled URL inside a real-browser session that
  // persists cookies + storage_state per tenant IS a side-effectful
  // action against an attacker-controlled origin (drive-by exploits,
  // tracking pixel beacons, fingerprint collection that pollutes the
  // tenant's session for future calls). Read-only actions (snapshot,
  // list_tabs, screenshot, close_*, scroll) remain at the mutating tier.
  stealth_browse_camofox: new Set([
    "open",
    "click",
    "type",
    "navigate",
    "extract",
  ]),
};

const DELIVERY_READ_TOOLS = new Set([
  "delivery_status",
]);

const READ_ONLY_TOOLS = new Set([
  "delivery_status",
  "search_memory",
  "search_knowledge",
  "get_daily_notes",
  "list_conversations",
  "list_models",
  "check_system_status",
  "test_api_keys",
  "web_fetch",
  "web_search",
  "check_inbox",
  "generate_chart",
  "sessions_list",
  "sessions_history",
  "list_custom_tools",
  "list_pdf_fields",
  "analyze_pdf",
  "get_experiments",
]);

const HIGH_RISK_TOOLS = new Set([
  "send_email",
  "delegate_task",
  "sessions_send",
  "whatsapp",
  "exec",
  "shell_exec",
  "draft_social_post",
  "marketing_experiment",
  // R76 review fix (CRITICAL re-review) — guarded-tool-executor only calls
  // requestToolConfirmation() when requiresConfirmation is true, which is
  // false for the "mutating" tier. set_policy and the other immutable
  // admin tools MUST be classified as high_risk so the policy engine + HITL
  // gate is reached at all. Adding them to MUTATING_TOOLS alone is not
  // sufficient (the gate is upstream in guarded-tool-executor).
  "set_policy",
  "create_tool",
  "delete_custom_tool",
  "manage_skills",
  "lobster",
  // R98.11+sec2 — Architect HIGH: slash_command action='run' executes
  // arbitrary shell from .bob/commands/*.md bodies. Owner-tenant +
  // Felix(2)/Forge(3) gate fires inside the tool, but routing through
  // the high-risk classification ensures HITL/policy machinery sees it
  // as the RCE-class surface it is, not as a default read-only call.
  "slash_command",
]);

export type ToolRiskLevel = "read_only" | "mutating" | "high_risk";

export interface ToolMutationInfo {
  name: string;
  riskLevel: ToolRiskLevel;
  isMutating: boolean;
  requiresConfirmation: boolean;
  description: string;
}

// R74.13z-quint+7 SECURITY (Tier-1 #7): for umbrella tools (google_workspace
// today, room for more later) check the args for a high-risk sub-action.
// R96.1+architect-CRITICAL-#1 fix: previously this only matched the
// `service.action` shape used by google_workspace, so tools like
// stealth_browse_camofox that pass `action` alone (no `service`) silently
// fell through to the mutating tier and skipped HITL. Now matches BOTH
// `service.action` and bare `action` against the same Set, so a tool author
// can register either pattern in HIGH_RISK_SUB_ACTIONS and the gate fires.
function isHighRiskSubAction(toolName: string, args?: Record<string, unknown> | null): boolean {
  if (!args || typeof args !== "object") return false;
  const subMap = HIGH_RISK_SUB_ACTIONS[toolName];
  if (!subMap) return false;
  const service = typeof (args as any).service === "string" ? (args as any).service.toLowerCase() : "";
  const action = typeof (args as any).action === "string" ? (args as any).action.toLowerCase() : "";
  if (!action) return false;
  if (service && subMap.has(`${service}.${action}`)) return true;
  // Action-only fallback for tools that don't multiplex by service
  return subMap.has(action);
}

export function classifyToolRisk(toolName: string, args?: Record<string, unknown> | null): ToolMutationInfo {
  const normalized = toolName.trim().toLowerCase();

  if (HIGH_RISK_TOOLS.has(normalized) || isHighRiskSubAction(normalized, args)) {
    return {
      name: normalized,
      riskLevel: "high_risk",
      isMutating: true,
      requiresConfirmation: true,
      description: getToolDescription(normalized),
    };
  }

  if (MUTATING_TOOLS.has(normalized)) {
    return {
      name: normalized,
      riskLevel: "mutating",
      isMutating: true,
      requiresConfirmation: false,
      description: getToolDescription(normalized),
    };
  }

  return {
    name: normalized,
    riskLevel: "read_only",
    isMutating: false,
    requiresConfirmation: false,
    description: getToolDescription(normalized),
  };
}

export function isMutatingTool(toolName: string): boolean {
  const normalized = toolName.trim().toLowerCase();
  return MUTATING_TOOLS.has(normalized) || HIGH_RISK_TOOLS.has(normalized);
}

export function isHighRiskTool(toolName: string, args?: Record<string, unknown> | null): boolean {
  const normalized = toolName.trim().toLowerCase();
  return HIGH_RISK_TOOLS.has(normalized) || isHighRiskSubAction(normalized, args);
}

interface PendingConfirmation {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  riskLevel: ToolRiskLevel;
  resolve: (approved: boolean) => void;
  createdAt: number;
  conversationId?: number;
  tenantId?: number;
}

const pendingConfirmations = new Map<string, PendingConfirmation>();

export function requestToolConfirmation(
  toolName: string,
  args: Record<string, unknown>,
  riskLevel: ToolRiskLevel,
  conversationId?: number,
  tenantId?: number,
): { confirmationId: string; promise: Promise<boolean> } {
  const confirmationId = `confirm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  let resolveRef: (approved: boolean) => void;
  const promise = new Promise<boolean>((resolve) => {
    resolveRef = resolve;
  });

  const actionKey = typeof args?.command === "string" ? (args.command as string)
    : typeof args?.action === "string" ? (args.action as string)
    : typeof args?.method === "string" ? (args.method as string)
    : undefined;

  // R76 — Async policy gate. Resolves immediately on allow/deny; falls through
  // to the HITL setup (WhatsApp + 120s timeout) only on require_approval.
  let armed = false;
  const armHITL = () => {
    if (armed) return;
    armed = true;
    pendingConfirmations.set(confirmationId, {
      id: confirmationId,
      toolName,
      args,
      riskLevel,
      resolve: resolveRef!,
      createdAt: Date.now(),
      conversationId,
      tenantId,
    });

    // R76 review fix (HIGH #4) — was using bare require() which silent-fails
    // under ESM ("require is not defined"), so the WhatsApp approval channel
    // was completely dead and timeout was always 120s with no notification.
    // createRequire() also fails under tsx for cross-ESM loads; use a lazy
    // dynamic import() inside an IIFE so the circular dep with this file
    // resolves at call time instead of module-init time.
    let timeoutMs = 120_000;
    (async () => {
      try {
        const wa = await import("./whatsapp-approval");
        timeoutMs = wa.getApprovalTimeoutMs(tenantId);
        wa.registerShortId(confirmationId, tenantId);
        const description = getToolDescription(toolName);
        wa.sendApprovalRequest(confirmationId, toolName, args, description, tenantId).catch(() => {});
      } catch (_silentErr) { logSilentCatch("server/tool-mutation.ts", _silentErr); }
    })();

    const capturedTimeout = timeoutMs;
    setTimeout(() => {
      const pending = pendingConfirmations.get(confirmationId);
      if (pending) {
        pending.resolve(false);
        pendingConfirmations.delete(confirmationId);
        console.log(`[hitl] Confirmation ${confirmationId} timed out (auto-denied after ${capturedTimeout / 1000}s)`);
        (async () => {
          try {
            const wa = await import("./whatsapp-approval");
            wa.notifyApprovalTimeout(confirmationId, toolName, tenantId).catch(() => {});
          } catch (_silentErr) { logSilentCatch("server/tool-mutation.ts", _silentErr); }
        })();
      }
    }, capturedTimeout);

    // Real escalation channel (email + SSE) — fire-and-forget.
    if (tenantId && tenantId > 0) {
      try {
        escalateHITL({ tenantId, confirmationId, toolName, action: actionKey, args, conversationId }).catch(() => {});
      } catch (_e) { logSilentCatch("server/tool-mutation.ts", _e); }
    }
  };

  if (tenantId && tenantId > 0) {
    (async () => {
      try {
        const decision = await evaluatePolicy({ tenantId, toolName, action: actionKey, params: args });
        recordPolicyAudit({ tenantId, toolName, action: actionKey, params: args }, decision).catch(() => {});

        if (decision.decision === "allow") {
          console.log(`[policy] auto-approved ${toolName}${actionKey ? ":" + actionKey : ""} for tenant ${tenantId} (${decision.reason})`);
          resolveRef!(true);
          return;
        }
        if (decision.decision === "deny") {
          console.log(`[policy] DENIED ${toolName}${actionKey ? ":" + actionKey : ""} for tenant ${tenantId} (${decision.reason})`);
          resolveRef!(false);
          return;
        }
        armHITL();
      } catch (e) {
        console.warn(`[policy] eval failed for ${toolName}: ${(e as Error).message} — falling through to HITL`);
        armHITL();
      }
    })();
  } else {
    armHITL();
  }

  return { confirmationId, promise };
}

export function resolveToolConfirmation(confirmationId: string, approved: boolean, requesterTenantId?: number): boolean {
  const pending = pendingConfirmations.get(confirmationId);
  if (!pending) return false;

  // R79.3f — Tenant authorization is enforced whenever BOTH the caller and
  // the pending confirmation know their tenants. Earlier this gate was
  // additionally conditioned on `pending.conversationId != null`, which
  // meant a confirmation created in a non-conversation context (background
  // job, scheduled tool call) skipped the check entirely — a guessable or
  // leaked confirmationId could then be resolved by any authenticated
  // tenant. Removed that conversationId gate.
  if (requesterTenantId != null && pending.tenantId != null) {
    if (pending.tenantId !== requesterTenantId) {
      console.log(`[hitl] Denied resolution for ${confirmationId}: tenant mismatch (${requesterTenantId} vs ${pending.tenantId})`);
      return false;
    }
  }

  pending.resolve(approved);
  pendingConfirmations.delete(confirmationId);
  console.log(`[hitl] Confirmation ${confirmationId} ${approved ? "APPROVED" : "DENIED"} for ${pending.toolName}`);
  return true;
}

export function getPendingConfirmations(conversationId?: number): PendingConfirmation[] {
  const results: PendingConfirmation[] = [];
  for (const [, pc] of pendingConfirmations) {
    if (!conversationId || pc.conversationId === conversationId) {
      results.push({ ...pc, resolve: undefined as any });
    }
  }
  return results;
}

function getToolDescription(name: string): string {
  const descriptions: Record<string, string> = {
    create_memory: "Creates a new persistent memory entry",
    update_memory: "Modifies or archives an existing memory",
    write_daily_note: "Writes to today's daily activity log",
    create_knowledge: "Adds to the knowledge base",
    delegate_task: "Delegates a task to another agent (creates heartbeat task)",
    send_email: "Sends an email externally via AgentMail",
    search_memory: "Searches memory entries (read-only)",
    search_knowledge: "Searches knowledge base (read-only)",
    get_daily_notes: "Retrieves daily notes (read-only)",
    list_conversations: "Lists conversations (read-only)",
    list_models: "Lists available AI models (read-only)",
    check_system_status: "Checks platform status (read-only)",
    test_api_keys: "Tests provider API key validity (read-only)",
    web_fetch: "Fetches a web page (read-only, external)",
    web_search: "Searches the web (read-only, external)",
    check_inbox: "Checks email inbox (read-only, external)",
    generate_chart: "Generates chart data (read-only)",
    browser: "Controls a remote browser (navigate, click, type, screenshot)",
    analyze_pdf: "Extracts text from PDF documents (read-only)",
    show_diff: "Generates text diffs (read-only)",
    exec: "Executes shell commands",
    llm_task: "Runs a focused LLM sub-task",
    sessions_list: "Lists active agent sessions (read-only)",
    sessions_history: "Views session history (read-only)",
    sessions_send: "Sends message to another agent session",
  };
  return descriptions[name] || "Unknown tool";
}

export interface MutationAuditEntry {
  timestamp: string;
  toolName: string;
  riskLevel: ToolRiskLevel;
  args: Record<string, unknown>;
  conversationId?: number;
  personaId?: number | null;
}

const recentMutations: MutationAuditEntry[] = [];
const MAX_AUDIT_LOG = 100;

export function recordMutation(entry: MutationAuditEntry): void {
  recentMutations.push(entry);
  if (recentMutations.length > MAX_AUDIT_LOG) {
    recentMutations.splice(0, recentMutations.length - MAX_AUDIT_LOG);
  }
}

export function getRecentMutations(limit: number = 20): MutationAuditEntry[] {
  return recentMutations.slice(-limit);
}

export function getMutationStats(): {
  total: number;
  byTool: Record<string, number>;
  byRisk: Record<ToolRiskLevel, number>;
} {
  const byTool: Record<string, number> = {};
  const byRisk: Record<ToolRiskLevel, number> = { read_only: 0, mutating: 0, high_risk: 0 };

  for (const entry of recentMutations) {
    byTool[entry.toolName] = (byTool[entry.toolName] || 0) + 1;
    byRisk[entry.riskLevel]++;
  }

  return { total: recentMutations.length, byTool, byRisk };
}
