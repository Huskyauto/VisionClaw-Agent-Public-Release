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
  "lobster",
  "manage_skills",
  "create_tool",
  "delete_custom_tool",
  "create_pdf",
  "fill_pdf",
  "edit_pdf",
  "google_drive",
  "deliver_product",
]);

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
]);

export type ToolRiskLevel = "read_only" | "mutating" | "high_risk";

export interface ToolMutationInfo {
  name: string;
  riskLevel: ToolRiskLevel;
  isMutating: boolean;
  requiresConfirmation: boolean;
  description: string;
}

export function classifyToolRisk(toolName: string): ToolMutationInfo {
  const normalized = toolName.trim().toLowerCase();

  if (HIGH_RISK_TOOLS.has(normalized)) {
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

export function isHighRiskTool(toolName: string): boolean {
  return HIGH_RISK_TOOLS.has(toolName.trim().toLowerCase());
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

  let timeoutMs = 120_000;
  try {
    const { getApprovalTimeoutMs, sendApprovalRequest, registerShortId, notifyApprovalTimeout } = require("./whatsapp-approval");
    timeoutMs = getApprovalTimeoutMs(tenantId);
    registerShortId(confirmationId, tenantId);
    const description = getToolDescription(toolName);
    sendApprovalRequest(confirmationId, toolName, args, description, tenantId).catch(() => {});
  } catch {}

  const capturedTimeout = timeoutMs;
  setTimeout(() => {
    const pending = pendingConfirmations.get(confirmationId);
    if (pending) {
      pending.resolve(false);
      pendingConfirmations.delete(confirmationId);
      console.log(`[hitl] Confirmation ${confirmationId} timed out (auto-denied after ${capturedTimeout / 1000}s)`);
      try {
        const { notifyApprovalTimeout } = require("./whatsapp-approval");
        notifyApprovalTimeout(confirmationId, toolName, tenantId).catch(() => {});
      } catch {}
    }
  }, capturedTimeout);

  return { confirmationId, promise };
}

export function resolveToolConfirmation(confirmationId: string, approved: boolean, requesterTenantId?: number): boolean {
  const pending = pendingConfirmations.get(confirmationId);
  if (!pending) return false;

  if (requesterTenantId != null && pending.conversationId != null) {
    if (pending.tenantId != null && pending.tenantId !== requesterTenantId) {
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
