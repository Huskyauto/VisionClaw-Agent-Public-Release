import { executeToolWithTimeout } from "./tools";
import { checkToolRateLimit, recordToolUsage } from "./tool-rate-limiter";
import { getPersonaBlockedTools } from "./tool-router";

import { logSilentCatch } from "./lib/silent-catch";
export type InvokedVia =
  | "main_chat"
  | "public_chat"
  | "chat_engine"
  | "glasses_gateway"
  | "treasury_route"
  | "self_heal"
  | "system";

export interface GuardedExecContext {
  tenantId: number;
  conversationId?: number;
  personaRole?: string;
  invokedVia: InvokedVia;
  /** When true, allows tenantId fallback to admin tenant (1). Required for "system" / "self_heal". */
  allowSystemFallback?: boolean;
  /**
   * R74.13z-quint+7 SECURITY (Tier-1 #8): set true when the caller has
   * already run its own approval flow (main_chat does this in routes.ts).
   * Every other dispatcher (glasses, chat_engine, treasury, scheduled jobs,
   * felix, lobster) leaves this false so the in-executor fallback gate
   * fires for mutating + high-risk tools.
   */
  skipApprovalGate?: boolean;
}

// R63.17 — Only "system" gets implicit admin fallback. Everything else (including
// self_heal) must either pass an explicit tenantId or set allowSystemFallback:true.
// Reasoning:
//   - public_chat: untrusted external; must resolve tenant from slug/token.
//   - self_heal: single caller (agentic/self-heal.ts) already passes tenantId
//     explicitly AND now sets allowSystemFallback for the rare case where it
//     can't. Removing it from the implicit set means any future self_heal-tagged
//     caller that forgets a tenantId gets rejected loudly instead of writing
//     silently to admin tenant 1.
//   - system: pure internal scheduled jobs that have no tenant context by design.
const SYSTEM_INVOKERS: Set<InvokedVia> = new Set(["system"]);

// R63.9: Rate-limited tracking-failure logger (one warning per stage+tool per 5min)
// to surface silent breakage without flooding logs.
// Map is bounded — when it exceeds MAX size we drop oldest half. Prevents
// unbounded growth if tool names ever become high-cardinality (e.g. dynamic).
const _TRACKING_MAP_MAX = 500;
const _trackingFailureSeen = new Map<string, number>();
function _logTrackingFailure(stage: string, toolName: string, err: any): void {
  const key = `${stage}:${toolName}`;
  const now = Date.now();
  const last = _trackingFailureSeen.get(key) || 0;
  if (now - last < 5 * 60 * 1000) return;

  // Bounded eviction: when full, drop the oldest half.
  if (_trackingFailureSeen.size >= _TRACKING_MAP_MAX) {
    const sorted = [..._trackingFailureSeen.entries()].sort((a, b) => a[1] - b[1]);
    for (let i = 0; i < Math.floor(sorted.length / 2); i++) {
      _trackingFailureSeen.delete(sorted[i][0]);
    }
  }

  _trackingFailureSeen.set(key, now);
  const msg = err?.message || String(err);
  console.warn(`[guarded-exec] tracking failure: stage=${stage} tool=${toolName} err=${msg.slice(0, 200)}`);
}

