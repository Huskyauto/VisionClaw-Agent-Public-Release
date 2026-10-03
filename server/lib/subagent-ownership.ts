export type SubagentOwnerScope = {
  tenantId: number;
  conversationId: number;
};

export const PLATFORM_ADMIN_SUBAGENT_ACCESS = Symbol("platform-admin-subagent-access");

export type PlatformAdminSubagentAccess = {
  platformAdmin: typeof PLATFORM_ADMIN_SUBAGENT_ACCESS;
};

export interface OwnedSubagentRun {
  id: string;
  tenantId: number;
  parentConversationId: number;
  status: "running" | "completed" | "failed" | "timeout" | "cancelled";
}

export function isValidSubagentOwnerScope(scope: unknown): scope is SubagentOwnerScope {
  if (!scope || typeof scope !== "object") return false;
  const candidate = scope as Record<string, unknown>;
  return Number.isSafeInteger(candidate.tenantId) && (candidate.tenantId as number) > 0
    && Number.isSafeInteger(candidate.conversationId) && (candidate.conversationId as number) > 0;
}

function hasPlatformAdminAccess(scope: unknown): scope is PlatformAdminSubagentAccess {
  return !!scope && typeof scope === "object"
    && (scope as PlatformAdminSubagentAccess).platformAdmin === PLATFORM_ADMIN_SUBAGENT_ACCESS;
}

function ownsRun(run: OwnedSubagentRun, scope: SubagentOwnerScope): boolean {
  return run.tenantId === scope.tenantId && run.parentConversationId === scope.conversationId;
}

export function createSubagentRunAccess<T extends OwnedSubagentRun>(runs: Map<string, T>) {
  function findAuthorized(id: string, scope: unknown): T | undefined {
    const run = runs.get(id);
    if (!run) return undefined;
    if (hasPlatformAdminAccess(scope)) return run;
    if (!isValidSubagentOwnerScope(scope) || !ownsRun(run, scope)) return undefined;
    return run;
  }

  return {
    list(scope: unknown): T[] {
      if (hasPlatformAdminAccess(scope)) return Array.from(runs.values());
      if (!isValidSubagentOwnerScope(scope)) return [];
      return Array.from(runs.values()).filter(run => ownsRun(run, scope));
    },

    listForTenant(tenantId: unknown): T[] {
      if (!Number.isSafeInteger(tenantId) || (tenantId as number) <= 0) return [];
      return Array.from(runs.values()).filter(run => run.tenantId === tenantId);
    },

    info(id: string, scope: unknown): T | undefined {
      return findAuthorized(id, scope);
    },

    kill(id: string, scope: unknown): { success: boolean; error?: string } {
      if (!isValidSubagentOwnerScope(scope)) {
        return { success: false, error: "Tenant and conversation context required" };
      }
      const run = findAuthorized(id, scope);
      if (!run) return { success: false, error: "Run not found" };
      if (run.status !== "running") return { success: false, error: `Run is not running (status: ${run.status})` };
      (run as OwnedSubagentRun).status = "cancelled";
      return { success: true };
    },

    killAll(scope: unknown): { killed: number } {
      if (!isValidSubagentOwnerScope(scope)) return { killed: 0 };
      const candidates = Array.from(runs.values()).filter(run => ownsRun(run, scope));

      let killed = 0;
      for (const run of candidates) {
        if (run.status !== "running") continue;
        (run as OwnedSubagentRun).status = "cancelled";
        killed++;
      }
      return { killed };
    },
  };
}