export async function executeGuardedTool(
  toolName: string,
  args: Record<string, any>,
  ctx: GuardedExecContext,
): Promise<any> {
  let tenantId = ctx.tenantId || (args as any)._tenantId;
  if (!tenantId) {
    if (SYSTEM_INVOKERS.has(ctx.invokedVia) || ctx.allowSystemFallback) {
      tenantId = 1;
      console.warn(`[guarded-exec] tenant=fallback(1) tool=${toolName} via=${ctx.invokedVia}`);
    } else {
      console.error(`[guarded-exec] REJECTED: missing tenantId for tool=${toolName} via=${ctx.invokedVia}`);
      return { error: `Missing tenant context for tool '${toolName}'. Refusing to execute.` };
    }
  }

  if (ctx.personaRole) {
    try {
      const blocked = getPersonaBlockedTools(ctx.personaRole);
      if (blocked.has(toolName)) {
        console.warn(`[guarded-exec] BLOCKED: tool=${toolName} persona=${ctx.personaRole} via=${ctx.invokedVia}`);
        return { error: `Tool '${toolName}' is not allowed for persona '${ctx.personaRole}'. Try a different tool.` };
      }
    } catch (_silentErr) { logSilentCatch("server/guarded-tool-executor.ts", _silentErr); }
  }

  // R75.B — DESTRUCTIVE TOOL POLICY (AHB defense, action boundary). Even if
  // a stylistically-obfuscated jailbreak slipped past the intent gate and
  // convinced the LLM to emit a harmful tool call, this layer rejects it
  // structurally: free-text args, unapproved value caps, untrusted personas,
  // missing approval rows. Fail-CLOSED.
  try {
    const { enforceToolPolicy } = await import("./safety/destructive-tool-policy");
    const policyResult = await enforceToolPolicy(toolName, args, {
      tenantId,
      personaId: (ctx as any).personaId ?? null,
      personaName: ctx.personaRole,
      invokedVia: ctx.invokedVia,
      hasApproval: (args as any)?._approvedByGate === true || ctx.skipApprovalGate === true,
    });
    if (policyResult.action === "block") {
      return { error: `Blocked by destructive-tool policy: ${policyResult.reason}` };
    }
  } catch (e: any) {
    // Fail-closed: policy module errors must not allow destructive calls through.
    console.error(`[guarded-exec] tool-policy errored for ${toolName}: ${e.message} — failing closed`);
    return { error: `Destructive-tool policy check failed for '${toolName}'. Refusing to execute.` };
  }

  const rateCheck = checkToolRateLimit(tenantId, toolName);
  if (!rateCheck.allowed) {
    console.warn(`[guarded-exec] RATE LIMITED: tool=${toolName} tenant=${tenantId} via=${ctx.invokedVia} reason=${rateCheck.reason}`);
    return { error: `RATE LIMITED: ${rateCheck.reason} Use a different tool or approach instead.` };
  }
  recordToolUsage(tenantId, toolName);

  // R74.13z-quint+7 SECURITY (Tier-1 #8): unified approval gate. main_chat
  // already runs its own (richer, SSE-streamed) gate and passes
  // skipApprovalGate=true. Every other dispatcher relies on this fallback —
  // so glasses voice, chat_engine, treasury, scheduled jobs, felix, lobster
  // all hit HITL for high-risk and confirmation-required tools. Self-heal
  // is exempt because it sets `_selfHeal: true` and runs in a constrained
  // sandbox already.
  const skipGate =
    ctx.skipApprovalGate === true ||
    ctx.invokedVia === "self_heal" ||
    (args as any)?._selfHeal === true ||
    (args as any)?._approvedByGate === true;
  if (!skipGate) {
    try {
      const { classifyToolRisk, requestToolConfirmation, recordMutation } = await import("./tool-mutation");
      const risk = classifyToolRisk(toolName, args);
      if (risk.isMutating) {
        recordMutation({
          timestamp: new Date().toISOString(),
          toolName,
          riskLevel: risk.riskLevel,
          args,
          conversationId: ctx.conversationId,
        });
      }
      if (risk.requiresConfirmation) {
        const { confirmationId, promise } = requestToolConfirmation(
          toolName,
          args,
          risk.riskLevel,
          ctx.conversationId,
          tenantId,
        );
        console.log(`[guarded-exec] HITL gate fired: tool=${toolName} via=${ctx.invokedVia} tenant=${tenantId} conf=${confirmationId}`);
        const approved = await promise;
        if (!approved) {
          console.log(`[guarded-exec] HITL DENIED: tool=${toolName} via=${ctx.invokedVia} conf=${confirmationId}`);
          return {
            denied: true,
            error: `Tool '${toolName}' requires human approval and was denied (or timed out). Action not executed.`,
          };
        }
        console.log(`[guarded-exec] HITL APPROVED: tool=${toolName} via=${ctx.invokedVia} conf=${confirmationId}`);
      }
    } catch (gateErr: any) {
      console.error(`[guarded-exec] approval gate error for ${toolName}: ${gateErr?.message || gateErr}`);
      // Fail closed on gate plumbing failure for high-risk tools — better to
      // miss one legitimate run than to silently bypass approval.
      return { error: `Approval gate failure: ${gateErr?.message || "unknown"}` };
    }
  }

  const startedAt = Date.now();
  let result: any;
  try {
    // R70-G (architect-fix): never mutate caller's args — would leak _tenantId
    // across calls if the same args object is reused with a different ctx.
    // Build a fresh copy with the canonical tenantId from THIS call's context.
    //
    // R74.13z-quint+7 SECURITY (Tier-1 #1): every code path that reaches
    // executeGuardedTool is by definition NOT the owner running the command
    // directly — it's main_chat / glasses_gateway / kernel / felix / scheduled
    // jobs / self_heal. Stamp `_invokedByModel: true` so owner-only tools
    // (exec, delete_*, etc.) refuse the call. The narrow self-heal escape
    // hatch still works because self-heal also sets `_selfHeal: true`, which
    // exec / lobster check for explicitly before running.
    const execArgs = {
      ...args,
      _skipTracking: true,
      _rateLimitChecked: true,
      _tenantId: tenantId,
      _invokedByModel: true,
      _invokedVia: ctx.invokedVia,
    };
    result = await executeToolWithTimeout(toolName, execArgs);
  } catch (err: any) {
    result = { error: err?.message || "Tool execution failed" };
  }
  const durationMs = Date.now() - startedAt;

  if (tenantId) {
    const hasError = result && typeof result === "object" && (result as any).error;
    // R63.9: Replaced silent .catch(() => {}) with rate-limited warnings.
    // tool_performance had 0 rows for weeks because every failure here was eaten.
    // If TOOL_TRACKING_DISABLED=1, skip entirely (kill switch).
    if (process.env.TOOL_TRACKING_DISABLED !== "1") {
      import("./skill-evolution").then(({ trackToolExecution }) => {
        trackToolExecution(
          tenantId,
          toolName,
          !hasError,
          durationMs,
          hasError ? String((result as any).error).slice(0, 200) : undefined,
        ).catch(err => _logTrackingFailure("trackToolExecution", toolName, err));
      }).catch(err => _logTrackingFailure("import skill-evolution", toolName, err));

      if (!hasError) {
        import("./agentic/cost-ledger").then(({ recordCost }) => {
          recordCost({
            tenantId,
            toolName,
            model: (args as any)?.model,
            tokensIn: result?.usage?.prompt_tokens || result?.tokensIn,
            tokensOut: result?.usage?.completion_tokens || result?.tokensOut,
            operation: ctx.invokedVia,
          }).catch(err => _logTrackingFailure("recordCost", toolName, err));
        }).catch(err => _logTrackingFailure("import cost-ledger", toolName, err));
      }
    }
  }

  return result;
}
